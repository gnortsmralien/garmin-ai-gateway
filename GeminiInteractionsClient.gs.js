/**
 * Gemini Interactions API Client
 * Uses the actual Interactions API endpoint for conversation continuity
 *
 * Endpoint: POST /v1beta/interactions
 * Docs: https://ai.google.dev/gemini-api/docs/interactions
 *
 * Features:
 * - Built-in Google Search tool
 * - Conversation state management with previous_interaction_id
 * - Returns interaction id for state tracking
 * - Error handling with retryable classification
 */

function GeminiInteractionsConfig(apiKey, modelTag) {
  this.apiKey = apiKey;
  this.modelTag = modelTag || "gemini-flash-latest";
  this.baseUrl = "https://generativelanguage.googleapis.com/v1beta";
}

function GeminiInteractionsClient(config) {
  this.config = config;
}

/**
 * Call Gemini Interactions API with optional tools
 *
 * @param {string} userMessage - User's input message
 * @param {string} systemPrompt - System instructions (prepended to input)
 * @param {Object} options - Additional options
 *   - maxOutputTokens: number (default 2048)
 *   - temperature: number (default 0.4)
 *   - previousInteractionId: string | null (for conversation continuity)
 *   - tools: Array<string> (e.g., ['google_search'])
 *
 * @returns {Object} { success: boolean, text: string, interactionId: string, error: { message: string, retryable: boolean } }
 */
GeminiInteractionsClient.prototype.call = function(userMessage, systemPrompt, options) {
  options = options || {};

  try {
    var url = this.buildUrl();
    var payload = this.buildPayload(userMessage, systemPrompt, options);

    debug(`[GeminiInteractions] Calling Interactions API (previousId: ${options.previousInteractionId || 'none'})`);
    debug(`[GeminiInteractions] Payload: ${JSON.stringify(payload).substring(0, 500)}...`);

    var response = UrlFetchApp.fetch(url, {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    });

    var responseText = response.getContentText();
    var json;

    try {
      json = JSON.parse(responseText);
    } catch (parseError) {
      console.error(`[GeminiInteractions] Failed to parse response: ${responseText.substring(0, 500)}`);
      return {
        success: false,
        text: null,
        interactionId: null,
        error: {
          message: "Failed to parse API response",
          retryable: false
        }
      };
    }

    // Check for API errors
    if (json.error) {
      var errorMsg = json.error.message || "Unknown error";
      console.error(`[GeminiInteractions] API Error: ${errorMsg}`);

      var retryable = this.isErrorRetryable(errorMsg);

      return {
        success: false,
        text: null,
        interactionId: null,
        error: {
          message: errorMsg,
          retryable: retryable
        }
      };
    }

    // Extract interaction ID from response
    var interactionId = json.id || null;

    // Extract text from outputs array
    var text = this.extractText(json);

    if (!text) {
      console.error(`[GeminiInteractions] No text in response. Status: ${json.status}, Keys: ${Object.keys(json).join(', ')}`);
      // Dump the steps shape so an unexpected structure is debuggable.
      try {
        console.error(`[GeminiInteractions] Raw steps: ${JSON.stringify(json.steps).substring(0, 1500)}`);
      } catch (dumpErr) {
        console.error(`[GeminiInteractions] Could not stringify steps: ${dumpErr}`);
      }
      return {
        success: false,
        text: null,
        interactionId: interactionId,
        error: {
          message: "No text in response",
          retryable: false
        }
      };
    }

    debug(`[GeminiInteractions] Success (interactionId: ${interactionId ? interactionId.substring(0, 12) + '...' : 'none'})`);

    return {
      success: true,
      text: text,
      interactionId: interactionId,
      error: null
    };

  } catch (e) {
    console.error(`[GeminiInteractions] Exception: ${e}`);

    // Network errors are typically retryable
    var retryable = e.message && (
      e.message.indexOf("timeout") !== -1 ||
      e.message.indexOf("Timeout") !== -1 ||
      e.message.indexOf("network") !== -1 ||
      e.message.indexOf("DNS") !== -1
    );

    return {
      success: false,
      text: null,
      interactionId: null,
      error: {
        message: "Exception: " + (e.message || e),
        retryable: retryable
      }
    };
  }
};

/**
 * Build API URL for Interactions endpoint
 * @private
 */
GeminiInteractionsClient.prototype.buildUrl = function() {
  return this.config.baseUrl + "/interactions?key=" + this.config.apiKey;
};

/**
 * Build API request payload for Interactions API
 * @private
 */
GeminiInteractionsClient.prototype.buildPayload = function(userMessage, systemPrompt, options) {
  // Combine system prompt and user message into a single input string
  var inputText;
  if (systemPrompt) {
    inputText = "[SYSTEM INSTRUCTIONS]\n" + systemPrompt + "\n[END SYSTEM INSTRUCTIONS]\n\nUser query: " + userMessage;
  } else {
    inputText = userMessage;
  }

  // Build payload with top-level fields (not nested in config)
  var payload = {
    model: this.config.modelTag,
    input: inputText,
    response_modalities: ["text"],
    generation_config: {
      max_output_tokens: options.maxOutputTokens || 2048,
      temperature: options.temperature !== undefined ? options.temperature : 0.4
    },
    store: true
  };

  // Add previous interaction ID for conversation continuity
  if (options.previousInteractionId) {
    payload.previous_interaction_id = options.previousInteractionId;
    debug(`[GeminiInteractions] Continuing conversation: ${options.previousInteractionId.substring(0, 12)}...`);
  }

  // Add tools if specified - Interactions API uses { type: "TOOL_NAME" } format
  if (options.tools && options.tools.length > 0) {
    var tools = [];

    for (var i = 0; i < options.tools.length; i++) {
      var toolName = options.tools[i];
      if (toolName === 'google_search') {
        tools.push({ type: "google_search" });
        debug(`[GeminiInteractions] Using Google Search tool`);
      } else if (toolName === 'url_context') {
        tools.push({ type: "url_context" });
        debug(`[GeminiInteractions] Using URL Context tool`);
      } else if (toolName === 'code_execution') {
        tools.push({ type: "code_execution" });
        debug(`[GeminiInteractions] Using Code Execution tool`);
      }
    }

    if (tools.length > 0) {
      payload.tools = tools;
    }
  }

  return payload;
};

/**
 * Extract text from Interactions API response
 * Response format: { id, outputs: [{ type: "text", text: "..." }], status }
 * @private
 */
GeminiInteractionsClient.prototype.extractStepText = function(step) {
  if (!step || typeof step !== "object") return null;

  // Skip pure tool-call / tool-result steps that don't carry model prose.
  // We still try to read content fields below in case text rides alongside.

  // 1) Direct text field on the step
  if (typeof step.text === "string" && step.text.trim()) {
    return step.text;
  }

  // 2) content as a plain string
  if (typeof step.content === "string" && step.content.trim()) {
    return step.content;
  }

  // 3) content.parts[].text  (generateContent-style nested in a step)
  if (step.content && step.content.parts && step.content.parts.length) {
    var parts = this.collectPartsText(step.content.parts);
    if (parts) return parts;
  }

  // 4) content as an array of parts/blocks: [{ text }] or [{ type:"text", text }]
  if (Array.isArray(step.content)) {
    var arrText = this.collectPartsText(step.content);
    if (arrText) return arrText;
  }

  // 5) message.content (chat-style)
  if (step.message) {
    if (typeof step.message.content === "string" && step.message.content.trim()) {
      return step.message.content;
    }
    if (Array.isArray(step.message.content)) {
      var msgText = this.collectPartsText(step.message.content);
      if (msgText) return msgText;
    }
  }

  // 6) parts[] directly on the step
  if (step.parts && step.parts.length) {
    var stepParts = this.collectPartsText(step.parts);
    if (stepParts) return stepParts;
  }

  // 7) output.text / output as nested object
  if (step.output) {
    if (typeof step.output.text === "string" && step.output.text.trim()) {
      return step.output.text;
    }
    if (typeof step.output === "string" && step.output.trim()) {
      return step.output;
    }
  }

  return null;
};

/**
 * Join text from an array of part/block objects, tolerating both
 * { text } and { type: "text", text } shapes.
 * @private
 */
GeminiInteractionsClient.prototype.collectPartsText = function(parts) {
  if (!parts || !parts.length) return null;
  var texts = [];
  for (var i = 0; i < parts.length; i++) {
    var p = parts[i];
    if (typeof p === "string") {
      if (p.trim()) texts.push(p);
    } else if (p && typeof p.text === "string" && p.text.trim()) {
      texts.push(p.text);
    } else if (p && typeof p.content === "string" && p.content.trim()) {
      texts.push(p.content);
    }
  }
  return texts.length ? texts.join("\n\n") : null;
};

/**
 * Extract text from Interactions API response
 * Response format: { id, steps: [...], status, ... }
 * @private
 */
GeminiInteractionsClient.prototype.extractText = function(json) {
  // Interactions API format: steps array. The final model answer is a step
  // whose content carries the text. Tool steps (google_search, etc.) are
  // interleaved, so we only collect text from message/model-style steps and
  // take the LAST one (the final answer after any tool use).
  if (json.steps && json.steps.length > 0) {
    var stepTexts = [];

    for (var s = 0; s < json.steps.length; s++) {
      var step = json.steps[s];
      var stepText = this.extractStepText(step);
      if (stepText) {
        stepTexts.push(stepText);
      }
    }

    if (stepTexts.length > 0) {
      // Last text-bearing step is the final answer.
      return stepTexts[stepTexts.length - 1];
    }
  }

  // Interactions API (older) format: outputs array with type and text
  if (json.outputs && json.outputs.length > 0) {
    var textParts = [];

    for (var i = 0; i < json.outputs.length; i++) {
      var output = json.outputs[i];

      if (output.text) {
        textParts.push(output.text);
      } else if (output.type === "text" && output.content) {
        textParts.push(output.content);
      }
    }

    if (textParts.length > 0) {
      return textParts.join("\n\n");
    }
  }

  // Fallback: try standard generateContent format (candidates)
  if (json.candidates && json.candidates.length > 0) {
    var candidate = json.candidates[0];

    if (candidate.content && candidate.content.parts) {
      var textParts = [];

      for (var i = 0; i < candidate.content.parts.length; i++) {
        var part = candidate.content.parts[i];

        if (part.text) {
          textParts.push(part.text);
        }
      }

      if (textParts.length > 0) {
        return textParts.join("\n\n");
      }
    }
  }

  // Try simple text field
  if (json.text) {
    return json.text;
  }

  if (json.response && json.response.text) {
    return json.response.text;
  }

  return null;
};

/**
 * Determine if error is retryable
 * @private
 */
GeminiInteractionsClient.prototype.isErrorRetryable = function(errorMessage) {
  if (!errorMessage) return false;

  var msg = errorMessage.toLowerCase();

  // Temporary/retryable errors
  if (msg.indexOf("overloaded") !== -1) return true;
  if (msg.indexOf("rate limit") !== -1) return true;
  if (msg.indexOf("quota") !== -1) return true;
  if (msg.indexOf("503") !== -1) return true;
  if (msg.indexOf("429") !== -1) return true;
  if (msg.indexOf("temporarily unavailable") !== -1) return true;
  if (msg.indexOf("try again") !== -1) return true;

  // Permanent errors
  if (msg.indexOf("api key") !== -1) return false;
  if (msg.indexOf("invalid") !== -1) return false;
  if (msg.indexOf("permission") !== -1) return false;
  if (msg.indexOf("forbidden") !== -1) return false;

  // Default: assume permanent for safety
  return false;
};

// Factory function for production use
function createGeminiInteractionsClient(apiKey, modelTag) {
  return new GeminiInteractionsClient(
    new GeminiInteractionsConfig(apiKey, modelTag)
  );
}
