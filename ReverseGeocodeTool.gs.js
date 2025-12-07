/**
 * Reverse Geocode Tool - Converts coordinates to human-readable location names
 * Implementation: OpenStreetMap Nominatim API
 */

/**
 * Reverse Geocode Tool Configuration
 */
function ReverseGeocodeConfig(reverseUrl, userAgent) {
  this.reverseUrl = reverseUrl || "https://nominatim.openstreetmap.org/reverse";
  // Default user agent if TOOLBOX_CONFIG is not available (during testing)
  this.userAgent = userAgent || (typeof TOOLBOX_CONFIG !== 'undefined' ? TOOLBOX_CONFIG.USER_AGENT : "SatComGateway/15.0 (satellite-emergency-assistant)");
}

/**
 * Reverse Geocode Tool - Testable Implementation
 * @param {IHttpClient} httpClient
 * @param {ReverseGeocodeConfig} config
 */
function ReverseGeocodeTool(httpClient, config) {
  this.httpClient = httpClient;
  this.config = config;
}

/**
 * Reverse geocode coordinates to location name
 * @param {number} lat - Latitude
 * @param {number} lon - Longitude
 * @param {string} logId - Log identifier (optional)
 * @returns {Object} {success: boolean, data: string, error: string}
 */
ReverseGeocodeTool.prototype.fetch = function(lat, lon, logId) {
  var queryParams = [
    "lat=" + lat,
    "lon=" + lon,
    "format=json",
    "addressdetails=1",
    "zoom=14"  // 14 = suburb/village level detail
  ].join("&");

  var url = this.config.reverseUrl + "?" + queryParams;
  var params = { lat: lat, lon: lon, type: "reverse_geocode" };

  try {
    var response = this.httpClient.fetch(url, {
      muteHttpExceptions: true,
      headers: {
        "User-Agent": this.config.userAgent
      }
    });

    var code = response.getResponseCode();
    if (code !== 200) {
      var result = { success: false, error: "HTTP_" + code, data: null };
      if (logId) this._logToolCall(logId, "REVERSE_GEOCODE", url, params, result);
      return result;
    }

    var json = JSON.parse(response.getContentText());

    // Check if location was found
    if (json.error) {
      var result = { success: false, error: "NOT_FOUND", data: null };
      if (logId) this._logToolCall(logId, "REVERSE_GEOCODE", url, params, result);
      return result;
    }

    // Build location description
    var locationParts = [];
    var addr = json.address || {};

    // Add most specific location first
    if (addr.village || addr.town || addr.city) {
      locationParts.push(addr.village || addr.town || addr.city);
    }

    // Add region/state
    if (addr.state || addr.region) {
      locationParts.push(addr.state || addr.region);
    }

    // Add country
    if (addr.country) {
      locationParts.push(addr.country);
    }

    // If we have no structured data, use display_name
    var locationStr = locationParts.length > 0
      ? locationParts.join(", ")
      : json.display_name;

    // Add notable nearby features if available
    var features = [];
    if (addr.peak) features.push("near " + addr.peak);
    if (addr.water) features.push("near " + addr.water);
    if (addr.natural) features.push("near " + addr.natural);

    var output = locationStr;
    if (features.length > 0) {
      output += " (" + features.join(", ") + ")";
    }

    var result = { success: true, data: output, error: null };
    if (logId) this._logToolCall(logId, "REVERSE_GEOCODE", url, params, result);
    return result;

  } catch (e) {
    var result = { success: false, error: "EXCEPTION:" + e.message, data: null };
    if (logId) this._logToolCall(logId, "REVERSE_GEOCODE", url, params, result);
    return result;
  }
};

/**
 * Log tool execution details
 * @private
 */
ReverseGeocodeTool.prototype._logToolCall = function(logId, toolName, url, params, result) {
  var status = result.success ? "OK" : "ERR:" + result.error;
  var dataPreview = result.data
    ? result.data.substring(0, 100).replace(/\n/g, " ") + (result.data.length > 100 ? "..." : "")
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
 * Create a ReverseGeocode tool with default production dependencies
 */
function createReverseGeocodeTool() {
  var config = new ReverseGeocodeConfig();
  var httpClient = new GoogleHttpClient();
  return new ReverseGeocodeTool(httpClient, config);
}
