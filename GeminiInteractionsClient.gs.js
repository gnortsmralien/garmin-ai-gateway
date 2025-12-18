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
    response_modalities: ["TEXT"],
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
GeminiInteractionsClient.prototype.extractText = function(json) {
  // Interactions API format: outputs array with type and text
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
