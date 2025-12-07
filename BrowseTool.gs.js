/**
 * Browse Tool - Fetch and extract text from URLs
 * Supports HTML, JSON, and plain text
 */

function BrowseConfig(maxContentChars, timeoutMs, userAgent) {
  this.maxContentChars = maxContentChars || 2000;
  this.timeoutMs = timeoutMs || 15000;
  this.userAgent = userAgent || "SatComGateway/15.0";
}

function BrowseTool(httpClient, config) {
  this.httpClient = httpClient;
  this.config = config;
}

BrowseTool.prototype.fetch = function(targetUrl, logId) {
  try {
    // Validate URL
    if (!targetUrl.match(/^https?:\/\//i)) {
      return { success: false, error: "INVALID_URL", data: null };
    }

    var response = this.httpClient.fetch(targetUrl, {
      muteHttpExceptions: true,
      followRedirects: true,
      headers: {
        'User-Agent': this.config.userAgent,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
      }
    });

    var code = response.getResponseCode();
    if (code === 403) {
      return { success: false, error: "FORBIDDEN", data: null };
    }
    if (code === 404) {
      return { success: false, error: "NOT_FOUND", data: null };
    }
    if (code !== 200) {
      return { success: false, error: "HTTP_" + code, data: null };
    }

    var contentType = response.getHeaders()["Content-Type"] || "";

    // Handle JSON
    if (contentType.indexOf("application/json") !== -1) {
      var json = JSON.parse(response.getContentText());
      var text = JSON.stringify(json, null, 2);
      return {
        success: true,
        data: text.substring(0, this.config.maxContentChars),
        error: null
      };
    }

    // Handle plain text
    if (contentType.indexOf("text/plain") !== -1) {
      var text = response.getContentText();
      return {
        success: true,
        data: text.substring(0, this.config.maxContentChars),
        error: null
      };
    }

    // Handle HTML
    var html = response.getContentText();
    var extracted = this.extractText(html);

    if (!extracted || extracted.length < 50) {
      return { success: false, error: "NO_CONTENT", data: null };
    }

    return {
      success: true,
      data: extracted.substring(0, this.config.maxContentChars),
      error: null
    };

  } catch (e) {
    var errorMsg;
    if (e.message.indexOf("Timeout") !== -1) {
      errorMsg = "TIMEOUT";
    } else if (e.message.indexOf("DNS") !== -1 || e.message.indexOf("resolve") !== -1) {
      errorMsg = "DNS_FAILED";
    } else {
      errorMsg = "EXCEPTION:" + e.message.substring(0, 50);
    }
    return { success: false, error: errorMsg, data: null };
  }
};

BrowseTool.prototype.extractText = function(html) {
  if (!html) return "";

  var text = html;

  // Remove script and style blocks
  text = text.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, " ");
  text = text.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, " ");
  text = text.replace(/<noscript[^>]*>[\s\S]*?<\/noscript>/gi, " ");
  text = text.replace(/<!--[\s\S]*?-->/g, " ");

  // Extract main content if available
  var mainContent = "";
  var articleMatch = text.match(/<article[^>]*>([\s\S]*?)<\/article>/i);
  if (articleMatch) {
    mainContent = articleMatch[1];
  } else {
    var mainMatch = text.match(/<main[^>]*>([\s\S]*?)<\/main>/i);
    if (mainMatch) {
      mainContent = mainMatch[1];
    }
  }

  if (mainContent.length > 200) {
    text = mainContent;
  }

  // Extract title
  var title = "";
  var titleMatch = html.match(/<title[^>]*>([^<]*)<\/title>/i);
  if (titleMatch) {
    title = titleMatch[1].trim();
  }

  // Replace block elements with newlines
  text = text.replace(/<(p|div|br|h[1-6]|li|tr)[^>]*>/gi, "\n");
  text = text.replace(/<\/(p|div|h[1-6]|li|tr)>/gi, "\n");

  // Remove all remaining HTML tags
  text = text.replace(/<[^>]+>/g, " ");

  // Decode HTML entities
  text = text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, function(_, num) { return String.fromCharCode(num); })
    .replace(/&#x([a-fA-F0-9]+);/g, function(_, hex) { return String.fromCharCode(parseInt(hex, 16)); });

  // Clean up whitespace
  text = text
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n/g, "\n\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  // Prepend title if available
  if (title && !text.startsWith(title)) {
    text = "[" + title + "]\n\n" + text;
  }

  return text;
};

// Factory function for production use
function createBrowseTool() {
  return new BrowseTool(
    new GoogleHttpClient(),
    new BrowseConfig()
  );
}
