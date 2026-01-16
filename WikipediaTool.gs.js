/**
 * Wikipedia Tool - Refactored with Dependency Injection
 */

/**
 * Wikipedia Tool Configuration
 */
function WikipediaConfig(baseUrl, maxExtractChars, userAgent) {
  this.baseUrl = baseUrl || "https://en.wikipedia.org/api/rest_v1/page/summary";
  this.maxExtractChars = maxExtractChars || 500;
  this.userAgent = userAgent || "SatComGateway/14.1 (satellite-emergency-assistant)";
}

/**
 * Wikipedia Tool - Testable Implementation
 * @param {IHttpClient} httpClient
 * @param {WikipediaConfig} config
 */
function WikipediaTool(httpClient, config) {
  this.httpClient = httpClient;
  this.config = config;
}

/**
 * Fetch Wikipedia summary for a search term
 * @param {string} query - Search term
 * @param {string} logId - Log identifier (optional)
 * @returns {Object} {success: boolean, data: string, error: string}
 */
WikipediaTool.prototype.fetch = function(query, logId) {
  const url = this.config.baseUrl + "/" + encodeURIComponent(query.trim());
  const params = { query: query };

  try {
    const response = this.httpClient.fetch(url, {
      muteHttpExceptions: true,
      headers: {
        'User-Agent': this.config.userAgent
      }
    });

    const code = response.getResponseCode();

    if (code === 404) {
      const result = { success: false, error: "NOT_FOUND", data: null };
      if (logId) this._logToolCall(logId, "WIKIPEDIA", url, params, result);
      return result;
    }

    if (code !== 200) {
      const result = { success: false, error: "HTTP_" + code, data: null };
      if (logId) this._logToolCall(logId, "WIKIPEDIA", url, params, result);
      return result;
    }

    const json = JSON.parse(response.getContentText());

    if (json.type === "disambiguation") {
      const result = { success: false, error: "DISAMBIGUATION", data: null };
      if (logId) this._logToolCall(logId, "WIKIPEDIA", url, params, result);
      return result;
    }

    var extract = json.extract || "";
    if (extract.length > this.config.maxExtractChars) {
      extract = extract.substring(0, this.config.maxExtractChars) + "...";
    }

    const result = { success: true, data: extract, error: null };
    if (logId) this._logToolCall(logId, "WIKIPEDIA", url, params, result);
    return result;

  } catch (e) {
    const result = { success: false, error: "EXCEPTION:" + e.message, data: null };
    if (logId) this._logToolCall(logId, "WIKIPEDIA", url, params, result);
    return result;
  }
};

/**
 * Log tool execution details
 * @private
 */
WikipediaTool.prototype._logToolCall = function(logId, toolName, url, params, result) {
  const status = result.success ? "OK" : "ERR:" + result.error;
  const dataPreview = result.data
    ? result.data.substring(0, 100).replace(/\n/g, " ") + "..."
    : "(no data)";

  console.log("[" + logId + "] TOOL:" + toolName);
  console.log("[" + logId + "]   URL: " + url);
  console.log("[" + logId + "]   PARAMS: " + JSON.stringify(params));
  console.log("[" + logId + "]   STATUS: " + status);
  console.log("[" + logId + "]   OUTPUT: " + dataPreview);
};

// =============================================================================
// FACTORY FUNCTION FOR BACKWARD COMPATIBILITY
// =============================================================================

/**
 * Create a Wikipedia tool with default production dependencies
 */
function createWikipediaTool() {
  const config = new WikipediaConfig();
  const httpClient = new GoogleHttpClient();
  return new WikipediaTool(httpClient, config);
}
