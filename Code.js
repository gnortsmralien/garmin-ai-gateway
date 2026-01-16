// =============================================================================
// =============================  CONFIGURATION  ===============================
// =============================================================================

const SYSTEM = {
  TRUSTED_EMAILS: ["no.reply.inreach@garmin.com"],
  MODEL_TAG: "gemini-flash-latest",  // Using latest Flash model for Interactions API
  SEARCH_WINDOW: "newer_than:2d",
  SIMULATE_GARMIN: false,  // Production mode - messages sent to Garmin
  DEBUG_MODE: false,  // Set to true for verbose logging

  MAX_RETRIES: 3,
  ALERT_EMAIL: null,

  // Conversation state settings
  CONVERSATION_EXPIRY_HOURS: 24  // Auto-start new conversation after this period
};

const GARMIN = {
  ENDPOINT_SUFFIX: "/TextMessage/TxtMsg",
  USER_AGENT: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36"
};

const LIMITS = {
  GARMIN_SAFE_MAX: 155,
  AI_TARGET_LENGTH: 150,
  AI_ABSOLUTE_MAX: 450,
  CHUNK_PAYLOAD: 149,
  MAX_PAGES: 10,
  PAGE_DELAY_MS: 5000
};

const RETRY = {
  MAX_ATTEMPTS: 3
};

// =============================================================================
// =============================  ERROR MESSAGES  ==============================
// =============================================================================

/**
 * User-facing error messages - kept concise for satellite message limits
 * Format: { code: "ERR:CODE", message: "Short human message" }
 */
const ERROR_MESSAGES = {
  NO_API_KEY: {
    code: "ERR:CONFIG",
    message: "System not configured. Admin: add GEMINI_KEY to Script Properties."
  },
  AI_PERMANENT_FAIL: {
    code: "ERR:AI",
    message: "AI failed. Try: shorter query, WIKI term, or NEWS instead."
  },
  AI_OVERLOADED: {
    code: "ERR:BUSY",
    message: "AI overloaded. Wait 1-2min, resend same msg."
  },
  MAX_RETRIES: {
    code: "ERR:RETRY",
    message: "Failed 3x. Wait 5min, try simpler query or WIKI/NEWS."
  },
  SEND_FAILED: {
    code: "ERR:SEND",
    message: "Reply failed. Resend your msg or try shorter query."
  },
  EXCEPTION: {
    code: "ERR:SYS",
    message: "System error. Resend msg. If persists, try WIKI term."
  },
  GARMIN_POST_FAILED: {
    code: "ERR:GARMIN",
    message: "Garmin reply failed. Check link valid. Try resending original msg."
  }
};

// =============================================================================
// =============================  TOOLBOX CONFIG  ==============================
// =============================================================================

const TOOLBOX_CONFIG = {
  // User-Agent for APIs that require identification
  USER_AGENT: "SatComGateway/15.0 (satellite-emergency-assistant)",

  // Timeout for API calls (ms)
  FETCH_TIMEOUT_MS: 15000,

  // GDACS - Global Disaster Alert and Coordination System
  GDACS: {
    RSS_URL: "https://www.gdacs.org/xml/rss.xml",
    ALERT_RADIUS_KM: 500,
    MIN_ALERT_LEVEL: "Orange"
  },

  // DuckDuckGo Search (HTML scraping - no API key needed)
  DUCKDUCKGO: {
    HTML_URL: "https://html.duckduckgo.com/html/",
    MAX_RESULTS: 5
  },

  // Web Browse/Fetch
  WEB_BROWSE: {
    MAX_CONTENT_CHARS: 2000,
    TIMEOUT_MS: 15000
  },

  // =============================================================================
  // TOOL TRIGGER KEYWORDS
  // These keywords determine when each tool is automatically activated
  // =============================================================================

  TRIGGERS: {
    // Explicit tool commands (user types these at start of message)
    WIKIPEDIA: /^WIKI\s+(.+)/i,
    // NOTE: SEARCH and URL/BROWSE are now handled automatically by Gemini's
    // built-in Google Search and URL Context tools - no manual triggers needed

    // Auto-triggered based on content + context
    NEWS: {
      // Triggers when message contains any of these words
      keywords: ["NEWS", "HEADLINE", "HEADLINES", "CURRENT EVENTS"],
      requiresCoords: false
    },

    WEATHER: {
      // Narrowed to specific weather-related terms only
      // Removed generic words: TEMP, TEMPERATURE, WIND, COLD, HOT, HUMID
      // These were causing false triggers on historical/general queries
      keywords: ["WEATHER", "FORECAST", "RAIN", "STORM"],
      requiresCoords: true  // Only works if GPS location provided
    },

    ASTRONOMY: {
      keywords: ["SUNRISE", "SUNSET", "MOON", "LIGHT", "DAYLIGHT", "DARK", "NIGHT", "SUN"],
      requiresCoords: true
    },

    FULL_WEATHER: {
      // Comprehensive weather data - full API response for AI analysis
      keywords: ["FULL-WEATHER", "FULL_WEATHER", "FULL WEATHER"],
      requiresCoords: true
    },

    DISASTERS: {
      keywords: ["DISASTERS", "DISASTER", "EARTHQUAKE", "FLOOD", "CYCLONE", "TSUNAMI", "VOLCANO", "ALERT", "EMERGENCY"],
      requiresCoords: true
    },

    REVERSE_GEOCODE: {
      // User must explicitly request location name lookup
      keywords: ["ADDRESS", "PLACE", "WHERE", "WHEREAM I", "WHERE AM I"],
      requiresCoords: true
    }
  }
};

// =============================================================================
// =============================  AI PROMPTS  ==================================
// =============================================================================

const AI_CONFIG = {
  PHASE_1_ANALYZE: {
    PROMPT: `ROLE: Emergency expert assistant via satellite text.

CONTEXT:
- User has satellite messenger ONLY
- NO internet, NO phone signal, NO voice
- They cannot look anything up or call anyone
- Your reply may be their only information source

TASK: Answer their question thoroughly and practically.

RULES:
- Give complete, actionable information
- Include specific values (quantities, times, specs) when relevant
- If safety-critical: state warnings and red flags
- NEVER say "look up", "google", "call", "consult manual online"
- If you don't know specifics, say so clearly
- Use METRIC units only: kg, cm, m, km, L, ml, °C, 24hr clock (e.g. 14:00 not 2pm)
- Use simple formatting

YOUR BUILT-IN CAPABILITIES:
- You can automatically search the web (Google Search) when needed
- You can automatically fetch and read web pages when URLs are mentioned
- Use these capabilities proactively to provide accurate, current information

AVAILABLE TOOLS (user can trigger these):
- WIKI term: Wikipedia lookup (e.g., "WIKI snake bite treatment")
- NEWS: Top news headlines
- WEATHER/SUNRISE/DISASTER: Auto-trigger when GPS coordinates are included (via "Send Location" in Garmin)
- NEW: Start a fresh conversation (resets context)

CRITICAL - NO HALLUCINATION:
- ONLY use data explicitly provided in TOOL CONTEXT below or from your built-in search/URL capabilities
- If tool context says "NOT AVAILABLE" or "FAILED", tell user exactly that - do NOT make up data
- Do NOT invent weather, locations, prices, news, or any factual data
- For real-time data (weather, news, prices), use your search capability or provided tool data
- For general knowledge questions without tool data, use your training knowledge

Tool results (if any) appear below:
{{TOOL_CONTEXT}}

OUTPUT: Direct, practical answer. Use search/URL capabilities and provided tool data for accurate info.`,
    TOKENS: 2048,
    TEMP: 0.4
  },

  PHASE_2_COMPRESS: {
    PROMPT_TEMPLATE: `TASK: Compress to telegram/SMS style.

TARGET: {{TARGET}} chars. MAX: {{MAX}} chars.

STYLE:
- Abbreviate aggressively: u, ur, w/, b4, bc, approx, temp, qty, hr, min, filt, eng, chk, amt, prob, req, immed, evac
- Numbers not words: "500ml" not "five hundred ml"
- Slashes for alternatives: "chk/replace", "walk/crawl"
- Drop articles (a, an, the), drop "you should"
- No formatting symbols ** or ##
- Minimize spaces
- Use category labels if multiple topics: IMMED: H2O: SIGNAL: SHELTER: etc
- METRIC units only: kg, cm, m, km, L, ml, °C, 24hr clock

OUTPUT: Compressed telegram-style text only.`,
    TOKENS: 1024,
    TEMP: 0.1
  }
};

// =============================================================================
// =============================    MAIN LOGIC   ===============================
// =============================================================================

/** Debug logging helper - only logs if DEBUG_MODE is true */
function debug(msg) {
  if (SYSTEM.DEBUG_MODE) {
    console.log(msg);
  }
}

function runGateway() {
  debug('[runGateway] Starting execution...');

  const senderQuery = `from:({${SYSTEM.TRUSTED_EMAILS.join(" ")}})`;
  const fullQuery = `${senderQuery} "AI:" ${SYSTEM.SEARCH_WINDOW}`;

  debug(`[runGateway] Search query: ${fullQuery}`);

  const threads = GmailApp.search(fullQuery, 0, 10);
  debug(`[runGateway] Found ${threads.length} threads`);

  if (threads.length === 0) return;

  // Clean up old retry entries periodically (every 10th run)
  if (Math.random() < 0.1) {
    try {
      cleanupOldRetries();
      // Also cleanup expired conversation states
      const stateManager = createInteractionStateManager();
      stateManager.cleanupExpired();
    } catch (cleanupError) {
      console.error(`[runGateway] Cleanup error (non-fatal): ${cleanupError}`);
    }
  }

  // Track processed message IDs in this run to detect retries within same execution
  const processedIds = new Set();

  threads.forEach((thread, threadIndex) => {
    debug(`[runGateway] Processing thread ${threadIndex + 1}/${threads.length}`);

    try {
      const messages = thread.getMessages();
      debug(`[runGateway] Thread has ${messages.length} messages`);

      const lastMsg = messages[messages.length - 1];
      if (!lastMsg) {
        debug(`[runGateway] No last message found, skipping`);
        return;
      }

      // Skip if already successfully processed (starred = done)
      const isStarred = lastMsg.isStarred();
      debug(`[runGateway] Message starred: ${isStarred}`);
      if (isStarred) return;

      const messageId = lastMsg.getId();
      debug(`[runGateway] Message ID: ${messageId.substring(0, 8)}...`);

      // Skip if we've already processed this message in this run
      if (processedIds.has(messageId)) {
        debug(`[runGateway] Message already processed in this run, skipping`);
        return;
      }
      processedIds.add(messageId);
      debug(`[runGateway] Added to processed IDs`);

      // Check retry count before processing
      debug(`[runGateway] Checking retry count...`);
      const retryCount = getRetryCount(messageId);
      debug(`[runGateway] Retry count: ${retryCount}`);

      if (retryCount >= RETRY.MAX_ATTEMPTS) {
        console.log(`[SKIP] Message ${messageId.substring(0, 8)} exceeded max retries (${retryCount})`);
        lastMsg.star();
        clearRetryCount(messageId);
        return;
      }

      debug(`[runGateway] Getting message body...`);
      const body = lastMsg.getPlainBody();
      debug(`[runGateway] Body length: ${body.length}`);

      debug(`[runGateway] Matching Garmin link...`);
      // Support both explore.garmin.com and inreachlink.com formats
      const linkMatch = body.match(/(https:\/\/(?:[a-z0-9\.-]*explore\.garmin\.com\/textmessage\/txtmsg\?[^"\s\n]+|inreachlink\.com\/[^"\s\n]+))/i);
      debug(`[runGateway] Link match: ${linkMatch ? 'found' : 'not found'}`);

    if (!linkMatch) {
      lastMsg.star();
      clearRetryCount(messageId);
      return;
    }

    let targetUrl = linkMatch[1];
    let extractedReplyAddress = null;

    // Extract the recipient address (To: field) - this is the Gmail address that received the email
    // This will be used as the ReplyAddress in the POST request to Garmin
    try {
      const to = lastMsg.getTo();
      debug(`[runGateway] Email To address: ${to}`);
      if (to) {
        // Extract just the email address if it's in format "Name <email@domain.com>"
        const emailMatch = to.match(/<?([^<>\s]+@[^<>\s]+)>?/);
        if (emailMatch) {
          extractedReplyAddress = emailMatch[1].trim();
          debug(`[runGateway] Extracted recipient address: ${extractedReplyAddress}`);
        }
      }
    } catch (e) {
      console.error(`[runGateway] Error extracting recipient address: ${e}`);
    }

    // If it's an inreachlink.com short URL, follow redirect chain manually
    if (targetUrl.indexOf('inreachlink.com') !== -1) {
      debug(`[runGateway] Processing inreachlink.com short URL...`);
      try {
        // Follow redirects manually to capture the final URL
        let currentUrl = targetUrl;
        let redirectCount = 0;
        let maxRedirects = 5;
        let finalExtId = null;

        while (redirectCount < maxRedirects) {
          debug(`[runGateway] Redirect ${redirectCount}: ${currentUrl}`);

          const response = UrlFetchApp.fetch(currentUrl, {
            followRedirects: false,
            muteHttpExceptions: true
          });

          const statusCode = response.getResponseCode();
          debug(`[runGateway] Status code: ${statusCode}`);

          // Check for redirect (3xx status codes)
          if (statusCode >= 300 && statusCode < 400) {
            const location = response.getHeaders()['Location'] || response.getHeaders()['location'];
            if (location) {
              debug(`[runGateway] Redirecting to: ${location.substring(0, 150)}...`);
              currentUrl = location;

              // Check if this is the explore.garmin.com URL with extId
              if (location.indexOf('explore.garmin.com') !== -1) {
                const extIdMatch = location.match(/extId=([^&\s]+)/);
                if (extIdMatch) {
                  finalExtId = extIdMatch[1];
                  debug(`[runGateway] Found extId in redirect: ${finalExtId}`);
                  targetUrl = location;
                  break;
                }
              }
              redirectCount++;
            } else {
              debug(`[runGateway] No Location header, stopping redirect chain`);
              break;
            }
          } else {
            debug(`[runGateway] Non-redirect status, stopping redirect chain`);
            break;
          }
        }

        // Add adr parameter if we have the recipient address and URL doesn't have it
        if (finalExtId && extractedReplyAddress && targetUrl.indexOf('adr=') === -1) {
          targetUrl = targetUrl + '&adr=' + encodeURIComponent(extractedReplyAddress);
          debug(`[runGateway] Added adr parameter to URL`);
        }

        debug(`[runGateway] Final URL: ${targetUrl.substring(0, 150)}...`);
      } catch (e) {
        console.error(`[runGateway] Error processing short URL: ${e}`);
      }
    }

    const rawPrompt = body.split('\n')[0].trim();

    if (!rawPrompt.match(/^(AI|Ai|ai)[:\s]/)) {
      lastMsg.star();
      clearRetryCount(messageId);
      return;
    }

    const userPrompt = rawPrompt.replace(/^(AI|Ai|ai)[:\s]*/, "").trim();

    if (!userPrompt || userPrompt.length < 2) {
      console.log(`[SKIP] Empty or too short prompt`);
      lastMsg.star();
      clearRetryCount(messageId);
      return;
    }

    const coords = extractCoordinates(body);
    const idMatch = targetUrl.match(/extId=([a-zA-Z0-9\-]+)/);
    const logId = idMatch ? idMatch[1].substring(0, 8) : "UNKNOWN";

    console.log(`[${logId}] INGEST (attempt ${retryCount + 1}/${RETRY.MAX_ATTEMPTS}): "${userPrompt}"`);
    if (coords) {
      console.log(`[${logId}] COORDS: ${coords.lat}, ${coords.lon}`);
    }

    try {
      const result = processAndSend(userPrompt, targetUrl, logId, coords);

      if (result.success) {
        lastMsg.star();
        clearRetryCount(messageId);
        console.log(`[${logId}] ✓ COMPLETE: ${result.pages} page(s), ${result.chars} chars`);
      } else if (result.reason === "PHASE1_FAILED" || result.reason === "NO_API_KEY") {
        // Permanent failures - star to mark as processed, error already sent to user
        lastMsg.star();
        clearRetryCount(messageId);
        console.error(`[${logId}] ✗ AI FAILED (permanent): ${result.reason}`);
        handleFailure(logId, userPrompt, result.reason);
      } else {
        // Retryable failures (GEMINI_RETRYABLE, SEND_FAILED, etc.)
        const newRetryCount = incrementRetryCount(messageId);

        if (newRetryCount >= RETRY.MAX_ATTEMPTS) {
          // Hit max retries - star and send error to user
          lastMsg.star();
          clearRetryCount(messageId);
          sendErrorToUser(targetUrl, ERROR_MESSAGES.MAX_RETRIES.code, ERROR_MESSAGES.MAX_RETRIES.message);
          console.error(`[${logId}] ✗ MAX RETRIES REACHED (${newRetryCount})`);
          handleFailure(logId, userPrompt, `MAX_RETRIES:${result.reason}`);
        } else {
          // Leave unstarred - will be retried on next gateway run
          if (result.reason === "GEMINI_RETRYABLE") {
            console.error(`[${logId}] ✗ GEMINI OVERLOADED (retry ${newRetryCount}/${RETRY.MAX_ATTEMPTS})`);
          } else {
            console.error(`[${logId}] ✗ SEND FAILED (retry ${newRetryCount}/${RETRY.MAX_ATTEMPTS}): ${result.reason}`);
          }
        }
      }
    } catch (e) {
      console.error(`[${logId}] EXCEPTION: ${e}`);
      // For exceptions, increment retry count
      const newRetryCount = incrementRetryCount(messageId);

      if (newRetryCount >= RETRY.MAX_ATTEMPTS) {
        // Hit max retries - star and send error to user
        lastMsg.star();
        clearRetryCount(messageId);
        sendErrorToUser(targetUrl, ERROR_MESSAGES.EXCEPTION.code, ERROR_MESSAGES.EXCEPTION.message);
        handleFailure(logId, userPrompt, `EXCEPTION:${e.message || e}`);
      } else {
        // Leave unstarred - will retry
        console.error(`[${logId}] Exception will retry (${newRetryCount}/${RETRY.MAX_ATTEMPTS})`);
      }
    }
    } catch (threadError) {
      console.error(`[runGateway] Error processing thread: ${threadError}`);
      console.error(`[runGateway] Error stack: ${threadError.stack}`);
    }
  });
}

// =============================================================================
// =============================  CORE PIPELINE  ===============================
// =============================================================================

function processAndSend(userPrompt, targetUrl, logId, coords) {
  const key = PropertiesService.getScriptProperties().getProperty('GEMINI_KEY');
  if (!key) {
    sendErrorToUser(targetUrl, ERROR_MESSAGES.NO_API_KEY.code, ERROR_MESSAGES.NO_API_KEY.message);
    return { success: false, reason: "NO_API_KEY" };
  }

  // Initialize interaction state manager
  let stateManager = null;
  let senderKey = null;
  try {
    stateManager = createInteractionStateManager();
    senderKey = extractSenderKey(targetUrl);
    console.log(`[${logId}] Sender key: ${senderKey}`);
  } catch (stateError) {
    console.error(`[${logId}] State manager init error (non-fatal): ${stateError}`);
    // Continue without conversation state if there's an error
  }

  // Check for HELP command (before size extraction to allow "HELP SIZE 600")
  if (isHelpCommand(userPrompt)) {
    const helpText = getHelpText();

    // Check if user specified custom size for help text
    const helpSize = extractSizeOverride(userPrompt);
    if (helpSize) {
      console.log(`[${logId}] HELP with SIZE override: ${helpSize} chars`);
      // Help text will be naturally paginated based on Garmin limits
      // Size override doesn't apply to static help text
    }

    return paginateAndSend(targetUrl, helpText, logId);
  }

  // Extract custom response size if specified
  const sizeOverride = extractSizeOverride(userPrompt);
  let targetLength = LIMITS.AI_TARGET_LENGTH;
  let absoluteMax = LIMITS.AI_ABSOLUTE_MAX;

  if (sizeOverride) {
    // User specified SIZE command - override defaults
    targetLength = Math.min(sizeOverride, 2000); // Cap at 2000 chars
    absoluteMax = Math.min(sizeOverride, 2000);
    console.log(`[${logId}] SIZE OVERRIDE: User requested ${sizeOverride} chars (capped at ${absoluteMax})`);

    // Remove SIZE command from prompt before processing
    userPrompt = userPrompt.replace(/\bSIZE\s+\d+\b/i, "").replace(/\bRESPONSE\s+SIZE\s+\d+\b/i, "").trim();
  }

  console.log(`[${logId}] Running toolbox...`);
  const toolboxResult = runToolbox(userPrompt, coords, logId);

  if (toolboxResult.errors.length > 0) {
    console.log(`[${logId}] Toolbox errors: ${toolboxResult.errors.join(", ")}`);
  }

  console.log(`[${logId}] Phase 1: Analyzing with Interactions API...`);

  // Get previous interaction ID for conversation continuity
  let previousInteractionId = null;
  if (stateManager && senderKey) {
    try {
      previousInteractionId = stateManager.getInteractionId(senderKey, userPrompt);
    } catch (stateError) {
      console.error(`[${logId}] Error getting interaction ID: ${stateError}`);
    }
  }

  // Prepare prompt with tool context
  const promptWithContext = AI_CONFIG.PHASE_1_ANALYZE.PROMPT
    .replace("{{TOOL_CONTEXT}}", toolboxResult.context || "(No additional context)");

  // Create Interactions API client with Google Search and URL Context enabled
  const geminiClient = createGeminiInteractionsClient(key, SYSTEM.MODEL_TAG);

  const analysisResult = geminiClient.call(
    userPrompt,
    promptWithContext,
    {
      maxOutputTokens: AI_CONFIG.PHASE_1_ANALYZE.TOKENS,
      temperature: AI_CONFIG.PHASE_1_ANALYZE.TEMP,
      previousInteractionId: previousInteractionId,
      tools: ['google_search', 'url_context']  // Enable built-in tools
    }
  );

  if (!analysisResult.success) {
    // Log the actual error for debugging
    console.error(`[${logId}] Phase 1 failed: ${analysisResult.error.message}`);

    if (analysisResult.error.retryable) {
      // Don't send error to user - let retry mechanism handle it
      console.log(`[${logId}] Retryable Gemini error, will retry: ${analysisResult.error.message}`);
      return { success: false, reason: "GEMINI_RETRYABLE" };
    } else {
      // Permanent error - send helpful message to user
      sendErrorToUser(targetUrl, ERROR_MESSAGES.AI_PERMANENT_FAIL.code, ERROR_MESSAGES.AI_PERMANENT_FAIL.message);
      return { success: false, reason: "PHASE1_FAILED" };
    }
  }

  // Store interaction ID for next conversation turn
  if (analysisResult.interactionId && stateManager && senderKey) {
    try {
      stateManager.setInteractionId(senderKey, analysisResult.interactionId);
    } catch (stateError) {
      console.error(`[${logId}] Error storing interaction ID: ${stateError}`);
    }
  }

  const analysis = analysisResult.text;
  console.log(`[${logId}] Phase 1 output: ${analysis.length} chars`);

  console.log(`[${logId}] Phase 2: Compressing...`);

  const compressPrompt = AI_CONFIG.PHASE_2_COMPRESS.PROMPT_TEMPLATE
    .replace("{{TARGET}}", targetLength)
    .replace("{{MAX}}", absoluteMax);

  // Phase 2 uses standard client without tools or conversation state
  const compressResult = geminiClient.call(
    analysis,
    compressPrompt,
    {
      maxOutputTokens: AI_CONFIG.PHASE_2_COMPRESS.TOKENS,
      temperature: AI_CONFIG.PHASE_2_COMPRESS.TEMP,
      previousInteractionId: null,  // No conversation state for compression
      tools: []  // No tools needed for compression
    }
  );

  let compressed;
  if (!compressResult.success) {
    // Phase 2 failure is not critical - we can use Phase 1 text
    console.log(`[${logId}] Phase 2 failed: ${compressResult.error.message}, using truncated Phase 1`);
    compressed = truncateSmart(analysis, absoluteMax);
  } else {
    compressed = compressResult.text;
  }

  let finalText = cleanOutput(compressed);

  if (finalText.length > absoluteMax) {
    console.log(`[${logId}] Over absolute max (${finalText.length}), truncating...`);
    finalText = truncateSmart(finalText, absoluteMax);
  }

  console.log(`[${logId}] FINAL: ${finalText.length} chars`);
  console.log(`[${logId}] TEXT: "${finalText}"`);

  return paginateAndSend(targetUrl, finalText, logId);
}

// =============================================================================
// =============================    TOOLBOX    =================================
// =============================================================================

/**
 * Main toolbox dispatcher
 * NOW USES REFACTORED TOOLS via factory functions
 */
function runToolbox(userPrompt, coords, logId) {
  const result = {
    context: "",
    errors: []
  };

  const upperPrompt = userPrompt.toUpperCase();
  let contextParts = [];

  console.log(`[${logId}] TOOLBOX: Analyzing query for tool triggers...`);
  console.log(`[${logId}] TOOLBOX: Coords=${coords ? `${coords.lat},${coords.lon}` : "none"}`);

  // 1. WIKIPEDIA - Using refactored tool and centralized triggers
  const wikiMatch = userPrompt.match(TOOLBOX_CONFIG.TRIGGERS.WIKIPEDIA);
  if (wikiMatch) {
    const term = wikiMatch[1].trim();
    console.log(`[${logId}] TOOLBOX: Triggered WIKI for "${term}"`);
    try {
      const wikiTool = createWikipediaTool();
      const wikiResult = wikiTool.fetch(term, logId);
      if (wikiResult.success) {
        contextParts.push(`[WIKIPEDIA: ${term}]\n${wikiResult.data}`);
      } else {
        result.errors.push(`WIKI:${wikiResult.error}`);
        contextParts.push(`[WIKIPEDIA: ${term}] NOT AVAILABLE - ${wikiResult.error}`);
      }
    } catch (e) {
      console.error(`[${logId}] TOOLBOX: Wikipedia tool error: ${e}`);
      result.errors.push(`WIKI:Tool initialization failed`);
      contextParts.push(`[WIKIPEDIA: ${term}] NOT AVAILABLE - Tool error`);
    }
  }

  // NOTE: SEARCH and BROWSE/URL tools are now handled automatically by Gemini's
  // built-in Google Search and URL Context capabilities - no manual triggers needed


  // 3. NEWS - Using refactored tool and centralized triggers
  const newsPattern = new RegExp('\\b(' + TOOLBOX_CONFIG.TRIGGERS.NEWS.keywords.join('|') + ')\\b', 'i');
  if (newsPattern.test(upperPrompt)) {
    console.log(`[${logId}] TOOLBOX: Triggered NEWS`);
    try {
      const newsTool = createNewsTool();
      const newsResult = newsTool.fetch(logId);
      if (newsResult.success) {
        contextParts.push(`[NEWS HEADLINES]\n${newsResult.data}`);
      } else {
        result.errors.push(`NEWS:${newsResult.error}`);
        contextParts.push(`[NEWS] NOT AVAILABLE - tool error`);
      }
    } catch (e) {
      console.error(`[${logId}] TOOLBOX: News tool error: ${e}`);
      result.errors.push(`NEWS:Tool initialization failed`);
      contextParts.push(`[NEWS] NOT AVAILABLE - Tool error`);
    }
  }

  // 4. LOCATION-BASED TOOLS (if coordinates available)
  if (coords && coords.lat && coords.lon) {
    console.log(`[${logId}] TOOLBOX: Coords available: ${coords.lat}, ${coords.lon}`);

    // 4a. Location info - always show coordinates
    contextParts.push(`[LOCATION]\nCoordinates: ${coords.lat}, ${coords.lon}`);

    // 4b. Reverse geocode - only if user asks for location name
    const reverseGeocodePattern = new RegExp('\\b(' + TOOLBOX_CONFIG.TRIGGERS.REVERSE_GEOCODE.keywords.join('|') + ')\\b', 'i');
    if (reverseGeocodePattern.test(upperPrompt)) {
      console.log(`[${logId}] TOOLBOX: Triggered REVERSE_GEOCODE`);
      try {
        const reverseGeocodeTool = createReverseGeocodeTool();
        const locationResult = reverseGeocodeTool.fetch(coords.lat, coords.lon, logId);
        if (locationResult.success) {
          contextParts.push(`[LOCATION NAME]\n${locationResult.data}`);
        } else {
          result.errors.push(`REVERSE_GEOCODE:${locationResult.error}`);
          contextParts.push(`[LOCATION NAME] NOT AVAILABLE - ${locationResult.error}`);
        }
      } catch (e) {
        console.error(`[${logId}] TOOLBOX: Reverse geocode tool error: ${e}`);
        result.errors.push(`REVERSE_GEOCODE:Tool initialization failed`);
        contextParts.push(`[LOCATION NAME] NOT AVAILABLE - Tool error`);
      }
    }

    // 4c. Weather & Astronomy - Combined call using wttr.in
    const weatherPattern = new RegExp('\\b(' + TOOLBOX_CONFIG.TRIGGERS.WEATHER.keywords.join('|') + ')\\b', 'i');
    const astroPattern = new RegExp('\\b(' + TOOLBOX_CONFIG.TRIGGERS.ASTRONOMY.keywords.join('|') + ')\\b', 'i');
    const fullWeatherPattern = new RegExp('\\b(' + TOOLBOX_CONFIG.TRIGGERS.FULL_WEATHER.keywords.join('|') + ')\\b', 'i');
    const needsWeather = weatherPattern.test(upperPrompt);
    const needsAstronomy = astroPattern.test(upperPrompt);
    const needsFullWeather = fullWeatherPattern.test(upperPrompt);

    if (needsWeather || needsAstronomy || needsFullWeather) {
      const mode = needsFullWeather ? 'FULL_WEATHER' : (needsAstronomy ? 'WEATHER+ASTRONOMY' : 'WEATHER');
      console.log(`[${logId}] TOOLBOX: Triggered ${mode}`);
      try {
        const weatherTool = createWeatherTool();
        const weatherResult = weatherTool.fetch(coords.lat, coords.lon, logId, needsAstronomy || needsFullWeather);

        if (weatherResult.success) {
          if (needsFullWeather && weatherResult.rawJson) {
            // Full weather mode - provide complete API response for AI analysis
            const fullData = JSON.stringify(weatherResult.rawJson, null, 2);
            contextParts.push(`[FULL WEATHER DATA]
Complete weather API response for AI analysis.
Available data includes:
- Current conditions (temp, feels-like, humidity, wind, precipitation, pressure, visibility, UV index, weather description)
- 3-day forecast (daily highs/lows, hourly conditions, rain/snow chances)
- Astronomy (sunrise, sunset, moonrise, moonset, moon phase, moon illumination)
- Nearest location info

Raw JSON:
${fullData}`);
          } else {
            // Standard mode - provide formatted summaries
            if (needsWeather && weatherResult.data) {
              contextParts.push(`[WEATHER FORECAST]\n${weatherResult.data}`);
            }
            if (needsAstronomy && weatherResult.astronomy) {
              contextParts.push(`[ASTRONOMY]\n${weatherResult.astronomy}`);
            }
          }
        } else {
          if (needsFullWeather) {
            result.errors.push(`FULL_WEATHER:${weatherResult.error}`);
            contextParts.push(`[FULL WEATHER DATA] NOT AVAILABLE - ${weatherResult.error}`);
          } else {
            if (needsWeather) {
              result.errors.push(`WEATHER:${weatherResult.error}`);
              contextParts.push(`[WEATHER] NOT AVAILABLE - ${weatherResult.error}`);
            }
            if (needsAstronomy) {
              result.errors.push(`ASTRO:${weatherResult.error}`);
              contextParts.push(`[ASTRONOMY] NOT AVAILABLE - ${weatherResult.error}`);
            }
          }
        }
      } catch (e) {
        console.error(`[${logId}] TOOLBOX: Weather tool error: ${e}`);
        if (needsFullWeather) {
          result.errors.push(`FULL_WEATHER:Tool initialization failed`);
          contextParts.push(`[FULL WEATHER DATA] NOT AVAILABLE - Tool error`);
        } else {
          if (needsWeather) {
            result.errors.push(`WEATHER:Tool initialization failed`);
            contextParts.push(`[WEATHER] NOT AVAILABLE - Tool error`);
          }
          if (needsAstronomy) {
            result.errors.push(`ASTRO:Tool initialization failed`);
            contextParts.push(`[ASTRONOMY] NOT AVAILABLE - Tool error`);
          }
        }
      }
    }

    // 4e. GDACS Disaster Alerts - Using refactored tool and centralized triggers
    const disasterPattern = new RegExp('\\b(' + TOOLBOX_CONFIG.TRIGGERS.DISASTERS.keywords.join('|') + ')\\b', 'i');
    if (disasterPattern.test(upperPrompt)) {
      console.log(`[${logId}] TOOLBOX: Triggered GDACS`);
      try {
        const gdacsTool = createGdacsTool();
        const disasterResult = gdacsTool.fetchNearby(coords.lat, coords.lon, logId);
        if (disasterResult.success && disasterResult.data) {
          contextParts.push(`[DISASTER ALERTS]\n${disasterResult.data}`);
        } else if (disasterResult.success && !disasterResult.data) {
          contextParts.push(`[DISASTER ALERTS]\nNo significant alerts within 500km of your location.`);
        } else {
          result.errors.push(`GDACS:${disasterResult.error}`);
          contextParts.push(`[DISASTER ALERTS] NOT AVAILABLE - tool error`);
        }
      } catch (e) {
        console.error(`[${logId}] TOOLBOX: GDACS tool error: ${e}`);
        result.errors.push(`GDACS:Tool initialization failed`);
        contextParts.push(`[DISASTER ALERTS] NOT AVAILABLE - Tool error`);
      }
    }
  } else {
    console.log(`[${logId}] TOOLBOX: No coordinates available`);
    // Check for reverse geocode keywords using centralized config
    const reverseGeocodePattern = new RegExp('\\b(' + TOOLBOX_CONFIG.TRIGGERS.REVERSE_GEOCODE.keywords.join('|') + ')\\b', 'i');
    if (reverseGeocodePattern.test(upperPrompt)) {
      contextParts.push(`[LOCATION NAME] NOT AVAILABLE - no GPS coordinates. Enable "Send Location" in Garmin message settings.`);
    }
    // Check for weather/astronomy keywords using centralized config
    const weatherPattern = new RegExp('\\b(' + TOOLBOX_CONFIG.TRIGGERS.WEATHER.keywords.join('|') + ')\\b', 'i');
    const astroPattern = new RegExp('\\b(' + TOOLBOX_CONFIG.TRIGGERS.ASTRONOMY.keywords.join('|') + ')\\b', 'i');
    const fullWeatherPattern = new RegExp('\\b(' + TOOLBOX_CONFIG.TRIGGERS.FULL_WEATHER.keywords.join('|') + ')\\b', 'i');
    if (weatherPattern.test(upperPrompt)) {
      contextParts.push(`[WEATHER] NOT AVAILABLE - no GPS coordinates. Try: SEARCH weather [your location]`);
    }
    if (astroPattern.test(upperPrompt)) {
      contextParts.push(`[ASTRONOMY] NOT AVAILABLE - no GPS coordinates. Include coords or try: SEARCH sunrise [location]`);
    }
    if (fullWeatherPattern.test(upperPrompt)) {
      contextParts.push(`[FULL WEATHER DATA] NOT AVAILABLE - no GPS coordinates. Enable "Send Location" in Garmin message settings.`);
    }
    // Check for disaster keywords using centralized config
    const disasterPattern = new RegExp('\\b(' + TOOLBOX_CONFIG.TRIGGERS.DISASTERS.keywords.join('|') + ')\\b', 'i');
    if (disasterPattern.test(upperPrompt)) {
      contextParts.push(`[DISASTER ALERTS] NOT AVAILABLE - no GPS coordinates in message`);
    }
  }

  if (result.errors.length > 0) {
    const failedTools = result.errors.map(e => {
      const [tool, error] = e.split(':');
      return `${tool}: FAILED (${error})`;
    }).join(', ');
    contextParts.push(`[TOOL FAILURES]\nThe following tools failed and have NO DATA: ${failedTools}\nDo NOT make up or guess this information - tell user the tool failed.`);
  }

  result.context = contextParts.join("\n\n");
  return result;
}

// =============================================================================
// =======================  ERROR MESSAGING TO USER  ===========================
// =============================================================================

/**
 * Send an error message back to the user via Garmin
 * This provides visibility when things go wrong
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

// =============================================================================
// =============================  COORDINATE EXTRACTION  =======================
// =============================================================================

/**
 * Extract coordinates from Garmin email body
 * Garmin includes location when "Send Location" is enabled in the message settings
 * Format: "...sent this message from: Lat 45.344227 Lon -122.236868"
 *
 * @param {string} body - Email body text
 * @returns {Object|null} - {lat, lon} object or null if no coordinates found
 */
function extractCoordinates(body) {
  // Pattern 1: "Lat X.XXX Lon Y.YYY" - Standard Garmin format when location sharing is enabled
  let match = body.match(/Lat(?:itude)?[:\s]+(-?\d+\.?\d*)[°\s,]+(?:Lon(?:gitude)?[:\s]+)?(-?\d+\.?\d*)/i);
  if (match) {
    return { lat: parseFloat(match[1]), lon: parseFloat(match[2]) };
  }

  // Pattern 2: Decimal degrees in parentheses "(X.XXX, Y.YYY)"
  // Note: Be careful as this could match other number pairs
  match = body.match(/\((-?\d+\.?\d*)\s*,\s*(-?\d+\.?\d*)\)/);
  if (match) {
    const lat = parseFloat(match[1]);
    const lon = parseFloat(match[2]);
    // Sanity check - lat should be -90 to 90, lon -180 to 180
    if (Math.abs(lat) <= 90 && Math.abs(lon) <= 180) {
      return { lat: lat, lon: lon };
    }
  }

  // Pattern 3: Google Maps URL (if user manually includes one)
  match = body.match(/maps\.google\.com[^\s]*[@\/](-?\d+\.?\d*),(-?\d+\.?\d*)/);
  if (match) {
    return { lat: parseFloat(match[1]), lon: parseFloat(match[2]) };
  }

  // Most Garmin messages won't have coordinates
  return null;
}

// =============================================================================
// =============================  PAGING ENGINE  ===============================
// =============================================================================

function paginateAndSend(url, text, logId) {
  if (text.length <= LIMITS.GARMIN_SAFE_MAX) {
    const success = postToGarmin(url, text);
    return {
      success: success,
      reason: success ? null : "SEND_FAILED",
      pages: 1,
      chars: text.length
    };
  }

  let chunks = splitForPaging(text, LIMITS.CHUNK_PAYLOAD);

  if (chunks.length > LIMITS.MAX_PAGES) {
    console.log(`[${logId}] WARNING: ${chunks.length} chunks exceeds MAX_PAGES (${LIMITS.MAX_PAGES}), truncating`);
    chunks = chunks.slice(0, LIMITS.MAX_PAGES);
    const lastIdx = chunks.length - 1;
    if (chunks[lastIdx].length < LIMITS.CHUNK_PAYLOAD - 5) {
      chunks[lastIdx] += " [...]";
    }
  }

  const total = chunks.length;
  console.log(`[${logId}] PAGING: ${text.length} chars -> ${total} chunks`);

  for (let i = 0; i < total; i++) {
    const prefix = `${i + 1}/${total} `;
    const payload = prefix + chunks[i];

    console.log(`[${logId}] Sending ${i + 1}/${total}: "${payload.substring(0, 50)}..."`);

    const success = postToGarmin(url, payload);
    if (!success) {
      return {
        success: false,
        reason: `CHUNK_${i + 1}_FAILED`,
        pages: total,
        chars: text.length
      };
    }

    if (i < total - 1) {
      Utilities.sleep(LIMITS.PAGE_DELAY_MS);
    }
  }

  return {
    success: true,
    reason: null,
    pages: total,
    chars: text.length
  };
}

function splitForPaging(text, maxChunkLen) {
  const chunks = [];
  let remaining = text.trim();

  while (remaining.length > maxChunkLen) {
    let splitPoint = findSplitPoint(remaining, maxChunkLen);
    chunks.push(remaining.substring(0, splitPoint).trim());
    remaining = remaining.substring(splitPoint).trim();
  }

  if (remaining.length > 0) {
    chunks.push(remaining);
  }

  return chunks;
}

function findSplitPoint(text, limit) {
  const searchRange = text.substring(0, limit);

  const sentenceMatch = searchRange.match(/.*[.!?](?=\s|$)/);
  if (sentenceMatch && sentenceMatch[0].length > limit * 0.5) {
    return sentenceMatch[0].length;
  }

  const clauseIdx = Math.max(
    searchRange.lastIndexOf(", "),
    searchRange.lastIndexOf("; "),
    searchRange.lastIndexOf(": ")
  );
  if (clauseIdx > limit * 0.5) {
    return clauseIdx + 1;
  }

  const spaceIdx = searchRange.lastIndexOf(" ");
  if (spaceIdx > limit * 0.5) {
    return spaceIdx;
  }

  return limit;
}

// =============================================================================
// ============================  GARMIN POSTING  ===============================
// =============================================================================

/**
 * Extract form values from Garmin page HTML
 * The page contains hidden form fields with the actual Guid, MessageId, and ReplyAddress
 *
 * @param {string} pageUrl - URL of the Garmin message page
 * @returns {Object|null} - {guid, messageId, replyAddress} or null if extraction fails
 */
function extractGarminFormValues(pageUrl) {
  try {
    debug(`[Garmin] Fetching page to extract form values...`);

    const response = UrlFetchApp.fetch(pageUrl, {
      method: 'get',
      headers: {
        'User-Agent': GARMIN.USER_AGENT,
        'Accept': 'text/html,application/xhtml+xml'
      },
      muteHttpExceptions: true,
      followRedirects: true
    });

    const statusCode = response.getResponseCode();
    if (statusCode !== 200) {
      console.error(`[Garmin] Page fetch failed with status ${statusCode}`);
      return null;
    }

    const html = response.getContentText();
    debug(`[Garmin] Page fetched, ${html.length} chars`);

    // Extract Guid from hidden input: <input id="Guid" name="Guid" type="hidden" value="..." />
    const guidMatch = html.match(/name="Guid"[^>]*value="([^"]+)"/i) ||
                      html.match(/id="Guid"[^>]*value="([^"]+)"/i) ||
                      html.match(/value="([^"]+)"[^>]*name="Guid"/i);

    // Extract MessageId from hidden input: <input id="MessageId" name="MessageId" type="hidden" value="..." />
    const messageIdMatch = html.match(/name="MessageId"[^>]*value="([^"]+)"/i) ||
                           html.match(/id="MessageId"[^>]*value="([^"]+)"/i) ||
                           html.match(/value="([^"]+)"[^>]*name="MessageId"/i);

    // Extract ReplyAddress from input: <input id="ReplyAddress" ... value="..." />
    const replyAddressMatch = html.match(/id="ReplyAddress"[^>]*value="([^"]+)"/i) ||
                              html.match(/name="ReplyAddress"[^>]*value="([^"]+)"/i);

    if (!guidMatch) {
      console.error(`[Garmin] Could not extract Guid from page`);
      // Log a snippet of HTML around where Guid should be for debugging
      const guidIndex = html.indexOf('Guid');
      if (guidIndex > -1) {
        console.log(`[Garmin] HTML near 'Guid': ${html.substring(Math.max(0, guidIndex - 50), guidIndex + 200)}`);
      }
      return null;
    }

    if (!messageIdMatch) {
      console.error(`[Garmin] Could not extract MessageId from page`);
      return null;
    }

    const result = {
      guid: guidMatch[1],
      messageId: messageIdMatch[1],
      replyAddress: replyAddressMatch ? replyAddressMatch[1] : null
    };

    debug(`[Garmin] Extracted - Guid: ${result.guid}, MessageId: ${result.messageId}, ReplyAddress: ${result.replyAddress || 'not found'}`);

    return result;
  } catch (e) {
    console.error(`[Garmin] Exception fetching page: ${e}`);
    return null;
  }
}

function postToGarmin(url, message) {
  if (SYSTEM.SIMULATE_GARMIN) {
    console.log(`[SIM] POST: "${message}"`);
    return true;
  }

  try {
    debug(`[Garmin] Processing URL: ${url.substring(0, 150)}...`);

    // Extract the page URL (without adr parameter we added)
    const pageUrl = url.split('&adr=')[0];

    // Fetch the page and extract the actual form values
    let formValues = extractGarminFormValues(pageUrl);

    if (!formValues) {
      console.error(`[Garmin] Failed to extract form values from page`);

      // Fallback to old behavior for backwards compatibility
      debug(`[Garmin] Trying fallback with URL parameters...`);
      const extIdMatch = url.match(/extId=([a-zA-Z0-9\-_]+)/);
      const adrMatch = url.match(/adr=([^&\s]+)/);

      if (!extIdMatch || !adrMatch) {
        console.error(`[Garmin] Fallback failed - missing URL params`);
        return false;
      }

      // Use fallback values (may not work with new URL format)
      formValues = {
        guid: extIdMatch[1],
        messageId: String(Math.floor(Date.now() / 1000)),
        replyAddress: decodeURIComponent(adrMatch[1])
      };
      debug(`[Garmin] Using fallback values`);
    }

    // Get reply address from URL if not extracted from page
    let replyAddress = formValues.replyAddress;
    if (!replyAddress) {
      const adrMatch = url.match(/adr=([^&\s]+)/);
      if (adrMatch) {
        replyAddress = decodeURIComponent(adrMatch[1]);
        debug(`[Garmin] Using ReplyAddress from URL: ${replyAddress}`);
      }
    }

    if (!replyAddress) {
      console.error(`[Garmin] No ReplyAddress available`);
      return false;
    }

    const payload = {
      'Guid': formValues.guid,
      'ReplyAddress': replyAddress,
      'MessageId': formValues.messageId,
      'ReplyMessage': message
    };

    const domainMatch = url.match(/https:\/\/[^\/]+/);
    const postUrl = domainMatch[0] + GARMIN.ENDPOINT_SUFFIX;

    debug(`[Garmin] Payload: ${JSON.stringify(payload)}`);
    debug(`[Garmin] POST URL: ${postUrl}`);

    const response = UrlFetchApp.fetch(postUrl, {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify(payload),
      followRedirects: true,
      headers: {
        'User-Agent': GARMIN.USER_AGENT,
        'Accept': '*/*',
        'Referer': pageUrl,
        'Origin': domainMatch[0],
        'X-Requested-With': 'XMLHttpRequest'
      },
      muteHttpExceptions: true
    });

    debug(`[Garmin] Response code: ${response.getResponseCode()}`);

    const code = response.getResponseCode();
    if (code !== 200) {
      const responseText = response.getContentText();
      console.error(`[Garmin] HTTP ${code}: ${responseText.substring(0, 200)}`);

      // Try to parse error response for more details
      try {
        const errorJson = JSON.parse(responseText);
        if (errorJson.message) {
          console.error(`[Garmin] Error message: ${errorJson.message}`);
        }
      } catch (e) {
        // Not JSON, ignore
      }

      return false;
    }

    // Check for success in response body
    const responseText = response.getContentText();
    try {
      const responseJson = JSON.parse(responseText);
      if (responseJson.Success === true || responseJson.success === true) {
        debug(`[Garmin] POST successful`);
        return true;
      } else if (responseJson.error === true) {
        console.error(`[Garmin] API returned error: ${responseJson.message || 'unknown'}`);
        return false;
      }
    } catch (e) {
      // Not JSON response, but status was 200, consider success
    }

    return true;
  } catch (e) {
    console.error(`[Garmin] Exception: ${e}`);
    return false;
  }
}

// =============================================================================
// =============================  AI INTERFACE  ================================
// =============================================================================

// NOTE: AI interface moved to GeminiInteractionsClient.gs.js
// Uses the Interactions API with built-in Google Search and URL Context tools

// =============================================================================
// =============================    UTILITIES    ===============================
// =============================================================================

/**
 * Get retry count for a message using Script Properties
 * Format: RETRY_{messageId} = {count: N, timestamp: T}
 */
function getRetryCount(messageId) {
  const props = PropertiesService.getScriptProperties();
  const key = `RETRY_${messageId}`;
  const data = props.getProperty(key);

  if (!data) return 0;

  try {
    const parsed = JSON.parse(data);
    return parsed.count || 0;
  } catch (e) {
    return 0;
  }
}

/**
 * Increment retry count for a message
 */
function incrementRetryCount(messageId) {
  const props = PropertiesService.getScriptProperties();
  const key = `RETRY_${messageId}`;
  const currentCount = getRetryCount(messageId);
  const newCount = currentCount + 1;

  const data = JSON.stringify({
    count: newCount,
    timestamp: Date.now()
  });

  props.setProperty(key, data);
  console.log(`[RETRY] Message ${messageId.substring(0, 8)} attempt ${newCount}/${RETRY.MAX_ATTEMPTS}`);
  return newCount;
}

/**
 * Clear retry count for a message (success or permanent failure)
 */
function clearRetryCount(messageId) {
  const props = PropertiesService.getScriptProperties();
  const key = `RETRY_${messageId}`;
  props.deleteProperty(key);
}

/**
 * Clean up old retry entries (older than 7 days)
 * Call this periodically to prevent property store bloat
 */
function cleanupOldRetries() {
  const props = PropertiesService.getScriptProperties();
  const allProps = props.getProperties();
  const sevenDaysAgo = Date.now() - (7 * 24 * 60 * 60 * 1000);
  let cleaned = 0;

  for (const key in allProps) {
    if (key.startsWith('RETRY_')) {
      try {
        const data = JSON.parse(allProps[key]);
        if (data.timestamp && data.timestamp < sevenDaysAgo) {
          props.deleteProperty(key);
          cleaned++;
        }
      } catch (e) {
        // Invalid data, delete it
        props.deleteProperty(key);
        cleaned++;
      }
    }
  }

  if (cleaned > 0) {
    console.log(`[CLEANUP] Removed ${cleaned} old retry entries`);
  }
}

function cleanOutput(text) {
  if (!text) return "";

  return text
    .replace(/\*\*/g, "")
    .replace(/\*/g, "")
    .replace(/#{1,6}\s/g, "")
    .replace(/`/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/^\s+|\s+$/g, "")
    .replace(/\s{2,}/g, " ");
}

function truncateSmart(text, limit) {
  if (text.length <= limit) return text;

  const truncated = text.substring(0, limit);

  const sentenceEnd = truncated.match(/.*[.!?]/);
  if (sentenceEnd && sentenceEnd[0].length > limit * 0.7) {
    return sentenceEnd[0];
  }

  const lastSpace = truncated.lastIndexOf(" ");
  if (lastSpace > limit * 0.7) {
    return truncated.substring(0, lastSpace) + "...";
  }

  return truncated.substring(0, limit - 3) + "...";
}

function handleFailure(logId, prompt, reason) {
  console.error(`[${logId}] FAILURE LOGGED: ${reason}`);

  if (SYSTEM.ALERT_EMAIL && SYSTEM.ALERT_EMAIL.length > 0) {
    try {
      MailApp.sendEmail({
        to: SYSTEM.ALERT_EMAIL,
        subject: `[SAT-COM] Gateway Failure: ${logId}`,
        body: `Log ID: ${logId}\nReason: ${reason}\nPrompt: ${prompt}\nTime: ${new Date().toISOString()}`
      });
    } catch (e) {
      console.error(`[Alert] Email failed: ${e}`);
    }
  }
}

/**
 * Check if user is requesting help
 * Supports exact matches and "HELP" at the start of prompt
 */
function isHelpCommand(prompt) {
  const upperPrompt = prompt.toUpperCase().trim();

  // Exact matches
  if (upperPrompt === "HELP" ||
      upperPrompt === "?" ||
      upperPrompt === "HELP ME" ||
      upperPrompt === "COMMANDS" ||
      upperPrompt === "LIST TOOLS" ||
      upperPrompt === "TOOLS" ||
      upperPrompt === "HOW TO USE" ||
      upperPrompt === "HOW TO USE YOU" ||
      upperPrompt === "WHAT CAN YOU DO") {
    return true;
  }

  // Check if starts with HELP (allows "HELP SIZE 600", "help", etc.)
  if (upperPrompt.match(/^HELP\b/)) {
    return true;
  }

  return false;
}

/**
 * Get help text listing all available tools and commands
 */
function getHelpText() {
  return `SAT-COM AI GATEWAY

AUTO FEATURES:
- Web search (automatic)
- URL reading (automatic)
- Conversation memory (24hrs)

MANUAL TOOLS:
WIKI term
NEWS
ADDRESS (needs GPS*)
WEATHER (needs GPS*)
SUNRISE/SUNSET (needs GPS*)
FULL-WEATHER (needs GPS*)
DISASTERS (needs GPS*)
NEW (fresh conversation)
HELP
SIZE num

*GPS=location enabled

FULL-WEATHER: UV, visibility, pressure, moon phase, hourly forecast, etc

USAGE: AI: your question
`;
}

/**
 * Extract custom response size from user prompt
 * Supports: "SIZE 800" or "RESPONSE SIZE 800"
 * Returns null if no size specified
 */
function extractSizeOverride(prompt) {
  // Match "SIZE 800" or "RESPONSE SIZE 800"
  const sizeMatch = prompt.match(/\b(?:RESPONSE\s+)?SIZE\s+(\d+)\b/i);
  if (sizeMatch) {
    const size = parseInt(sizeMatch[1], 10);
    if (!isNaN(size) && size > 0) {
      return size;
    }
  }
  return null;
}

