/**
 * HTTP Client Interface
 * Abstraction over UrlFetchApp to enable testing
 */

/**
 * Interface for HTTP client
 * @interface
 */
function IHttpClient() {}

/**
 * @param {string} url
 * @param {Object} options
 * @returns {IHttpResponse}
 */
IHttpClient.prototype.fetch = function(url, options) {};

/**
 * Interface for HTTP response
 * @interface
 */
function IHttpResponse() {}

/**
 * @returns {number}
 */
IHttpResponse.prototype.getResponseCode = function() {};

/**
 * @returns {string}
 */
IHttpResponse.prototype.getContentText = function() {};

/**
 * @returns {Object}
 */
IHttpResponse.prototype.getHeaders = function() {};

// =============================================================================
// PRODUCTION IMPLEMENTATION
// =============================================================================

/**
 * Production HTTP client using UrlFetchApp
 * @implements {IHttpClient}
 */
function GoogleHttpClient() {}

GoogleHttpClient.prototype.fetch = function(url, options) {
  const response = UrlFetchApp.fetch(url, options);
  return new GoogleHttpResponse(response);
};

/**
 * Wrapper around Google's HTTPResponse
 * @implements {IHttpResponse}
 */
function GoogleHttpResponse(response) {
  this.response = response;
}

GoogleHttpResponse.prototype.getResponseCode = function() {
  return this.response.getResponseCode();
};

GoogleHttpResponse.prototype.getContentText = function() {
  return this.response.getContentText();
};

GoogleHttpResponse.prototype.getHeaders = function() {
  return this.response.getHeaders();
};

// =============================================================================
// MOCK IMPLEMENTATION FOR TESTING
// =============================================================================

/**
 * Mock HTTP client for testing
 * @implements {IHttpClient}
 */
function MockHttpClient() {
  this.requests = [];
  this.responses = {};
  this.defaultResponse = new MockHttpResponse(404, "Not Found");
}

/**
 * Configure a mock response for a URL pattern
 * @param {string|RegExp} urlPattern
 * @param {number} statusCode
 * @param {string} body
 * @param {Object} headers
 */
MockHttpClient.prototype.mockResponse = function(urlPattern, statusCode, body, headers) {
  this.responses[urlPattern] = new MockHttpResponse(statusCode, body, headers);
};

/**
 * Mock a successful JSON response
 * @param {string|RegExp} urlPattern
 * @param {Object} jsonData
 */
MockHttpClient.prototype.mockJsonResponse = function(urlPattern, jsonData) {
  this.mockResponse(urlPattern, 200, JSON.stringify(jsonData), {
    "Content-Type": "application/json"
  });
};

MockHttpClient.prototype.fetch = function(url, options) {
  // Record the request
  this.requests.push({ url: url, options: options });

  // Find matching response
  for (var pattern in this.responses) {
    if (this.responses.hasOwnProperty(pattern)) {
      if (typeof pattern === 'string' && url.indexOf(pattern) !== -1) {
        return this.responses[pattern];
      } else if (pattern instanceof RegExp && pattern.test(url)) {
        return this.responses[pattern];
      }
    }
  }

  return this.defaultResponse;
};

/**
 * Get all recorded requests
 */
MockHttpClient.prototype.getRequests = function() {
  return this.requests;
};

/**
 * Reset mock state
 */
MockHttpClient.prototype.reset = function() {
  this.requests = [];
  this.responses = {};
};

/**
 * Mock HTTP response
 * @implements {IHttpResponse}
 */
function MockHttpResponse(statusCode, body, headers) {
  this.statusCode = statusCode;
  this.body = body;
  this.headers = headers || {};
}

MockHttpResponse.prototype.getResponseCode = function() {
  return this.statusCode;
};

MockHttpResponse.prototype.getContentText = function() {
  return this.body;
};

MockHttpResponse.prototype.getHeaders = function() {
  return this.headers;
};

// Factory function for production use
function createHttpClient() {
  return new GoogleHttpClient();
}

// =============================================================================
// =============================  XML PARSER  ==================================
// =============================================================================

/**
 * Google XML Parser - Uses XmlService
 */
function GoogleXmlParser() {}

GoogleXmlParser.prototype.parseGdacsRss = function(xmlText) {
  try {
    var document = XmlService.parse(xmlText);
    var root = document.getRootElement();
    var channel = root.getChild("channel");

    if (!channel) {
      return { success: false, error: "INVALID_RSS", items: [] };
    }

    var items = channel.getChildren("item");
    var parsedItems = [];

    var gdacsNs = XmlService.getNamespace("gdacs", "http://www.gdacs.org");
    var geoNs = XmlService.getNamespace("geo", "http://www.w3.org/2003/01/geo/wgs84_pos#");

    for (var i = 0; i < items.length; i++) {
      try {
        var item = items[i];

        // Get alert level
        var alertLevelEl = item.getChild("alertlevel", gdacsNs);
        var alertLevel = alertLevelEl ? alertLevelEl.getText() : "Green";

        // Get coordinates
        var pointEl = item.getChild("Point", geoNs);
        if (!pointEl) continue;

        var eventLat = parseFloat(pointEl.getChildText("lat", geoNs));
        var eventLon = parseFloat(pointEl.getChildText("long", geoNs));

        if (isNaN(eventLat) || isNaN(eventLon)) continue;

        // Get event details
        var title = item.getChildText("title") || "Unknown event";
        var eventTypeEl = item.getChild("eventtype", gdacsNs);
        var type = eventTypeEl ? eventTypeEl.getText() : "??";

        parsedItems.push({
          level: alertLevel,
          lat: eventLat,
          lon: eventLon,
          title: title,
          type: type
        });
      } catch (itemErr) {
        // Skip malformed items
        continue;
      }
    }

    return { success: true, error: null, items: parsedItems };

  } catch (e) {
    return { success: false, error: "PARSE_ERROR:" + e.message, items: [] };
  }
};

/**
 * Mock XML Parser for testing
 */
function MockXmlParser() {
  this.mockData = null;
}

MockXmlParser.prototype.mockGdacsResponse = function(items) {
  this.mockData = { success: true, error: null, items: items };
};

MockXmlParser.prototype.mockError = function(error) {
  this.mockData = { success: false, error: error, items: [] };
};

MockXmlParser.prototype.parseGdacsRss = function(xmlText) {
  if (this.mockData) {
    return this.mockData;
  }
  return { success: false, error: "NO_MOCK_DATA", items: [] };
};
