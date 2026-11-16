/**
 * Gemini client on the stable generateContent API.
 *
 * Endpoint: POST /v1/models/{model}:generateContent
 *
 * Why not the Interactions API this project started on: it is v1beta, and it
 * broke us twice in six weeks without notice (modality casing, 2026-04-30;
 * outputs -> steps[], 2026-06-08). generateContent on v1 is the versioned,
 * stable surface. The price of leaving is server-side conversation memory, so
 * the gateway now keeps the short history itself (InteractionStateManager).
 *
 * Every failure carries the HTTP status and Google's own message. The last
 * outage (2026-11-16, HTTP 402 "prepayment credits are depleted") hid for
 * hours behind "No text in response" because neither was logged.
 */

function GeminiConfig(apiKey, model) {
  this.apiKey = apiKey;
  this.model = model;
  this.baseUrl = "https://generativelanguage.googleapis.com/v1";
}

/**
 * @param {GeminiConfig} config
 * @param {Object} [http] - IHttpClient; defaults to UrlFetchApp
 */
function GeminiClient(config, http) {
  this.config = config;
  this.http = http || new GoogleHttpClient();
}

/**
 * Generate one reply.
 *
 * @param {string} userMessage
 * @param {string} systemPrompt
 * @param {Object} options
 *   - history: Array<{q: string, a: string}> earlier turns, oldest first
 *   - tools: Array<string> 'google_search' | 'url_context'
 *   - maxOutputTokens: number (default 8192)
 *   - temperature: number (ignored by Gemini 3.6+ models, harmless to send)
 *   - thinkingLevel: 'MINIMAL' | 'LOW' | 'MEDIUM' | 'HIGH'
 *
 * @returns {{success: boolean, text: (string|null), truncated: boolean,
 *            modelVersion: (string|null), httpCode: number,
 *            error: (null|{message: string, retryable: boolean})}}
 */
GeminiClient.prototype.call = function(userMessage, systemPrompt, options) {
  options = options || {};
  var httpCode = 0;

  try {
    var response = this.http.fetch(this.buildUrl(), {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify(this.buildPayload(userMessage, systemPrompt, options)),
      muteHttpExceptions: true
    });

    httpCode = response.getResponseCode();
    var body = response.getContentText();
    var json = parseGeminiBody(body);

    var apiError = (json && json.error) ||
      (httpCode < 200 || httpCode >= 300 ? { message: "HTTP " + httpCode + ": " + String(body).substring(0, 300) } : null);

    if (apiError) {
      var message = apiError.message || "Unknown error";
      console.error(`[Gemini] API error (HTTP ${httpCode}): ${message}`);
      return geminiFailure(httpCode, message, isGeminiRetryable(httpCode, message));
    }

    if (!json) {
      console.error(`[Gemini] Unparseable body (HTTP ${httpCode}): ${String(body).substring(0, 500)}`);
      return geminiFailure(httpCode, "Unparseable API response", false);
    }

    var candidate = (json.candidates || [])[0] || null;
    var finishReason = candidate ? candidate.finishReason : null;
    var truncated = finishReason === "MAX_TOKENS";
    var text = extractGeminiText(candidate);

    if (!text) {
      var blocked = (json.promptFeedback && json.promptFeedback.blockReason) || finishReason || "no candidate";
      console.error(`[Gemini] No text (HTTP ${httpCode}, reason ${blocked}): ${String(body).substring(0, 800)}`);
      // A token-limit stop with no prose means thinking ate the budget: worth
      // another attempt. A safety block will not change on retry.
      return geminiFailure(httpCode, truncated ? "Output token limit reached before any text" : "No text in response (" + blocked + ")", truncated);
    }

    if (truncated) console.error(`[Gemini] Hit the output token limit; answer may be incomplete`);

    return {
      success: true,
      text: text,
      truncated: truncated,
      modelVersion: json.modelVersion || null,
      httpCode: httpCode,
      error: null
    };
  } catch (e) {
    console.error(`[Gemini] Exception: ${e}`);
    var msg = String(e && e.message || e);
    // UrlFetchApp throws on network-level failures; those are transient.
    return geminiFailure(httpCode, "Exception: " + msg, /timeout|timed out|network|DNS|Address unavailable/i.test(msg));
  }
};

/** @private */
GeminiClient.prototype.buildUrl = function() {
  return this.config.baseUrl + "/models/" + encodeURIComponent(this.config.model) +
    ":generateContent?key=" + encodeURIComponent(this.config.apiKey);
};

/** @private */
GeminiClient.prototype.buildPayload = function(userMessage, systemPrompt, options) {
  var contents = [];
  var history = options.history || [];

  for (var i = 0; i < history.length; i++) {
    if (!history[i] || !history[i].q || !history[i].a) continue;
    contents.push({ role: "user", parts: [{ text: history[i].q }] });
    contents.push({ role: "model", parts: [{ text: history[i].a }] });
  }
  contents.push({ role: "user", parts: [{ text: String(userMessage || "") }] });

  // maxOutputTokens is deliberately generous: thinking tokens come out of the
  // same budget, and a tight cap produces answers that stop mid-sentence.
  // Reply length is governed by the prompt and the shrink pass.
  var generationConfig = {
    maxOutputTokens: options.maxOutputTokens || 8192
  };
  if (options.temperature !== undefined) generationConfig.temperature = options.temperature;
  if (options.thinkingLevel) generationConfig.thinkingConfig = { thinkingLevel: options.thinkingLevel };

  var payload = { contents: contents, generationConfig: generationConfig };

  if (systemPrompt) {
    payload.systemInstruction = { parts: [{ text: systemPrompt }] };
  }

  var tools = [];
  (options.tools || []).forEach(function(name) {
    if (name === 'google_search') tools.push({ googleSearch: {} });
    else if (name === 'url_context') tools.push({ urlContext: {} });
  });
  if (tools.length > 0) payload.tools = tools;

  return payload;
};

/**
 * Parse a response body. Google sometimes wraps it in a one-element array,
 * most often the error envelope [{"error": {...}}] - unwrap that shape.
 *
 * @param {string} body
 * @returns {Object|null}
 */
function parseGeminiBody(body) {
  var json;
  try {
    json = JSON.parse(body);
  } catch (e) {
    return null;
  }
  if (Array.isArray(json)) {
    json = json.length > 0 && json[0] && typeof json[0] === 'object' ? json[0] : null;
  }
  return json && typeof json === 'object' ? json : null;
}

/**
 * The answer is every non-thought text part of the first candidate, in order.
 *
 * @param {Object|null} candidate
 * @returns {string|null}
 */
function extractGeminiText(candidate) {
  var parts = candidate && candidate.content && candidate.content.parts;
  if (!parts || !parts.length) return null;

  var text = parts
    .filter(function(p) { return p && p.thought !== true && typeof p.text === 'string'; })
    .map(function(p) { return p.text; })
    .join("")
    .trim();

  return text || null;
}

/**
 * 429 and 5xx are the API telling us to come back later. 402 (credits gone),
 * 400 (bad request) and 403/404 (key or model) will not fix themselves.
 *
 * @param {number} httpCode
 * @param {string} message
 * @returns {boolean}
 */
function isGeminiRetryable(httpCode, message) {
  if (httpCode === 429 || httpCode >= 500) return true;
  if (httpCode >= 400) return false;
  return /overloaded|rate limit|quota|unavailable|deadline|try again/i.test(String(message || ""));
}

/** @private */
function geminiFailure(httpCode, message, retryable) {
  return {
    success: false,
    text: null,
    truncated: false,
    modelVersion: null,
    httpCode: httpCode,
    error: { message: message, retryable: !!retryable }
  };
}

/** Factory for production use. */
function createGeminiClient(apiKey, model) {
  return new GeminiClient(new GeminiConfig(apiKey, model || SYSTEM.MODEL_TAG));
}
