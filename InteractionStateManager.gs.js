/**
 * Conversation State Manager
 *
 * Keeps a short per-sender history so follow-up questions have context.
 * The Interactions API used to hold this server-side behind an interaction
 * id; the stable generateContent API is stateless, so the turns live here.
 *
 * - Last CONVERSATION.MAX_TURNS question/answer pairs per sender
 * - Auto-expires after SYSTEM.CONVERSATION_EXPIRY_HOURS of silence
 * - "NEW" / "RESET" starts over
 * - Script Properties storage, kept under the 9 KB per-value limit
 */

function InteractionStateConfig(expiryHours) {
  this.expiryHours = expiryHours || 24;
  this.expiryMs = this.expiryHours * 60 * 60 * 1000;
}

function InteractionStateManager(config) {
  this.config = config || new InteractionStateConfig();
  this.properties = PropertiesService.getScriptProperties();
}

/**
 * Earlier turns to send with this question, oldest first. Empty when the
 * conversation is new, expired or explicitly reset.
 *
 * @param {string} senderKey
 * @param {string} userPrompt - checked for the NEW keyword
 * @returns {Array<{q: string, a: string}>}
 */
InteractionStateManager.prototype.getHistory = function(senderKey, userPrompt) {
  if (this.isNewConversationRequested(userPrompt)) {
    console.log(`[ConversationState] User requested NEW conversation for ${senderKey}`);
    this.clearHistory(senderKey);
    return [];
  }

  var stateData = this.properties.getProperty(this.getStateKey(senderKey));
  if (!stateData) {
    console.log(`[ConversationState] No previous conversation for ${senderKey}`);
    return [];
  }

  try {
    var state = JSON.parse(stateData);
    var age = Date.now() - state.timestamp;

    if (age > this.config.expiryMs) {
      console.log(`[ConversationState] Conversation expired for ${senderKey} (${Math.round(age / 3600000)}h old)`);
      this.clearHistory(senderKey);
      return [];
    }

    // State written before the move off the Interactions API holds only an
    // interactionId, which means nothing to generateContent.
    var turns = Array.isArray(state.turns) ? state.turns : [];
    console.log(`[ConversationState] Continuing conversation for ${senderKey} (${turns.length} earlier turn(s))`);
    return turns;
  } catch (e) {
    console.error(`[ConversationState] Failed to parse state for ${senderKey}: ${e}`);
    this.clearHistory(senderKey);
    return [];
  }
};

/**
 * Record one completed turn, keeping only the most recent ones.
 *
 * @param {string} senderKey
 * @param {Array<{q: string, a: string}>} previous - what getHistory returned
 * @param {string} question
 * @param {string} answer
 */
InteractionStateManager.prototype.appendTurn = function(senderKey, previous, question, answer) {
  var turns = (previous || []).concat([{
    q: String(question || "").substring(0, CONVERSATION.MAX_QUESTION_CHARS),
    a: String(answer || "").substring(0, CONVERSATION.MAX_ANSWER_CHARS)
  }]);

  turns = turns.slice(-CONVERSATION.MAX_TURNS);

  var serialized = JSON.stringify({ turns: turns, timestamp: Date.now() });
  while (serialized.length > CONVERSATION.MAX_STATE_CHARS && turns.length > 1) {
    turns = turns.slice(1);
    serialized = JSON.stringify({ turns: turns, timestamp: Date.now() });
  }

  this.properties.setProperty(this.getStateKey(senderKey), serialized);
  console.log(`[ConversationState] Stored ${turns.length} turn(s) for ${senderKey}`);
};

/**
 * Clear interaction state for a sender
 *
 * @param {string} senderKey - Unique identifier for sender
 */
InteractionStateManager.prototype.clearHistory = function(senderKey) {
  var stateKey = this.getStateKey(senderKey);
  this.properties.deleteProperty(stateKey);
};

/**
 * Check if user wants to start a new conversation.
 *
 * Either the whole message is the keyword, or the message opens with the
 * keyword followed by punctuation: "NEW: how do I splint a wrist".
 *
 * A bare prefix is deliberately NOT enough. The old rule matched /^NEW\b/,
 * so an ordinary question such as "new tent recommendations?" silently threw
 * away the conversation the user was in the middle of.
 *
 * @param {string} userPrompt - User's message
 * @returns {boolean}
 */
InteractionStateManager.prototype.isNewConversationRequested = function(userPrompt) {
  var upperPrompt = String(userPrompt || "").toUpperCase().trim();

  var exact = ["NEW", "RESET", "FRESH", "START OVER", "NEW CONVERSATION", "NEW CHAT"];
  if (exact.indexOf(upperPrompt) !== -1) return true;

  return /^(NEW|RESET|FRESH)\s*[:\-,.!]/.test(upperPrompt);
};

/**
 * Remove a leading reset command so it is not sent to the model as part of
 * the question.
 *
 * @param {string} userPrompt
 * @returns {string}
 */
function stripResetPrefix(userPrompt) {
  if (!userPrompt) return "";
  return userPrompt.replace(/^(NEW|RESET|FRESH)\s*[:\-,.!]\s*/i, "").trim();
}

/**
 * Clean up expired conversation states
 * Call this periodically to prevent property store bloat
 */
InteractionStateManager.prototype.cleanupExpired = function() {
  var allProps = this.properties.getProperties();
  var cleaned = 0;
  var now = Date.now();

  for (var key in allProps) {
    if (key.startsWith('INTERACTION_')) {
      try {
        var state = JSON.parse(allProps[key]);
        var age = now - state.timestamp;

        if (age > this.config.expiryMs) {
          this.properties.deleteProperty(key);
          cleaned++;
        }
      } catch (e) {
        // Invalid data, delete it
        this.properties.deleteProperty(key);
        cleaned++;
      }
    }
  }

  if (cleaned > 0) {
    console.log(`[ConversationState] Cleaned up ${cleaned} expired conversation states`);
  }

  return cleaned;
};

/**
 * Get property key for a sender
 * @private
 */
InteractionStateManager.prototype.getStateKey = function(senderKey) {
  return "INTERACTION_" + senderKey;
};

/**
 * Extract sender key from Garmin message
 * Uses the reply address from the URL as unique identifier
 *
 * @param {string} targetUrl - Garmin reply URL
 * @returns {string} - Sender key (hashed for privacy)
 */
function extractSenderKey(targetUrl) {
  var adrMatch = targetUrl.match(/adr=([^&\s]+)/);
  if (adrMatch) {
    var replyAddress = decodeURIComponent(adrMatch[1]);
    // Hash the address for privacy (simple hash for Apps Script)
    return simpleHash(replyAddress);
  }

  // Fallback to extId if address not found
  var extIdMatch = targetUrl.match(/extId=([a-zA-Z0-9\-]+)/);
  return extIdMatch ? extIdMatch[1] : simpleHash(targetUrl);
}

/**
 * Simple hash function for sender identification
 * @private
 */
function simpleHash(str) {
  var hash = 0;
  for (var i = 0; i < str.length; i++) {
    var char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return "SENDER_" + Math.abs(hash).toString(36);
}

// Factory function for production use
function createInteractionStateManager() {
  return new InteractionStateManager(new InteractionStateConfig());
}
