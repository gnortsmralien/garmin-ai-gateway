/**
 * Toolbox dispatcher.
 *
 * Inspects the user's message for tool triggers, runs the matching tools and
 * assembles the TOOL CONTEXT block handed to the model. Tool failures are
 * reported into the context explicitly so the model states them rather than
 * inventing data.
 */

/** Accumulator for context blocks and tool errors. @private */
function ToolboxResult() {
  this.parts = [];
  this.errors = [];
}

ToolboxResult.prototype.add = function(label, text) {
  this.parts.push(`[${label}]\n${text}`);
};

ToolboxResult.prototype.unavailable = function(label, detail) {
  this.parts.push(`[${label}] NOT AVAILABLE - ${detail}`);
};

ToolboxResult.prototype.fail = function(tool, label, detail) {
  this.errors.push(`${tool}:${detail}`);
  this.unavailable(label, detail);
};

ToolboxResult.prototype.build = function() {
  if (this.errors.length > 0) {
    const failed = this.errors.map(function(e) {
      const idx = e.indexOf(':');
      return `${e.substring(0, idx)}: FAILED (${e.substring(idx + 1)})`;
    }).join(', ');

    this.parts.push(
      `[TOOL FAILURES]\nThe following tools failed and have NO DATA: ${failed}\n` +
      `Do NOT make up or guess this information - tell the user the tool failed.`
    );
  }

  return { context: this.parts.join("\n\n"), errors: this.errors };
};

/** @private */
function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\-]/g, '\\$&');
}

/**
 * Whether any of a trigger's keywords appear as whole words in the prompt.
 *
 * @param {string} prompt
 * @param {{keywords: string[]}} trigger
 * @returns {boolean}
 */
function triggerMatches(prompt, trigger) {
  const pattern = new RegExp('\\b(' + trigger.keywords.map(escapeRegex).join('|') + ')\\b', 'i');
  return pattern.test(prompt);
}

/**
 * Run every tool triggered by the message.
 *
 * @param {string} userPrompt
 * @param {{lat: number, lon: number}|null} coords
 * @param {string} logId
 * @returns {{context: string, errors: string[]}}
 */
function runToolbox(userPrompt, coords, logId) {
  const result = new ToolboxResult();
  const T = TOOLBOX_CONFIG.TRIGGERS;
  const hasCoords = !!(coords && coords.lat !== undefined && coords.lat !== null &&
                       coords.lon !== undefined && coords.lon !== null);

  console.log(`[${logId}] TOOLBOX: coords=${hasCoords ? `${coords.lat},${coords.lon}` : "none"}`);

  runWikipedia(result, userPrompt, logId);
  runNews(result, userPrompt, logId);

  const wants = {
    geocode: triggerMatches(userPrompt, T.REVERSE_GEOCODE),
    weather: triggerMatches(userPrompt, T.WEATHER),
    astronomy: triggerMatches(userPrompt, T.ASTRONOMY),
    fullWeather: triggerMatches(userPrompt, T.FULL_WEATHER),
    disasters: triggerMatches(userPrompt, T.DISASTERS)
  };

  if (!hasCoords) {
    reportMissingCoords(result, wants);
    return result.build();
  }

  result.add('LOCATION', `Coordinates: ${coords.lat}, ${coords.lon}`);

  if (wants.geocode) runReverseGeocode(result, coords, logId);
  if (wants.weather || wants.astronomy || wants.fullWeather) runWeather(result, coords, wants, logId);
  if (wants.disasters) runDisasters(result, coords, logId);

  return result.build();
}

// =============================================================================
// =============================  INDIVIDUAL TOOLS  ============================
// =============================================================================

/** @private */
function runWikipedia(result, userPrompt, logId) {
  const match = userPrompt.match(TOOLBOX_CONFIG.TRIGGERS.WIKIPEDIA);
  if (!match) return;

  const term = match[1].trim();
  console.log(`[${logId}] TOOLBOX: WIKI "${term}"`);

  try {
    const response = createWikipediaTool().fetch(term, logId);
    if (response.success) {
      result.add(`WIKIPEDIA: ${term}`, response.data);
    } else {
      result.fail('WIKI', `WIKIPEDIA: ${term}`, response.error);
    }
  } catch (e) {
    console.error(`[${logId}] TOOLBOX: Wikipedia tool error: ${e}`);
    result.fail('WIKI', `WIKIPEDIA: ${term}`, 'Tool initialization failed');
  }
}

/** @private */
function runNews(result, userPrompt, logId) {
  if (!triggerMatches(userPrompt, TOOLBOX_CONFIG.TRIGGERS.NEWS)) return;

  console.log(`[${logId}] TOOLBOX: NEWS`);

  try {
    const response = createNewsTool().fetch(logId);
    if (response.success) {
      result.add('NEWS HEADLINES', response.data);
    } else {
      result.fail('NEWS', 'NEWS', response.error);
    }
  } catch (e) {
    console.error(`[${logId}] TOOLBOX: News tool error: ${e}`);
    result.fail('NEWS', 'NEWS', 'Tool initialization failed');
  }
}

/** @private */
function runReverseGeocode(result, coords, logId) {
  console.log(`[${logId}] TOOLBOX: REVERSE_GEOCODE`);

  try {
    const response = createReverseGeocodeTool().fetch(coords.lat, coords.lon, logId);
    if (response.success) {
      result.add('LOCATION NAME', response.data);
    } else {
      result.fail('REVERSE_GEOCODE', 'LOCATION NAME', response.error);
    }
  } catch (e) {
    console.error(`[${logId}] TOOLBOX: Reverse geocode tool error: ${e}`);
    result.fail('REVERSE_GEOCODE', 'LOCATION NAME', 'Tool initialization failed');
  }
}

/** @private */
function runWeather(result, coords, wants, logId) {
  const mode = wants.fullWeather ? 'FULL_WEATHER' : (wants.astronomy ? 'WEATHER+ASTRONOMY' : 'WEATHER');
  console.log(`[${logId}] TOOLBOX: ${mode}`);

  let response;
  try {
    response = createWeatherTool().fetch(
      coords.lat, coords.lon, logId, wants.astronomy || wants.fullWeather
    );
  } catch (e) {
    console.error(`[${logId}] TOOLBOX: Weather tool error: ${e}`);
    response = { success: false, error: 'Tool initialization failed' };
  }

  if (!response.success) {
    if (wants.fullWeather) result.fail('FULL_WEATHER', 'FULL WEATHER DATA', response.error);
    if (wants.weather) result.fail('WEATHER', 'WEATHER', response.error);
    if (wants.astronomy) result.fail('ASTRO', 'ASTRONOMY', response.error);
    return;
  }

  if (wants.fullWeather && response.rawJson) {
    result.add('FULL WEATHER DATA',
      `Complete weather API response for analysis. Includes current conditions ` +
      `(temperature, feels-like, humidity, wind, precipitation, pressure, visibility, UV index), ` +
      `a 3-day forecast with hourly detail, astronomy (sunrise, sunset, moonrise, moonset, ` +
      `moon phase and illumination) and nearest-location info.\n\nRaw JSON:\n` +
      JSON.stringify(response.rawJson, null, 2));
    return;
  }

  if (wants.weather && response.data) result.add('WEATHER FORECAST', response.data);
  if (wants.astronomy && response.astronomy) result.add('ASTRONOMY', response.astronomy);
}

/** @private */
function runDisasters(result, coords, logId) {
  console.log(`[${logId}] TOOLBOX: GDACS`);

  try {
    const response = createGdacsTool().fetchNearby(coords.lat, coords.lon, logId);
    if (response.success && response.data) {
      result.add('DISASTER ALERTS', response.data);
    } else if (response.success) {
      result.add('DISASTER ALERTS',
        `No significant alerts within ${TOOLBOX_CONFIG.GDACS.ALERT_RADIUS_KM}km of your location.`);
    } else {
      result.fail('GDACS', 'DISASTER ALERTS', response.error);
    }
  } catch (e) {
    console.error(`[${logId}] TOOLBOX: GDACS tool error: ${e}`);
    result.fail('GDACS', 'DISASTER ALERTS', 'Tool initialization failed');
  }
}

/**
 * Tell the model which location-dependent tools could not run, so it can tell
 * the user how to fix it rather than guessing.
 * @private
 */
function reportMissingCoords(result, wants) {
  const ENABLE_HINT = 'no GPS coordinates. Turn on "Send Location" in the Garmin message settings.';

  if (wants.geocode) result.unavailable('LOCATION NAME', ENABLE_HINT);
  if (wants.weather) result.unavailable('WEATHER', ENABLE_HINT + ' Meanwhile, name your location in the question.');
  if (wants.astronomy) result.unavailable('ASTRONOMY', ENABLE_HINT + ' Meanwhile, name your location in the question.');
  if (wants.fullWeather) result.unavailable('FULL WEATHER DATA', ENABLE_HINT);
  if (wants.disasters) result.unavailable('DISASTER ALERTS', ENABLE_HINT);
}
