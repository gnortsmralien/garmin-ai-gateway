/**
 * Paging engine.
 *
 * Splits a reply into inReach-sized pages, sends them in order, and
 * checkpoints progress so an interrupted send resumes where it stopped
 * instead of replaying from page 1.
 *
 * buildPages / splitForPaging / findSplitPoint are pure and unit-tested.
 */

/**
 * Prefix for page `index` of `total`. Single-page replies carry no prefix.
 *
 * @param {number} index - 1-based
 * @param {number} total
 * @returns {string}
 */
function pagePrefix(index, total) {
  return total <= 1 ? "" : `${index}/${total} `;
}

/**
 * Widest prefix that can occur for a given page count, e.g. 12 pages yields
 * "12/12 " = 6 characters. Every page reserves this much so no page can
 * overflow GARMIN_SAFE_MAX regardless of its index.
 *
 * @param {number} total
 * @returns {number}
 */
function maxPrefixLength(total) {
  return total <= 1 ? 0 : String(total).length * 2 + 2;
}

/**
 * Build the exact payloads to send, prefixes included.
 *
 * The old implementation chunked at a fixed 149 characters and bolted the
 * prefix on afterwards, so the real per-message length depended on how many
 * pages happened to be produced. Here the prefix budget is folded in and the
 * split is re-run until the page count is stable.
 *
 * @param {string} text
 * @param {number} safeMax - hard per-message ceiling (LIMITS.GARMIN_SAFE_MAX)
 * @param {number} maxPages - ceiling on page count (LIMITS.MAX_PAGES)
 * @returns {string[]} ready-to-send payloads, each <= safeMax
 */
function buildPages(text, safeMax, maxPages) {
  const body = cleanOutput(text);

  if (!body) return [];
  if (body.length <= safeMax) return [body];

  // The prefix width depends on the page count, and the page count depends on
  // how much room the prefix leaves. Iterate on the reservation, which only
  // ever widens (4 -> 6 -> 8), so this settles in at most three passes and can
  // never end up reserving less than the final count needs.
  let reserve = maxPrefixLength(2);
  let chunks = splitForPaging(body, safeMax - reserve);

  for (let pass = 0; pass < 4; pass++) {
    const needed = maxPrefixLength(chunks.length);
    if (needed <= reserve) break;
    reserve = needed;
    chunks = splitForPaging(body, safeMax - reserve);
  }

  if (chunks.length > maxPages) {
    console.log(`[Pager] ${chunks.length} pages exceeds MAX_PAGES (${maxPages}), truncating`);
    chunks = chunks.slice(0, maxPages);

    const lastIdx = chunks.length - 1;
    const room = safeMax - maxPrefixLength(chunks.length) - 4;  // " ..."
    chunks[lastIdx] = truncateSmart(chunks[lastIdx], Math.max(1, room)) + " ...";
  }

  const total = chunks.length;
  const pages = [];

  for (let i = 0; i < total; i++) {
    let payload = pagePrefix(i + 1, total) + chunks[i];
    // Belt and braces: never emit a page the device would silently clip.
    if (payload.length > safeMax) payload = payload.substring(0, safeMax);
    pages.push(payload);
  }

  return pages;
}

/**
 * Split text into chunks of at most maxChunkLen characters, preferring
 * natural boundaries.
 *
 * @param {string} text
 * @param {number} maxChunkLen
 * @returns {string[]}
 */
function splitForPaging(text, maxChunkLen) {
  const chunks = [];
  let remaining = String(text || "").trim();

  if (maxChunkLen < 1) return remaining ? [remaining] : [];

  while (remaining.length > maxChunkLen) {
    const splitPoint = findSplitPoint(remaining, maxChunkLen);
    const head = remaining.substring(0, splitPoint).trim();

    if (!head) {
      // Degenerate input (e.g. a run of separators): force progress.
      chunks.push(remaining.substring(0, maxChunkLen).trim());
      remaining = remaining.substring(maxChunkLen).trim();
      continue;
    }

    chunks.push(head);
    remaining = remaining.substring(splitPoint).trim();
  }

  if (remaining.length > 0) chunks.push(remaining);

  return chunks;
}

/**
 * Choose where to cut a chunk of at most `limit` characters.
 *
 * The sentence scan uses [\s\S] rather than . because . never crosses a
 * newline: on a multi-line answer the old regex only ever inspected the first
 * line, so most splits fell through to the mid-word fallback.
 *
 * @param {string} text - longer than limit
 * @param {number} limit
 * @returns {number} split offset, 1..limit
 */
function findSplitPoint(text, limit) {
  const range = text.substring(0, limit);

  // A line break is the cleanest boundary - keeps labelled sections intact.
  const newlineIdx = range.lastIndexOf("\n");
  if (newlineIdx > limit * 0.5) return newlineIdx + 1;

  const sentence = range.match(/[\s\S]*[.!?](?=\s|$)/);
  if (sentence && sentence[0].length > limit * 0.5) return sentence[0].length;

  const clauseIdx = Math.max(
    range.lastIndexOf(", "),
    range.lastIndexOf("; "),
    range.lastIndexOf(": ")
  );
  if (clauseIdx > limit * 0.5) return clauseIdx + 1;

  // Any whitespace beats cutting mid-word, even early in the range.
  const spaceIdx = range.search(/\s\S*$/);
  if (spaceIdx > 0) return spaceIdx;

  return limit;
}

// =============================================================================
// =============================  SENDING  =====================================
// =============================================================================

/**
 * Paginate `text` and deliver it.
 *
 * @param {string} targetUrl - Garmin reply URL
 * @param {string} text
 * @param {string} logId
 * @param {Object} [options]
 *   - messageId: Gmail message id, enables resume-after-interruption
 *   - deadlineMs: epoch ms after which no further pages are started
 * @returns {{success: boolean, reason: (string|null), pages: number, chars: number, sent: number}}
 */
function paginateAndSend(targetUrl, text, logId, options) {
  options = options || {};

  const pages = buildPages(text, LIMITS.GARMIN_SAFE_MAX, LIMITS.MAX_PAGES);

  if (pages.length === 0) {
    return { success: false, reason: "EMPTY_TEXT", pages: 0, chars: 0, sent: 0 };
  }

  console.log(`[${logId}] PAGING: ${text.length} chars -> ${pages.length} page(s)`);

  return sendPages(targetUrl, pages, logId, 0, options);
}

/**
 * Send pages [startIndex..] in order, checkpointing after each success.
 *
 * @param {string} targetUrl
 * @param {string[]} pages
 * @param {string} logId
 * @param {number} startIndex
 * @param {Object} [options] - messageId, deadlineMs
 * @returns {{success: boolean, reason: (string|null), pages: number, chars: number, sent: number}}
 */
function sendPages(targetUrl, pages, logId, startIndex, options) {
  options = options || {};

  const messageId = options.messageId || null;
  const deadline = options.deadlineMs || (Date.now() + SYSTEM.EXECUTION_BUDGET_MS);
  const total = pages.length;
  const chars = pages.reduce((sum, p) => sum + p.length, 0);

  // One page fetch for the whole batch instead of one per page.
  const session = createGarminSession(targetUrl);

  let sent = startIndex;

  for (let i = startIndex; i < total; i++) {
    if (i > startIndex && Date.now() > deadline) {
      console.log(`[${logId}] Out of execution budget after ${sent}/${total} pages, will resume next run`);
      checkpointPages(messageId, pages, sent);
      return { success: false, reason: "TIME_BUDGET", pages: total, chars: chars, sent: sent };
    }

    const delivered = sendOnePage(session, pages[i], logId, i + 1, total, deadline);

    if (!delivered) {
      checkpointPages(messageId, pages, sent);
      return { success: false, reason: `PAGE_${i + 1}_FAILED`, pages: total, chars: chars, sent: sent };
    }

    sent = i + 1;
    checkpointPages(messageId, pages, sent);

    if (i < total - 1) {
      Utilities.sleep(LIMITS.PAGE_DELAY_MS);
    }
  }

  clearPageSession(messageId);
  return { success: true, reason: null, pages: total, chars: chars, sent: sent };
}

/**
 * Deliver a single page, retrying with a refreshed Garmin form on failure.
 * @private
 */
function sendOnePage(session, payload, logId, pageNum, total, deadline) {
  for (let attempt = 1; attempt <= LIMITS.PAGE_SEND_ATTEMPTS; attempt++) {
    // A refresh re-reads the reply page; the Guid/MessageId can rotate between
    // posts, which is why the first attempt's values may go stale.
    if (session.send(payload, attempt > 1)) {
      console.log(`[${logId}] Sent page ${pageNum}/${total} (${payload.length} chars)`);
      return true;
    }

    if (attempt < LIMITS.PAGE_SEND_ATTEMPTS && Date.now() < deadline) {
      console.log(`[${logId}] Page ${pageNum}/${total} attempt ${attempt} failed, retrying`);
      Utilities.sleep(LIMITS.PAGE_RETRY_BACKOFF_MS * attempt);
    } else {
      break;
    }
  }

  console.error(`[${logId}] Page ${pageNum}/${total} failed after ${LIMITS.PAGE_SEND_ATTEMPTS} attempts`);
  return false;
}

// =============================================================================
// =============================  RESUME STATE  ================================
// =============================================================================

/**
 * Persisted paging progress, so a run that dies mid-send (Apps Script timeout,
 * transient Garmin failure) resumes rather than resending page 1.
 *
 * Script Properties cap a single value at 9KB; oversized batches simply skip
 * checkpointing and fall back to the old replay behaviour.
 */
const PAGE_SESSION_MAX_BYTES = 8000;

/** @private */
function pageSessionKey(messageId) {
  return "PAGES_" + messageId;
}

/**
 * @param {string|null} messageId
 * @returns {{pages: string[], sent: number, timestamp: number}|null}
 */
function loadPageSession(messageId) {
  if (!messageId) return null;

  const raw = PropertiesService.getScriptProperties().getProperty(pageSessionKey(messageId));
  if (!raw) return null;

  try {
    const state = JSON.parse(raw);
    if (!state.pages || !state.pages.length) return null;

    if (Date.now() - state.timestamp > LIMITS.PAGE_SESSION_TTL_MS) {
      clearPageSession(messageId);
      return null;
    }

    return state;
  } catch (e) {
    clearPageSession(messageId);
    return null;
  }
}

/**
 * @param {string|null} messageId
 * @param {string[]} pages
 * @param {number} sent
 */
function checkpointPages(messageId, pages, sent) {
  if (!messageId) return;

  if (sent >= pages.length) {
    clearPageSession(messageId);
    return;
  }

  const payload = JSON.stringify({ pages: pages, sent: sent, timestamp: Date.now() });
  if (payload.length > PAGE_SESSION_MAX_BYTES) {
    debug(`[Pager] Page session too large to checkpoint (${payload.length} bytes)`);
    return;
  }

  PropertiesService.getScriptProperties().setProperty(pageSessionKey(messageId), payload);
}

/** @param {string|null} messageId */
function clearPageSession(messageId) {
  if (!messageId) return;
  PropertiesService.getScriptProperties().deleteProperty(pageSessionKey(messageId));
}

/** Drop page sessions older than LIMITS.PAGE_SESSION_TTL_MS. */
function cleanupOldPageSessions() {
  const props = PropertiesService.getScriptProperties();
  const allProps = props.getProperties();
  const cutoff = Date.now() - LIMITS.PAGE_SESSION_TTL_MS;
  let cleaned = 0;

  for (const key in allProps) {
    if (!key.startsWith('PAGES_')) continue;
    try {
      const state = JSON.parse(allProps[key]);
      if (!state.timestamp || state.timestamp < cutoff) {
        props.deleteProperty(key);
        cleaned++;
      }
    } catch (e) {
      props.deleteProperty(key);
      cleaned++;
    }
  }

  if (cleaned > 0) {
    console.log(`[CLEANUP] Removed ${cleaned} stale page sessions`);
  }
  return cleaned;
}
