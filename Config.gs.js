/**
 * Central configuration for the Garmin AI Gateway.
 *
 * Everything tunable lives here. No other file should declare top-level
 * constants, and nothing here may reference a constant from another file at
 * load time (Apps Script shares one global scope but file order is not
 * guaranteed).
 */

const SYSTEM = {
  TRUSTED_EMAILS: ["no.reply.inreach@garmin.com"],
  MODEL_TAG: "gemini-flash-latest",
  SEARCH_WINDOW: "newer_than:2d",
  SIMULATE_GARMIN: false,  // Production mode - messages sent to Garmin
  DEBUG_MODE: false,       // Set to true for verbose logging

  ALERT_EMAIL: null,

  // Auto-start a new conversation after this period of silence
  CONVERSATION_EXPIRY_HOURS: 24,

  // Gmail threads to inspect per run
  MAX_THREADS_PER_RUN: 10,

  // Apps Script kills an execution at 6 minutes. Stop taking on new work
  // before that so paging can checkpoint instead of being killed mid-send.
  EXECUTION_BUDGET_MS: 4.5 * 60 * 1000
};

const GARMIN = {
  // Legacy explore.garmin.com reply form. Garmin retired this in 2026; it is
  // kept only for links issued before the Garmin Messenger migration.
  ENDPOINT_SUFFIX: "/TextMessage/TxtMsg",

  // Garmin Messenger, the current reply surface. Replies are delivered by
  // calling the `sendReplyAction(tinyUrlId, messageText)` React Server Action
  // on https://messenger.garmin.com/web/reply/<tinyUrlId>.
  MESSENGER_ORIGIN: "https://messenger.garmin.com",

  // Server Action ids are content hashes that change on every Garmin front-end
  // deploy. GarminClient rediscovers the live id from the route's JS chunk on
  // each session and only uses this pinned value if discovery fails.
  SEND_REPLY_ACTION_ID: "60e0518dd113775ab471a769fddd3860d84bad10e6",

  // The Messenger composer caps a reply at 160 characters.
  MAX_MESSAGE_CHARS: 160,

  USER_AGENT: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36"
};

const LIMITS = {
  // inReach accepts 160 characters inbound; stay under it including the
  // "3/7 " page prefix, which is subtracted at paging time (see Pager.gs.js).
  GARMIN_SAFE_MAX: 155,

  // Response length budget. Every 155 characters costs one satellite message
  // off the user's plan, so this is a quota decision as much as a UX one.
  AI_TARGET_LENGTH: 350,
  AI_ABSOLUTE_MAX: 700,

  // Ceiling for an explicit "SIZE 1200" override
  SIZE_OVERRIDE_MAX: 2000,

  // Safety valve; with SIZE_OVERRIDE_MAX this is never reached organically
  MAX_PAGES: 16,

  // Pacing between pages, and per-page delivery retries
  PAGE_DELAY_MS: 5000,
  PAGE_SEND_ATTEMPTS: 3,
  PAGE_RETRY_BACKOFF_MS: 3000,

  // Unsent page sessions older than this are abandoned
  PAGE_SESSION_TTL_MS: 6 * 60 * 60 * 1000
};

const RETRY = {
  MAX_ATTEMPTS: 3,
  ENTRY_TTL_MS: 7 * 24 * 60 * 60 * 1000
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
  USER_AGENT: "SatComGateway/17.0 (satellite-emergency-assistant)",

  // Timeout for API calls (ms)
  FETCH_TIMEOUT_MS: 15000,

  // GDACS - Global Disaster Alert and Coordination System
  GDACS: {
    RSS_URL: "https://www.gdacs.org/xml/rss.xml",
    ALERT_RADIUS_KM: 500,
    MIN_ALERT_LEVEL: "Orange"
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
      keywords: ["NEWS", "HEADLINE", "HEADLINES", "CURRENT EVENTS"],
      requiresCoords: false
    },

    WEATHER: {
      // Narrowed to specific weather-related terms only.
      // Generic words (TEMP, WIND, COLD, HOT, HUMID) were removed because they
      // fired on historical and general-knowledge questions.
      keywords: ["WEATHER", "FORECAST", "RAIN", "STORM"],
      requiresCoords: true
    },

    ASTRONOMY: {
      keywords: ["SUNRISE", "SUNSET", "MOON", "MOONRISE", "MOONSET", "DAYLIGHT"],
      requiresCoords: true
    },

    FULL_WEATHER: {
      // Comprehensive weather data - full API response for AI analysis
      keywords: ["FULL-WEATHER", "FULL_WEATHER", "FULL WEATHER"],
      requiresCoords: true
    },

    DISASTERS: {
      keywords: ["DISASTERS", "DISASTER", "EARTHQUAKE", "CYCLONE", "TSUNAMI", "VOLCANO", "GDACS"],
      requiresCoords: true
    },

    REVERSE_GEOCODE: {
      keywords: ["WHERE AM I", "WHEREAM I", "MY LOCATION", "LOCATION NAME", "WHAT PLACE IS THIS"],
      requiresCoords: true
    }
  }
};

// =============================================================================
// =============================  AI PROMPTS  ==================================
// =============================================================================

/**
 * The gateway answers in a single call, with the length budget baked into the
 * prompt. A second SHRINK call runs only when the answer overshoots the hard
 * maximum - see Code.js:generateReply.
 *
 * Character budgets are also expressed in words, because models estimate word
 * counts far better than character counts.
 */
const AI_CONFIG = {
  ANSWER: {
    PROMPT: `ROLE: Expert assistant reached over a one-way satellite text link.

SITUATION
- The user carries a satellite messenger and nothing else.
- No internet, no phone signal, no voice, no way to look anything up.
- Your reply may be the only information they get. Treat it as the whole answer.

LENGTH BUDGET
- Aim for about {{TARGET}} characters (roughly {{TARGET_WORDS}} words).
- Never exceed {{MAX}} characters (about {{MAX_WORDS}} words).
- The reply is split into 155-character pages and each page costs one satellite
  message off the user's plan. Spend characters on content, not on politeness.

WRITING STYLE - THIS IS THE PART THAT USUALLY GOES WRONG
- Write plain, readable English in ordinary sentences. Short sentences are good;
  fragments and word-salad are not.
- Do NOT write in telegram or SMS style. Do NOT invent abbreviations.
    Wrong: "chk oil lvl, repl filt, immed evac if temp >39C"
    Right: "Check the oil level, then replace the filter. Evacuate if temperature goes above 39C."
- Standard short forms are fine: min, hr, km, kg, L, ml, mm, C.
- No preamble, no sign-off, no restating the question, no "I hope this helps".
- When order matters, number the steps: 1. 2. 3.
- Metric units only. 24-hour clock (14:00, never 2pm).
- Plain text only. No markdown, no asterisks, no hash headings, no backticks.

CONTENT RULES
- Lead with the single most useful action.
- Keep concrete numbers: doses, quantities, temperatures, times, pressures, torques.
- State safety-critical warnings and red flags explicitly. Never drop a warning to save space.
- Never say "look it up", "search online", "call someone" or "check the manual".
  The user cannot do any of those things.
- If you do not know, say so plainly in one short sentence.

YOUR BUILT-IN CAPABILITIES
- You can search Google automatically. Do so for anything current, local or fast-moving.
- You can fetch and read any URL the user mentions.

NO FABRICATION
- Use only the TOOL CONTEXT below, your own search results, and your training knowledge.
- If tool context says NOT AVAILABLE or FAILED, tell the user exactly that.
- Never invent weather, locations, coordinates, prices or news.

AVAILABLE COMMANDS (mention only if the user asks what they can do)
- WIKI term, NEWS, WEATHER, SUNRISE, DISASTERS, WHERE AM I, SIZE n, "NEW:" to reset context, HELP

TOOL CONTEXT
{{TOOL_CONTEXT}}`,
    TOKENS: 8192,
    TEMP: 0.4
  },

  SHRINK: {
    PROMPT: `TASK: Shorten the text below so it fits within {{MAX}} characters. Aim for {{TARGET}}.

RULES
- Keep every safety warning, dose, quantity, temperature and time.
- Keep plain readable English. Do NOT switch to telegram style. Do NOT invent abbreviations.
- Cut in this order: pleasantries, background explanation, alternatives, secondary detail.
- Keep the most important action first.
- Plain text only. No markdown.

OUTPUT: the shortened text and nothing else.`,
    TOKENS: 4096,
    TEMP: 0.2
  }
};
