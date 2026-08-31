/**
 * Parsing of inbound Garmin inReach notification emails.
 *
 * Everything here is pure except resolveInreachLink, which has to follow a
 * redirect chain.
 */

/** Boilerplate lines Garmin appends below the user's actual message. */
const GARMIN_BOILERPLATE = /(sent this message from|view the location|do not reply directly|^lat(itude)?\b)/i;

/**
 * Pull the user's message text out of the email body.
 *
 * Gmail's plain-text rendering hard-wraps long lines, so an inReach message
 * near the 160-character limit arrives split across two or more lines. Reading
 * only body.split('\n')[0] therefore truncated long questions before they ever
 * reached the model. Collect every line up to the first blank line, the reply
 * URL, or Garmin's boilerplate, and rejoin them.
 *
 * @param {string} body - plain-text email body
 * @returns {string} the user's message, unwrapped
 */
function extractMessageText(body) {
  if (!body) return "";

  const lines = body.split('\n');
  const collected = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    // A blank line ends the message block - but skip leading blanks.
    if (!line) {
      if (collected.length > 0) break;
      continue;
    }

    if (line.indexOf('http://') !== -1 || line.indexOf('https://') !== -1) break;
    if (GARMIN_BOILERPLATE.test(line)) break;

    collected.push(line);
  }

  return collected.join(' ').replace(/\s{2,}/g, ' ').trim();
}

/**
 * Verify the message is addressed to the gateway and strip the "AI:" prefix.
 *
 * @param {string} body - plain-text email body
 * @returns {{ok: boolean, prompt: string, reason: (string|null)}}
 */
function parseAiPrompt(body) {
  const raw = extractMessageText(body);

  if (!raw.match(/^(AI|Ai|ai)[:\s]/)) {
    return { ok: false, prompt: "", reason: "NOT_ADDRESSED_TO_AI" };
  }

  const prompt = raw.replace(/^(AI|Ai|ai)[:\s]*/, "").trim();

  if (!prompt || prompt.length < 2) {
    return { ok: false, prompt: "", reason: "EMPTY_PROMPT" };
  }

  return { ok: true, prompt: prompt, reason: null };
}

/**
 * Find the Garmin reply link. Supports both explore.garmin.com long form and
 * inreachlink.com short form.
 *
 * @param {string} body
 * @returns {string|null}
 */
function extractGarminLink(body) {
  if (!body) return null;
  const match = body.match(
    /(https:\/\/(?:[a-z0-9.-]*explore\.garmin\.com\/textmessage\/txtmsg\?[^"\s\n]+|inreachlink\.com\/[^"\s\n]+))/i
  );
  return match ? match[1] : null;
}

/**
 * Extract a bare email address from a To: header value, which may be either
 * "user@example.com" or "Name <user@example.com>".
 *
 * @param {string} toHeader
 * @returns {string|null}
 */
function extractRecipientAddress(toHeader) {
  if (!toHeader) return null;
  const match = toHeader.match(/<?([^<>\s]+@[^<>\s]+)>?/);
  return match ? match[1].trim() : null;
}

/**
 * Short inreachlink.com URLs redirect to the real explore.garmin.com reply
 * page. Follow the chain manually so the final extId is captured, and append
 * the recipient address as `adr` when the resolved URL lacks it.
 *
 * @param {string} url
 * @param {string|null} replyAddress
 * @returns {string} resolved URL, or the input unchanged on failure
 */
function resolveInreachLink(url, replyAddress) {
  if (!url || url.indexOf('inreachlink.com') === -1) return url;

  debug(`[MessageParser] Resolving inreachlink.com short URL...`);

  const MAX_REDIRECTS = 5;
  let currentUrl = url;
  let resolved = url;

  try {
    for (let hop = 0; hop < MAX_REDIRECTS; hop++) {
      const response = UrlFetchApp.fetch(currentUrl, {
        followRedirects: false,
        muteHttpExceptions: true
      });

      const statusCode = response.getResponseCode();
      if (statusCode < 300 || statusCode >= 400) {
        debug(`[MessageParser] Status ${statusCode}, stopping redirect chain`);
        break;
      }

      const headers = response.getHeaders();
      const location = headers['Location'] || headers['location'];
      if (!location) {
        debug(`[MessageParser] No Location header, stopping redirect chain`);
        break;
      }

      currentUrl = location;

      // Garmin Messenger (current): inreachlink.com 301s to
      // messenger.garmin.com/r?extId=<tinyUrlId>.
      if (location.indexOf('messenger.garmin.com') !== -1) {
        resolved = location;
        break;
      }

      // explore.garmin.com (pre-migration links)
      if (location.indexOf('explore.garmin.com') !== -1 && /extId=([^&\s]+)/.test(location)) {
        resolved = location;
        break;
      }
    }

    // Only the legacy explore.garmin.com form needs a ReplyAddress carried on
    // the URL; the Messenger action derives the recipient from the reply id.
    if (resolved.indexOf('explore.garmin.com') !== -1 &&
        resolved.indexOf('adr=') === -1 && replyAddress) {
      resolved += (resolved.indexOf('?') === -1 ? '?' : '&') + 'adr=' + encodeURIComponent(replyAddress);
      debug(`[MessageParser] Added adr parameter to resolved URL`);
    }
  } catch (e) {
    console.error(`[MessageParser] Error resolving short URL: ${e}`);
  }

  return resolved;
}

/**
 * Short log identifier for a request, taken from the Messenger reply id (or the
 * legacy extId). Logging "UNKNOWN" for every request is how the Messenger
 * migration stayed invisible in the logs for so long, so this understands every
 * link shape Garmin issues.
 *
 * @param {string} targetUrl
 * @returns {string}
 */
function extractLogId(targetUrl) {
  const id = extractTinyUrlId(targetUrl);
  return id ? id.substring(0, 8) : "UNKNOWN";
}

// =============================================================================
// =============================  COORDINATES  =================================
// =============================================================================

/**
 * Extract coordinates from a Garmin email body. Garmin includes the location
 * when "Send Location" is enabled, formatted as:
 *   "...sent this message from: Lat 45.344227 Lon -122.236868"
 *
 * @param {string} body - Email body text
 * @returns {{lat: number, lon: number}|null}
 */
function extractCoordinates(body) {
  if (!body) return null;

  // Pattern 1: "Lat X.XXX Lon Y.YYY" - standard Garmin location-sharing format
  let match = body.match(/Lat(?:itude)?[:\s]+(-?\d+\.?\d*)[°\s,]+(?:Lon(?:gitude)?[:\s]+)?(-?\d+\.?\d*)/i);
  if (match) {
    const coords = validateCoordinates(match[1], match[2]);
    if (coords) return coords;
  }

  // Pattern 2: decimal degrees in parentheses "(X.XXX, Y.YYY)"
  match = body.match(/\((-?\d+\.?\d*)\s*,\s*(-?\d+\.?\d*)\)/);
  if (match) {
    const coords = validateCoordinates(match[1], match[2]);
    if (coords) return coords;
  }

  // Pattern 3: Google Maps URL, if the user pasted one
  match = body.match(/maps\.google\.com[^\s]*[@/](-?\d+\.?\d*),(-?\d+\.?\d*)/);
  if (match) {
    const coords = validateCoordinates(match[1], match[2]);
    if (coords) return coords;
  }

  return null;
}

/**
 * @private
 * @returns {{lat: number, lon: number}|null}
 */
function validateCoordinates(latStr, lonStr) {
  const lat = parseFloat(latStr);
  const lon = parseFloat(lonStr);

  if (isNaN(lat) || isNaN(lon)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  if (lat === 0 && lon === 0) return null;  // null island - almost always a parse artefact

  return { lat: lat, lon: lon };
}

// =============================================================================
// =============================  USER COMMANDS  ===============================
// =============================================================================

/**
 * Extract a custom response size: "SIZE 800" or "RESPONSE SIZE 800".
 *
 * @param {string} prompt
 * @returns {number|null}
 */
function extractSizeOverride(prompt) {
  const match = prompt ? prompt.match(/\b(?:RESPONSE\s+)?SIZE\s+(\d+)\b/i) : null;
  if (!match) return null;

  const size = parseInt(match[1], 10);
  return !isNaN(size) && size > 0 ? size : null;
}

/**
 * Remove the SIZE command so it is not fed to the model as part of the question.
 *
 * @param {string} prompt
 * @returns {string}
 */
function stripSizeOverride(prompt) {
  if (!prompt) return "";
  return prompt
    .replace(/\b(?:RESPONSE\s+)?SIZE\s+\d+\b/gi, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/**
 * Check whether the user is asking for help.
 *
 * @param {string} prompt
 * @returns {boolean}
 */
function isHelpCommand(prompt) {
  const upper = (prompt || "").toUpperCase().trim();

  const exact = [
    "HELP", "?", "HELP ME", "COMMANDS", "LIST TOOLS", "TOOLS",
    "HOW TO USE", "HOW TO USE YOU", "WHAT CAN YOU DO"
  ];
  if (exact.indexOf(upper) !== -1) return true;

  return /^HELP\b/.test(upper);
}

/**
 * Help text listing available tools and commands.
 * Written to paginate cleanly: short lines, no mid-word breaks.
 */
function getHelpText() {
  return `SAT-COM AI GATEWAY

AUTOMATIC: web search, URL reading, and 24hr conversation memory. No keyword needed.

COMMANDS:
WIKI term - Wikipedia summary
NEWS - top headlines
WHERE AM I - place name (GPS)
WEATHER - forecast (GPS)
SUNRISE - sun and moon times (GPS)
FULL-WEATHER - UV, pressure, moon (GPS)
DISASTERS - GDACS alerts (GPS)
SIZE n - reply length in chars
NEW: question - forget past context
HELP - this message

GPS means turn on Send Location in the Garmin message settings.

USAGE: AI: your question`;
}
