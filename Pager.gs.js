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
      checkpointPages(messageId, pages, sent, targetUrl);
      return { success: false, reason: "TIME_BUDGET", pages: total, chars: chars, sent: sent };
    }

    const delivered = sendOnePage(session, pages[i], logId, i + 1, total, deadline);

    if (!delivered) {
      checkpointPages(messageId, pages, sent, targetUrl);
      return { success: false, reason: `PAGE_${i + 1}_FAILED`, pages: total, chars: chars, sent: sent };
    }

    sent = i + 1;
    checkpointPages(messageId, pages, sent, targetUrl);

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
 * @returns {{pages: string[], sent: number, timestamp: number, url: (string|null), parked: (boolean|undefined)}|null}
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
 * @param {string} [url] - reply URL, so a parked reply can be delivered later
 */
function checkpointPages(messageId, pages, sent, url) {
  if (!messageId) return;

  if (sent >= pages.length) {
    clearPageSession(messageId);
    return;
  }

  // A parked reply stays parked across the checkpoints of its own drain
  // attempt; losing the flag mid-drain would strand the answer for good,
  // because its Gmail message is already starred.
  const previous = loadPageSession(messageId);

  const payload = JSON.stringify({
    pages: pages,
    sent: sent,
    timestamp: Date.now(),
    url: url || (previous ? previous.url : null),
    parked: !!(previous && previous.parked)
  });
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

/**
 * Keep a reply that could not be delivered, instead of binning it.
 *
 * Reached when a message has spent its retries. The answer has already been
 * generated and paid for, and the failure is almost always Garmin-side and
 * temporary, so the pages are parked for drainPendingDeliveries to finish once
 * delivery comes back. Its Gmail message is starred by then, so the ordinary
 * path will never look at it again - this is the only thing that will.
 *
 * @param {string|null} messageId
 * @param {string} targetUrl
 * @returns {boolean} whether anything was parked
 */
function parkPendingDelivery(messageId, targetUrl) {
  const state = loadPageSession(messageId);
  if (!state) return false;

  state.parked = true;
  state.url = state.url || targetUrl || null;

  if (!state.url) {
    // Nowhere to deliver it to; keeping it would just leak a property.
    clearPageSession(messageId);
    return false;
  }

  PropertiesService.getScriptProperties().setProperty(
    pageSessionKey(messageId),
    JSON.stringify(state)
  );

  console.log(`[Pager] Parked ${state.pages.length - state.sent} undelivered page(s) for later`);
  return true;
}

/**
 * Every parked reply, oldest first.
 *
 * @returns {Array<{messageId: string, state: Object}>}
 */
function listPendingDeliveries() {
  const allProps = PropertiesService.getScriptProperties().getProperties();
  const pending = [];

  for (const key in allProps) {
    if (!key.startsWith('PAGES_')) continue;

    try {
      const state = JSON.parse(allProps[key]);
      if (!state.parked || !state.pages || !state.url) continue;
      pending.push({ messageId: key.substring('PAGES_'.length), state: state });
    } catch (e) {
      // cleanupOldPageSessions deals with unreadable entries.
    }
  }

  return pending.sort(function(a, b) {
    return (a.state.timestamp || 0) - (b.state.timestamp || 0);
  });
}

/**
 * Try to deliver parked replies.
 *
 * Bounded per run so a backlog cannot eat the budget live messages need, and
 * age-capped because a satellite answer that arrives hours late is noise to
 * someone who has since moved on.
 *
 * @param {number} deadlineMs
 * @returns {{attempted: number, delivered: number, abandoned: number}}
 */
const PENDING_DRAIN_STAMP_KEY = 'PENDING_DRAIN_LAST';

function drainPendingDeliveries(deadlineMs) {
  const result = { attempted: 0, delivered: 0, abandoned: 0, skipped: false };

  // runGateway calls this every minute, and the overwhelming majority of those
  // runs have nothing parked. Check the one-key throttle stamp before reading
  // the whole property store, not after.
  const props = PropertiesService.getScriptProperties();
  const last = Number(props.getProperty(PENDING_DRAIN_STAMP_KEY) || 0);

  if (Date.now() - last < HEALTH.PENDING_DRAIN_INTERVAL_MS) {
    result.skipped = true;
    return result;
  }

  const pending = listPendingDeliveries();
  if (pending.length === 0) return result;

  props.setProperty(PENDING_DRAIN_STAMP_KEY, String(Date.now()));
  console.log(`[Pager] ${pending.length} parked repl(ies) waiting`);

  for (let i = 0; i < pending.length; i++) {
    if (result.attempted >= HEALTH.PENDING_DRAIN_PER_RUN) break;
    if (Date.now() > deadlineMs) break;

    const entry = pending[i];
    const age = Date.now() - (entry.state.timestamp || 0);

    if (age > HEALTH.PENDING_MAX_AGE_MS) {
      console.error(`[Pager] Abandoning a reply parked ${Math.round(age / 60000)} min ago - too stale to send`);
      recordDegradation(
        'REPLY_ABANDONED',
        `an answer was generated but never delivered, and has aged out after ${Math.round(age / 60000)} min`
      );
      clearPageSession(entry.messageId);
      result.abandoned++;
      continue;
    }

    result.attempted++;

    const outcome = sendPages(
      entry.state.url,
      entry.state.pages,
      'DRAIN',
      entry.state.sent,
      { messageId: entry.messageId, deadlineMs: deadlineMs }
    );

    if (outcome.success) {
      console.log(`[Pager] Drained a parked reply (${outcome.pages} page(s))`);
      clearPageSession(entry.messageId);
      result.delivered++;
    } else {
      console.log(`[Pager] Parked reply still undeliverable: ${outcome.reason}`);
    }
  }

  return result;
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
