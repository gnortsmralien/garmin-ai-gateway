/**
 * Interaction State Manager
 * Manages conversation state for the Gemini Interactions API
 *
 * Features:
 * - Stores interaction IDs per sender for conversation continuity
 * - Auto-expires conversations after 24 hours
 * - Supports "NEW" keyword to force fresh conversation
 * - Uses Script Properties for persistent storage
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
 * Get interaction ID for a sender (if conversation should continue)
 * Returns null if conversation should start fresh
 *
 * @param {string} senderKey - Unique identifier for sender (email or message ID pattern)
 * @param {string} userPrompt - User's message (to check for NEW keyword)
 * @returns {string|null} - Previous interaction ID or null for new conversation
 */
InteractionStateManager.prototype.getInteractionId = function(senderKey, userPrompt) {
  // Check if user explicitly wants new conversation
  if (this.isNewConversationRequested(userPrompt)) {
    console.log(`[InteractionState] User requested NEW conversation for ${senderKey}`);
    this.clearInteractionId(senderKey);
    return null;
  }

  // Check for existing interaction
  var stateKey = this.getStateKey(senderKey);
  var stateData = this.properties.getProperty(stateKey);

  if (!stateData) {
    console.log(`[InteractionState] No previous conversation for ${senderKey}`);
    return null;
  }

  try {
    var state = JSON.parse(stateData);

    // Check if conversation has expired
    var age = Date.now() - state.timestamp;
    if (age > this.config.expiryMs) {
      console.log(`[InteractionState] Conversation expired for ${senderKey} (${Math.round(age / 3600000)}h old)`);
      this.clearInteractionId(senderKey);
      return null;
    }

    console.log(`[InteractionState] Continuing conversation for ${senderKey} (interaction: ${state.interactionId.substring(0, 8)}...)`);
    return state.interactionId;

  } catch (e) {
    console.error(`[InteractionState] Failed to parse state for ${senderKey}: ${e}`);
    this.clearInteractionId(senderKey);
    return null;
  }
};

/**
 * Store interaction ID for a sender
 *
 * @param {string} senderKey - Unique identifier for sender
 * @param {string} interactionId - Interaction ID from Gemini API
 */
InteractionStateManager.prototype.setInteractionId = function(senderKey, interactionId) {
  var stateKey = this.getStateKey(senderKey);
  var state = {
    interactionId: interactionId,
    timestamp: Date.now()
  };

  this.properties.setProperty(stateKey, JSON.stringify(state));
  console.log(`[InteractionState] Stored interaction for ${senderKey}: ${interactionId.substring(0, 8)}...`);
};

/**
 * Clear interaction state for a sender
 *
 * @param {string} senderKey - Unique identifier for sender
 */
InteractionStateManager.prototype.clearInteractionId = function(senderKey) {
  var stateKey = this.getStateKey(senderKey);
  this.properties.deleteProperty(stateKey);
};

/**
 * Check if user wants to start a new conversation
 * Looks for keywords: NEW, RESET, FRESH, START OVER
 *
 * @param {string} userPrompt - User's message
 * @returns {boolean}
 */
InteractionStateManager.prototype.isNewConversationRequested = function(userPrompt) {
  var upperPrompt = userPrompt.toUpperCase().trim();

  // Exact matches
  if (upperPrompt === "NEW" ||
      upperPrompt === "RESET" ||
      upperPrompt === "FRESH" ||
      upperPrompt === "START OVER" ||
      upperPrompt === "NEW CONVERSATION") {
    return true;
  }

  // Check if starts with these keywords
  if (upperPrompt.match(/^(NEW|RESET|FRESH)\b/)) {
    return true;
  }

  return false;
};

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
    console.log(`[InteractionState] Cleaned up ${cleaned} expired conversation states`);
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
  return extIdMatch ? extIdMatch[1] : "UNKNOWN";
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
