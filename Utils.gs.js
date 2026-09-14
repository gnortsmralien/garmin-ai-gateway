/**
 * Shared utilities: logging, text shaping, template rendering, retry
 * bookkeeping and failure alerting.
 */

/** Debug logging helper - only logs if SYSTEM.DEBUG_MODE is true */
function debug(msg) {
  if (SYSTEM.DEBUG_MODE) {
    console.log(msg);
  }
}

/**
 * Replace every {{KEY}} occurrence in a template.
 *
 * String.prototype.replace with a string pattern only replaces the FIRST
 * match, which silently left stale placeholders in the old prompt code.
 *
 * @param {string} template
 * @param {Object} vars - map of placeholder name to value
 * @returns {string}
 */
function renderTemplate(template, vars) {
  if (!template) return "";

  var out = template;
  for (var key in vars) {
    if (!Object.prototype.hasOwnProperty.call(vars, key)) continue;
    var value = vars[key] === null || vars[key] === undefined ? "" : String(vars[key]);
    out = out.split("{{" + key + "}}").join(value);
  }
  return out;
}

/**
 * Approximate word count for a character budget.
 * Models estimate words far more reliably than characters, so prompts carry
 * both numbers. ~6 characters per word including the trailing space.
 *
 * @param {number} chars
 * @returns {number}
 */
function charsToWords(chars) {
  return Math.max(1, Math.round(chars / 6));
}

/**
 * Strip markdown and normalise whitespace for a plain-text satellite message.
 *
 * @param {string} text
 * @returns {string}
 */
function cleanOutput(text) {
  if (!text) return "";

  return text
    .replace(/```[a-z]*\n?/gi, "")   // fenced code blocks
    .replace(/\*\*/g, "")
    .replace(/\*/g, "")
    .replace(/#{1,6}\s/g, "")
    .replace(/`/g, "")
    .replace(/^\s*[-•]\s+/gm, "")  // leading bullets
    .replace(/\r\n/g, "\n")
    .replace(/\n{2,}/g, "\n")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/^\s+|\s+$/g, "");
}

/**
 * Truncate at the nicest boundary at or before `limit`.
 *
 * Uses [\s\S] rather than . so the sentence scan crosses newlines; the old
 * version only ever looked at the first line, which made multi-line answers
 * fall through to a mid-word cut.
 *
 * @param {string} text
 * @param {number} limit
 * @returns {string}
 */
function truncateSmart(text, limit) {
  if (!text || text.length <= limit) return text || "";
  if (limit <= 3) return text.substring(0, Math.max(0, limit));

  const window = text.substring(0, limit);

  // A clean sentence ending needs no ellipsis, so it may use the whole window.
  const sentenceEnd = window.match(/[\s\S]*[.!?](?=\s|$)/);
  if (sentenceEnd && sentenceEnd[0].length > limit * 0.6) {
    return sentenceEnd[0].trim();
  }

  // Every other path appends "...", so reserve those three characters up
  // front - cutting at `limit` and then appending overshot the limit.
  const head = text.substring(0, limit - 3);

  const lastSpace = head.search(/\s\S*$/);
  if (lastSpace > limit * 0.6) {
    return head.substring(0, lastSpace).trim() + "...";
  }

  return head.trim() + "...";
}

// =============================================================================
// =============================  RETRY BOOKKEEPING  ===========================
// =============================================================================

/**
 * Get retry count for a message using Script Properties
 * Format: RETRY_{messageId} = {count: N, timestamp: T}
 */
function getRetryCount(messageId) {
  const props = PropertiesService.getScriptProperties();
  const data = props.getProperty(`RETRY_${messageId}`);

  if (!data) return 0;

  try {
    return JSON.parse(data).count || 0;
  } catch (e) {
    return 0;
  }
}

/** Increment retry count for a message */
function incrementRetryCount(messageId) {
  const props = PropertiesService.getScriptProperties();
  const newCount = getRetryCount(messageId) + 1;

  props.setProperty(`RETRY_${messageId}`, JSON.stringify({
    count: newCount,
    timestamp: Date.now()
  }));

  console.log(`[RETRY] Message ${messageId.substring(0, 8)} attempt ${newCount}/${RETRY.MAX_ATTEMPTS}`);
  return newCount;
}

/** Clear retry count for a message (success or permanent failure) */
function clearRetryCount(messageId) {
  PropertiesService.getScriptProperties().deleteProperty(`RETRY_${messageId}`);
}

/**
 * Drop retry entries older than RETRY.ENTRY_TTL_MS so the property store does
 * not grow without bound.
 */
function cleanupOldRetries() {
  const props = PropertiesService.getScriptProperties();
  const allProps = props.getProperties();
  const cutoff = Date.now() - RETRY.ENTRY_TTL_MS;
  let cleaned = 0;

  for (const key in allProps) {
    if (!key.startsWith('RETRY_')) continue;
    try {
      const data = JSON.parse(allProps[key]);
      if (data.timestamp && data.timestamp < cutoff) {
        props.deleteProperty(key);
        cleaned++;
      }
    } catch (e) {
      props.deleteProperty(key);
      cleaned++;
    }
  }

  if (cleaned > 0) {
    console.log(`[CLEANUP] Removed ${cleaned} old retry entries`);
  }
  return cleaned;
}

// =============================================================================
// =============================  FAILURE ALERTING  ============================
// =============================================================================

/**
 * A message was lost. Report it out of band.
 *
 * This used to be inert unless SYSTEM.ALERT_EMAIL was filled in by hand, and
 * it never was, so two outages ran their course unannounced. Addressing is now
 * resolved at run time (see resolveAlertEmail) and needs no configuration.
 *
 * @param {string} logId
 * @param {string} prompt
 * @param {string} reason
 * @param {boolean} [parked] - the answer is queued for redelivery
 */
function handleFailure(logId, prompt, reason, parked) {
  console.error(`[${logId}] FAILURE LOGGED: ${reason}`);

  sendAlert(`Gateway failure: ${logId}`, [
    `A message was answered but could not be delivered, or could not be`,
    parked
      ? `answered at all. The answer is queued and will be redelivered once`
      : `answered at all. It will not be retried.`,
    parked ? `Garmin accepts replies again, or dropped if it goes stale first.` : ``,
    ``,
    `Log ID: ${logId}`,
    `Reason: ${reason}`,
    `Prompt: ${prompt}`,
    `Time:   ${new Date().toISOString()}`
  ].join('\n'));
}
