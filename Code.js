/**
 * Garmin AI Gateway - entry point and request pipeline.
 *
 * runGateway() is the time-driven trigger. Everything it needs lives in
 * sibling files:
 *   Config.gs.js         - all tunables and prompts
 *   MessageParser.gs.js  - inbound email parsing
 *   Toolbox.gs.js        - tool triggers and TOOL CONTEXT assembly
 *   Pager.gs.js          - splitting, sending, resume-after-interruption
 *   GarminClient.gs.js   - Garmin reply POSTs
 *   Utils.gs.js          - text shaping, retry bookkeeping, alerting
 */

function runGateway() {
  const deadline = Date.now() + SYSTEM.EXECUTION_BUDGET_MS;

  const senderQuery = `from:({${SYSTEM.TRUSTED_EMAILS.join(" ")}})`;
  const fullQuery = `${senderQuery} "AI:" ${SYSTEM.SEARCH_WINDOW}`;
  debug(`[runGateway] Search query: ${fullQuery}`);

  const threads = GmailApp.search(fullQuery, 0, SYSTEM.MAX_THREADS_PER_RUN);
  debug(`[runGateway] Found ${threads.length} threads`);

  if (threads.length === 0) return;

  maybeRunCleanup();

  // Guards against handling the same message twice within one execution.
  const processedIds = new Set();

  for (let i = 0; i < threads.length; i++) {
    if (Date.now() > deadline) {
      console.log(`[runGateway] Execution budget spent, ${threads.length - i} thread(s) deferred to next run`);
      break;
    }

    try {
      handleThread(threads[i], processedIds, deadline);
    } catch (threadError) {
      console.error(`[runGateway] Error processing thread: ${threadError}`);
      console.error(`[runGateway] Stack: ${threadError.stack}`);
    }
  }
}

/**
 * Periodic housekeeping, run on roughly one in ten executions.
 * @private
 */
function maybeRunCleanup() {
  if (Math.random() >= 0.1) return;

  try {
    cleanupOldRetries();
    cleanupOldPageSessions();
    createInteractionStateManager().cleanupExpired();
  } catch (cleanupError) {
    console.error(`[runGateway] Cleanup error (non-fatal): ${cleanupError}`);
  }
}

/**
 * Process the latest message in a thread.
 * @private
 */
function handleThread(thread, processedIds, deadline) {
  const messages = thread.getMessages();
  const lastMsg = messages[messages.length - 1];
  if (!lastMsg) return;

  // Starred means "already dealt with".
  if (lastMsg.isStarred()) return;

  const messageId = lastMsg.getId();
  if (processedIds.has(messageId)) return;
  processedIds.add(messageId);

  const retryCount = getRetryCount(messageId);
  if (retryCount >= RETRY.MAX_ATTEMPTS) {
    console.log(`[SKIP] Message ${messageId.substring(0, 8)} exceeded max retries (${retryCount})`);
    lastMsg.star();
    clearRetryCount(messageId);
    clearPageSession(messageId);
    return;
  }

  const body = lastMsg.getPlainBody();

  const link = extractGarminLink(body);
  if (!link) {
    debug(`[runGateway] No Garmin reply link in message, skipping`);
    lastMsg.star();
    clearRetryCount(messageId);
    return;
  }

  const replyAddress = extractRecipientAddress(safeGetTo(lastMsg));
  const targetUrl = resolveInreachLink(link, replyAddress);

  const parsed = parseAiPrompt(body);
  if (!parsed.ok) {
    debug(`[runGateway] Skipping message: ${parsed.reason}`);
    lastMsg.star();
    clearRetryCount(messageId);
    return;
  }

  const coords = extractCoordinates(body);
  const logId = extractLogId(targetUrl);

  console.log(`[${logId}] INGEST (attempt ${retryCount + 1}/${RETRY.MAX_ATTEMPTS}): "${parsed.prompt}"`);
  if (coords) console.log(`[${logId}] COORDS: ${coords.lat}, ${coords.lon}`);

  try {
    const result = processAndSend(parsed.prompt, targetUrl, logId, coords, {
      messageId: messageId,
      deadlineMs: deadline
    });

    recordOutcome(lastMsg, messageId, logId, parsed.prompt, targetUrl, result);
  } catch (e) {
    console.error(`[${logId}] EXCEPTION: ${e}`);
    const attempts = incrementRetryCount(messageId);

    if (attempts >= RETRY.MAX_ATTEMPTS) {
      lastMsg.star();
      clearRetryCount(messageId);
      clearPageSession(messageId);
      sendErrorToUser(targetUrl, ERROR_MESSAGES.EXCEPTION.code, ERROR_MESSAGES.EXCEPTION.message);
      handleFailure(logId, parsed.prompt, `EXCEPTION:${e.message || e}`);
    } else {
      console.error(`[${logId}] Exception will retry (${attempts}/${RETRY.MAX_ATTEMPTS})`);
    }
  }
}

/**
 * Star, retry or give up based on the pipeline result.
 * @private
 */
function recordOutcome(lastMsg, messageId, logId, prompt, targetUrl, result) {
  if (result.success) {
    lastMsg.star();
    clearRetryCount(messageId);
    console.log(`[${logId}] COMPLETE: ${result.pages} page(s), ${result.chars} chars`);
    return;
  }

  // Permanent failures: the user already has an explanation, so stop here.
  if (result.reason === "PHASE1_FAILED" || result.reason === "NO_API_KEY") {
    lastMsg.star();
    clearRetryCount(messageId);
    clearPageSession(messageId);
    console.error(`[${logId}] AI FAILED (permanent): ${result.reason}`);
    handleFailure(logId, prompt, result.reason);
    return;
  }

  // Ran out of execution time mid-send. Progress is checkpointed, so resume on
  // the next run without burning a retry.
  if (result.reason === "TIME_BUDGET") {
    console.log(`[${logId}] Paused after ${result.sent}/${result.pages} pages, resuming next run`);
    return;
  }

  const attempts = incrementRetryCount(messageId);

  if (attempts >= RETRY.MAX_ATTEMPTS) {
    lastMsg.star();
    clearRetryCount(messageId);
    clearPageSession(messageId);
    sendErrorToUser(targetUrl, ERROR_MESSAGES.MAX_RETRIES.code, ERROR_MESSAGES.MAX_RETRIES.message);
    console.error(`[${logId}] MAX RETRIES REACHED (${attempts})`);
    handleFailure(logId, prompt, `MAX_RETRIES:${result.reason}`);
  } else if (result.reason === "GEMINI_RETRYABLE") {
    console.error(`[${logId}] GEMINI OVERLOADED (retry ${attempts}/${RETRY.MAX_ATTEMPTS})`);
  } else {
    console.error(`[${logId}] SEND FAILED (retry ${attempts}/${RETRY.MAX_ATTEMPTS}): ${result.reason}`);
  }
}

/** @private */
function safeGetTo(message) {
  try {
    return message.getTo();
  } catch (e) {
    console.error(`[runGateway] Error reading To header: ${e}`);
    return null;
  }
}

// =============================================================================
// =============================  CORE PIPELINE  ===============================
// =============================================================================

/**
 * Answer one message and deliver the reply.
 *
 * @param {string} userPrompt
 * @param {string} targetUrl
 * @param {string} logId
 * @param {{lat: number, lon: number}|null} coords
 * @param {Object} [options] - messageId, deadlineMs
 * @returns {{success: boolean, reason: (string|null), pages: number, chars: number, sent: number}}
 */
function processAndSend(userPrompt, targetUrl, logId, coords, options) {
  options = options || {};

  // A previous run may have delivered some pages before being interrupted.
  // Finish that reply rather than paying for a second answer.
  const pending = loadPageSession(options.messageId);
  if (pending) {
    console.log(`[${logId}] Resuming interrupted reply at page ${pending.sent + 1}/${pending.pages.length}`);
    return sendPages(targetUrl, pending.pages, logId, pending.sent, options);
  }

  const key = PropertiesService.getScriptProperties().getProperty('GEMINI_KEY');
  if (!key) {
    sendErrorToUser(targetUrl, ERROR_MESSAGES.NO_API_KEY.code, ERROR_MESSAGES.NO_API_KEY.message);
    return failure("NO_API_KEY");
  }

  if (isHelpCommand(userPrompt)) {
    return paginateAndSend(targetUrl, getHelpText(), logId, options);
  }

  const budget = resolveLengthBudget(userPrompt, logId);
  const sized = stripSizeOverride(userPrompt);

  // openConversation sees the reset command; the model must not.
  const state = openConversation(targetUrl, sized, logId);
  const question = stripResetPrefix(sized);

  if (!question) {
    console.log(`[${logId}] Reset command with no question`);
    return paginateAndSend(targetUrl, "Context cleared. Send your question.", logId, options);
  }

  const toolbox = runToolbox(question, coords, logId);
  if (toolbox.errors.length > 0) {
    console.log(`[${logId}] Toolbox errors: ${toolbox.errors.join(", ")}`);
  }

  console.log(`[${logId}] Generating reply (target ${budget.target}, max ${budget.max} chars)...`);
  const client = createGeminiInteractionsClient(key, SYSTEM.MODEL_TAG);
  const reply = generateReply(client, question, toolbox.context, budget, state.previousInteractionId, logId);

  if (!reply.success) {
    console.error(`[${logId}] Generation failed: ${reply.error.message}`);

    if (reply.error.retryable) {
      console.log(`[${logId}] Retryable error, leaving message for next run`);
      return failure("GEMINI_RETRYABLE");
    }

    sendErrorToUser(targetUrl, ERROR_MESSAGES.AI_PERMANENT_FAIL.code, ERROR_MESSAGES.AI_PERMANENT_FAIL.message);
    return failure("PHASE1_FAILED");
  }

  saveConversation(state, reply.interactionId, logId);

  console.log(`[${logId}] FINAL: ${reply.text.length} chars`);
  debug(`[${logId}] TEXT: "${reply.text}"`);

  return paginateAndSend(targetUrl, reply.text, logId, options);
}

/**
 * Ask the model for an answer, and shrink it if it overshoots the budget.
 *
 * A single call does the work that used to take two: the length budget is part
 * of the answering prompt, so the aggressive telegram-style compression pass is
 * no longer applied to every reply. The shrink pass only runs on overshoot.
 *
 * @param {Object} client - GeminiInteractionsClient
 * @param {string} question
 * @param {string} toolContext
 * @param {{target: number, max: number}} budget
 * @param {string|null} previousInteractionId
 * @param {string} logId
 * @returns {{success: boolean, text: string, interactionId: (string|null), error: Object}}
 */
function generateReply(client, question, toolContext, budget, previousInteractionId, logId) {
  const systemPrompt = renderTemplate(AI_CONFIG.ANSWER.PROMPT, {
    TARGET: budget.target,
    TARGET_WORDS: charsToWords(budget.target),
    MAX: budget.max,
    MAX_WORDS: charsToWords(budget.max),
    TOOL_CONTEXT: toolContext || "(no tool data for this message)"
  });

  const answer = client.call(question, systemPrompt, {
    maxOutputTokens: AI_CONFIG.ANSWER.TOKENS,
    temperature: AI_CONFIG.ANSWER.TEMP,
    previousInteractionId: previousInteractionId,
    tools: ['google_search', 'url_context'],
    store: true
  });

  if (!answer.success) return answer;

  let text = cleanOutput(answer.text);
  console.log(`[${logId}] Model returned ${text.length} chars`);

  if (text.length > budget.max) {
    text = shrinkToBudget(client, text, budget, logId);
  }

  return { success: true, text: text, interactionId: answer.interactionId, error: null };
}

/**
 * Second pass: ask the model to fit the budget, keeping safety-critical
 * content. Falls back to a boundary-aware truncation if that fails or is still
 * too long.
 * @private
 */
function shrinkToBudget(client, text, budget, logId) {
  console.log(`[${logId}] Over budget (${text.length} > ${budget.max}), asking model to shorten`);

  const shrinkPrompt = renderTemplate(AI_CONFIG.SHRINK.PROMPT, {
    TARGET: budget.target,
    MAX: budget.max
  });

  const shrunk = client.call(text, shrinkPrompt, {
    maxOutputTokens: AI_CONFIG.SHRINK.TOKENS,
    temperature: AI_CONFIG.SHRINK.TEMP,
    previousInteractionId: null,   // the shrink pass carries no conversation
    tools: [],
    store: false
  });

  if (shrunk.success) {
    const candidate = cleanOutput(shrunk.text);
    if (candidate.length > 0 && candidate.length < text.length) {
      console.log(`[${logId}] Shrunk to ${candidate.length} chars`);
      text = candidate;
    } else {
      console.log(`[${logId}] Shrink pass returned nothing shorter, keeping original`);
    }
  } else {
    console.log(`[${logId}] Shrink pass failed: ${shrunk.error.message}`);
  }

  if (text.length > budget.max) {
    console.log(`[${logId}] Still over max, truncating to ${budget.max}`);
    text = truncateSmart(text, budget.max);
  }

  return text;
}

/**
 * Resolve the character budget for this reply, honouring a "SIZE n" override.
 *
 * @param {string} userPrompt
 * @param {string} logId
 * @returns {{target: number, max: number}}
 */
function resolveLengthBudget(userPrompt, logId) {
  const override = extractSizeOverride(userPrompt);

  if (!override) {
    return { target: LIMITS.AI_TARGET_LENGTH, max: LIMITS.AI_ABSOLUTE_MAX };
  }

  const size = Math.min(override, LIMITS.SIZE_OVERRIDE_MAX);
  console.log(`[${logId}] SIZE OVERRIDE: ${override} chars (capped at ${size})`);
  return { target: size, max: size };
}

// =============================================================================
// =============================  CONVERSATION STATE  ==========================
// =============================================================================

/**
 * Look up the interaction to continue, if any. Failures here are non-fatal -
 * the reply just loses conversational context.
 * @private
 */
function openConversation(targetUrl, question, logId) {
  const state = { manager: null, senderKey: null, previousInteractionId: null };

  try {
    state.manager = createInteractionStateManager();
    state.senderKey = extractSenderKey(targetUrl);
    state.previousInteractionId = state.manager.getInteractionId(state.senderKey, question);
  } catch (e) {
    console.error(`[${logId}] Conversation state unavailable (non-fatal): ${e}`);
  }

  return state;
}

/** @private */
function saveConversation(state, interactionId, logId) {
  if (!interactionId || !state.manager || !state.senderKey) return;

  try {
    state.manager.setInteractionId(state.senderKey, interactionId);
  } catch (e) {
    console.error(`[${logId}] Error storing interaction ID: ${e}`);
  }
}

// =============================================================================
// =============================  ERROR MESSAGING  =============================
// =============================================================================

/** @private */
function failure(reason) {
  return { success: false, reason: reason, pages: 0, chars: 0, sent: 0 };
}

/**
 * Send an error message back to the user via Garmin, so a failure is visible
 * on the device rather than only in the logs.
 */
function sendErrorToUser(targetUrl, errorCode, humanMessage) {
  const errorText = `[${errorCode}] ${humanMessage}`;
  console.log(`[ERROR->USER] ${errorText}`);

  try {
    postToGarmin(targetUrl, errorText);
  } catch (e) {
    console.error(`[ERROR->USER] Failed to send error: ${e}`);
  }
}
