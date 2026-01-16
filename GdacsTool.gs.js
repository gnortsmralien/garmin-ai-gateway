/**
 * GDACS Tool - Global Disaster Alert and Coordination System
 * Fetches nearby disaster alerts (earthquakes, floods, cyclones, etc.)
 */

function GdacsConfig(rssUrl, alertRadiusKm, minAlertLevel) {
  this.rssUrl = rssUrl || "https://www.gdacs.org/xml/rss.xml";
  this.alertRadiusKm = alertRadiusKm || 500;
  this.minAlertLevel = minAlertLevel || "Orange";
}

function GdacsTool(httpClient, xmlParser, config) {
  this.httpClient = httpClient;
  this.xmlParser = xmlParser;
  this.config = config;
}

GdacsTool.prototype.fetchNearby = function(lat, lon, logId) {
  try {
    var response = this.httpClient.fetch(this.config.rssUrl, {
      muteHttpExceptions: true
    });

    if (response.getResponseCode() !== 200) {
      return { success: false, error: "HTTP_" + response.getResponseCode(), data: null };
    }

    var xml = response.getContentText();
    const alertData = this.xmlParser.parseGdacsRss(xml);

    if (!alertData.success) {
      return { success: false, error: alertData.error, data: null };
    }

    const nearbyAlerts = this.filterNearbyAlerts(alertData.items, lat, lon);

    if (nearbyAlerts.length === 0) {
      return { success: true, data: null, error: null };
    }

    // Sort by distance and format
    nearbyAlerts.sort(function(a, b) { return a.distance - b.distance; });

    const alertLines = nearbyAlerts.slice(0, 3).map(function(a) {
      return "⚠️ " + a.level.toUpperCase() + " " + a.type + ": " + a.distance + "km away - " + a.title;
    });

    return { success: true, data: alertLines.join("\n"), error: null };

  } catch (e) {
    return { success: false, error: "EXCEPTION:" + e.message, data: null };
  }
};

GdacsTool.prototype.filterNearbyAlerts = function(items, userLat, userLon) {
  var nearbyAlerts = [];
  var config = this.config;

  for (var i = 0; i < items.length; i++) {
    var item = items[i];

    // Filter by alert level
    if (config.minAlertLevel === "Red" && item.level !== "Red") continue;
    if (config.minAlertLevel === "Orange" && item.level === "Green") continue;

    // Calculate distance
    var distance = this.haversineDistance(userLat, userLon, item.lat, item.lon);

    if (distance <= config.alertRadiusKm) {
      nearbyAlerts.push({
        type: item.type,
        level: item.level,
        distance: Math.round(distance),
        title: item.title.substring(0, 100)
      });
    }
  }

  return nearbyAlerts;
};

GdacsTool.prototype.haversineDistance = function(lat1, lon1, lat2, lon2) {
  var R = 6371; // Earth radius in km
  var dLat = this.toRad(lat2 - lat1);
  var dLon = this.toRad(lon2 - lon1);
  var a = Math.sin(dLat/2) * Math.sin(dLat/2) +
          Math.cos(this.toRad(lat1)) * Math.cos(this.toRad(lat2)) *
          Math.sin(dLon/2) * Math.sin(dLon/2);
  var c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return R * c;
};

GdacsTool.prototype.toRad = function(deg) {
  return deg * Math.PI / 180;
};

// Factory function for production use
function createGdacsTool() {
  return new GdacsTool(
    new GoogleHttpClient(),
    new GoogleXmlParser(),
    new GdacsConfig()
  );
}
