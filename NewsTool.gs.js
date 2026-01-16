/**
 * News Tool - Refactored with Dependency Injection
 * Requires XmlService mock for testing
 */

/**
 * News Tool Configuration
 */
function NewsConfig(rssUrl, maxHeadlines) {
  this.rssUrl = rssUrl || "https://news.google.com/rss";
  this.maxHeadlines = maxHeadlines || 5;
}

/**
 * XML Service Interface for testing
 * @interface
 */
function IXmlService() {}
IXmlService.prototype.parse = function(xmlString) {};

/**
 * Production XML Service
 * @implements {IXmlService}
 */
function GoogleXmlService() {}
GoogleXmlService.prototype.parse = function(xmlString) {
  return XmlService.parse(xmlString);
};

/**
 * News Tool - Testable Implementation
 * @param {IHttpClient} httpClient
 * @param {IXmlService} xmlService
 * @param {NewsConfig} config
 */
function NewsTool(httpClient, xmlService, config) {
  this.httpClient = httpClient;
  this.xmlService = xmlService;
  this.config = config;
}

/**
 * Fetch top news headlines from Google News RSS
 * @param {string} logId - Log identifier (optional)
 * @returns {Object} {success: boolean, data: string, error: string}
 */
NewsTool.prototype.fetch = function(logId) {
  var url = this.config.rssUrl;
  var params = { max_headlines: this.config.maxHeadlines };

  try {
    var response = this.httpClient.fetch(url, {
      muteHttpExceptions: true
    });

    var code = response.getResponseCode();
    if (code !== 200) {
      var result = { success: false, error: "HTTP_" + code, data: null };
      if (logId) this._logToolCall(logId, "NEWS", url, params, result);
      return result;
    }

    var xml = response.getContentText();
    var document = this.xmlService.parse(xml);
    var root = document.getRootElement();
    var channel = root.getChild("channel");

    if (!channel) {
      var result = { success: false, error: "INVALID_RSS", data: null };
      if (logId) this._logToolCall(logId, "NEWS", url, params, result);
      return result;
    }

    var items = channel.getChildren("item");
    var headlines = [];

    for (var i = 0; i < Math.min(this.config.maxHeadlines, items.length); i++) {
      var item = items[i];
      var title = item.getChildText("title") || "";

      // Clean up Google News title format (often has " - Source" suffix)
      var dashIdx = title.lastIndexOf(" - ");
      if (dashIdx > 0) {
        title = title.substring(0, dashIdx);
      }

      if (title.length > 80) {
        title = title.substring(0, 77) + "...";
      }

      headlines.push("• " + title);
    }

    if (headlines.length === 0) {
      var result = { success: false, error: "NO_HEADLINES", data: null };
      if (logId) this._logToolCall(logId, "NEWS", url, params, result);
      return result;
    }

    var result = { success: true, data: headlines.join("\n"), error: null };
    if (logId) this._logToolCall(logId, "NEWS", url, params, result);
    return result;

  } catch (e) {
    var result = { success: false, error: "EXCEPTION:" + e.message, data: null };
    if (logId) this._logToolCall(logId, "NEWS", url, params, result);
    return result;
  }
};

/**
 * Log tool execution details
 * @private
 */
NewsTool.prototype._logToolCall = function(logId, toolName, url, params, result) {
  var status = result.success ? "OK" : "ERR:" + result.error;
  var dataPreview = result.data
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
 * Create a News tool with default production dependencies
 */
function createNewsTool() {
  var config = new NewsConfig();
  var httpClient = new GoogleHttpClient();
  var xmlService = new GoogleXmlService();
  return new NewsTool(httpClient, xmlService, config);
}
