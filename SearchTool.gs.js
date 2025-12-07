/**
 * Search Tool - DuckDuckGo HTML Search
 * No API key required, scrapes HTML search results
 */

function SearchConfig(htmlUrl, maxResults, userAgent) {
  this.htmlUrl = htmlUrl || "https://html.duckduckgo.com/html/";
  this.maxResults = maxResults || 5;
  this.userAgent = userAgent || "SatComGateway/15.0";
}

function SearchTool(httpClient, config) {
  this.httpClient = httpClient;
  this.config = config;
}

SearchTool.prototype.fetch = function(query, logId) {
  try {
    var response = this.httpClient.fetch(this.config.htmlUrl, {
      method: 'post',
      payload: {
        q: query,
        b: '',
        kl: ''
      },
      muteHttpExceptions: true,
      followRedirects: true,
      headers: {
        'User-Agent': this.config.userAgent
      }
    });

    if (response.getResponseCode() !== 200) {
      return { success: false, error: "HTTP_" + response.getResponseCode(), data: null };
    }

    var html = response.getContentText();
    var results = this.parseResults(html);

    if (results.length === 0) {
      return { success: false, error: "NO_RESULTS", data: null };
    }

    // Format results for context
    var formatted = results.slice(0, this.config.maxResults).map(function(r, i) {
      return (i + 1) + ". " + r.title + "\n   " + r.snippet;
    }).join("\n");

    return { success: true, data: formatted, error: null };

  } catch (e) {
    return { success: false, error: "EXCEPTION:" + e.message, data: null };
  }
};

SearchTool.prototype.parseResults = function(html) {
  var results = [];

  // Match result blocks - DuckDuckGo HTML format
  var linkRegex = /<a[^>]*class="result__a"[^>]*href="([^"]*)"[^>]*>([^<]*)<\/a>/gi;
  var snippetRegex = /<a[^>]*class="result__snippet"[^>]*>([^<]*(?:<[^>]*>[^<]*)*)<\/a>/gi;

  // Extract links and titles
  var links = [];
  var match;
  while ((match = linkRegex.exec(html)) !== null) {
    links.push({
      url: this.decodeUrl(match[1]),
      title: this.cleanText(match[2])
    });
  }

  // Extract snippets
  var snippets = [];
  while ((match = snippetRegex.exec(html)) !== null) {
    snippets.push(this.cleanText(match[1]));
  }

  // Combine links with snippets
  for (var i = 0; i < Math.min(links.length, snippets.length); i++) {
    if (links[i].title && links[i].title.length > 0) {
      results.push({
        title: links[i].title,
        url: links[i].url,
        snippet: snippets[i] || ""
      });
    }
  }

  return results;
};

SearchTool.prototype.decodeUrl = function(url) {
  // DDG uses //duckduckgo.com/l/?uddg=ENCODED_URL
  if (url.indexOf("uddg=") !== -1) {
    var match = url.match(/uddg=([^&]+)/);
    if (match) {
      try {
        return decodeURIComponent(match[1]);
      } catch (e) {
        return url;
      }
    }
  }
  return url;
};

SearchTool.prototype.cleanText = function(text) {
  if (!text) return "";
  return text
    .replace(/<[^>]*>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
};

// Factory function for production use
function createSearchTool() {
  return new SearchTool(
    new GoogleHttpClient(),
    new SearchConfig()
  );
}
