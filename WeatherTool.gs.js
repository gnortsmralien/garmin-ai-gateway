/**
 * Weather Tool - Using wttr.in API (no API key required)
 * Provides weather forecast AND astronomy data (sunrise/sunset) in one call
 */

/**
 * Weather Tool Configuration
 */
function WeatherConfig(forecastUrl) {
  this.forecastUrl = forecastUrl || "https://wttr.in";
}

/**
 * Weather Tool - Testable Implementation
 * @param {IHttpClient} httpClient
 * @param {WeatherConfig} config
 */
function WeatherTool(httpClient, config) {
  this.httpClient = httpClient;
  this.config = config;
}

/**
 * Fetch weather forecast and astronomy data (combined)
 * @param {number} lat - Latitude
 * @param {number} lon - Longitude
 * @param {string} logId - Log identifier (optional)
 * @param {boolean} includeAstronomy - Include sunrise/sunset data (default: false)
 * @returns {Object} {success: boolean, data: string, astronomy: string, error: string}
 */
WeatherTool.prototype.fetch = function(lat, lon, logId, includeAstronomy) {
  var url = this.config.forecastUrl + "/" + lat + "," + lon + "?format=j1";
  var params = { lat: lat, lon: lon, type: "forecast" };

  try {
    var response = this.httpClient.fetch(url, {
      muteHttpExceptions: true
    });

    var code = response.getResponseCode();
    if (code !== 200) {
      var result = { success: false, error: "HTTP_" + code, data: null, astronomy: null };
      if (logId) this._logToolCall(logId, "WEATHER", url, params, result);
      return result;
    }

    var json = JSON.parse(response.getContentText());
    var weatherLines = [];
    var astronomyLines = [];

    // Current conditions
    if (json.current_condition && json.current_condition[0]) {
      var c = json.current_condition[0];
      var weatherDesc = c.weatherDesc && c.weatherDesc[0] ? c.weatherDesc[0].value : "Unknown";
      weatherLines.push("NOW: " + c.temp_C + "°C, " + weatherDesc + ", Wind " +
                       c.windspeedKmph + "km/h, Humidity " + c.humidity + "%");
    }

    // Daily forecast (3 days)
    if (json.weather) {
      for (var i = 0; i < Math.min(3, json.weather.length); i++) {
        var day = json.weather[i];
        var dayName = i === 0 ? "Today" : i === 1 ? "Tomorrow" : day.date;
        var hi = day.maxtempC;
        var lo = day.mintempC;

        // Get most common weather condition from hourly data
        var weatherDesc = "Clear";
        if (day.hourly && day.hourly.length > 0) {
          // Use midday (12:00) weather as representative
          var middayHour = day.hourly[4] || day.hourly[0];  // index 4 = 12:00
          weatherDesc = middayHour.weatherDesc && middayHour.weatherDesc[0]
            ? middayHour.weatherDesc[0].value
            : "Unknown";
        }

        // Calculate rain probability from hourly data
        var maxRainChance = 0;
        if (day.hourly) {
          for (var h = 0; h < day.hourly.length; h++) {
            var rainChance = parseInt(day.hourly[h].chanceofrain || 0, 10);
            if (rainChance > maxRainChance) maxRainChance = rainChance;
          }
        }

        weatherLines.push(dayName + ": " + lo + "°-" + hi + "°C, " + weatherDesc + ", " + maxRainChance + "% rain");

        // Extract astronomy data for first 2 days only
        if (includeAstronomy && i < 2 && day.astronomy && day.astronomy[0]) {
          var astro = day.astronomy[0];
          var dayLabel = i === 0 ? "Today" : "Tomorrow";
          astronomyLines.push(dayLabel + ": Sunrise " + astro.sunrise + ", Sunset " + astro.sunset);
        }
      }
    }

    var result = {
      success: true,
      data: weatherLines.join("\n"),
      astronomy: astronomyLines.length > 0 ? astronomyLines.join("\n") : null,
      rawJson: json,  // Store full API response for FULL_WEATHER usage
      error: null
    };
    if (logId) this._logToolCall(logId, "WEATHER", url, params, result);
    return result;

  } catch (e) {
    var result = { success: false, error: "EXCEPTION:" + e.message, data: null, astronomy: null, rawJson: null };
    if (logId) this._logToolCall(logId, "WEATHER", url, params, result);
    return result;
  }
};


/**
 * Log tool execution details
 * @private
 */
WeatherTool.prototype._logToolCall = function(logId, toolName, url, params, result) {
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
 * Create a Weather tool with default production dependencies
 */
function createWeatherTool() {
  var config = new WeatherConfig();
  var httpClient = new GoogleHttpClient();
  return new WeatherTool(httpClient, config);
}
