/**
 * Integration Tests
 * These tests make real HTTP calls to external APIs
 * They are not counted as failures if they fail (network issues, API changes, etc.)
 * but results are reported for monitoring purposes.
 */

function runIntegrationTests() {
  console.log("\n╔════════════════════════════════════════════════════════════╗");
  console.log("║              INTEGRATION TESTS (Live APIs)                ║");
  console.log("╚════════════════════════════════════════════════════════════╝\n");
  console.log("Note: These tests make real HTTP calls. Failures are informational only.\n");

  var results = [];
  var passed = 0;
  var failed = 0;

  // Wikipedia Tool - Real API call
  try {
    console.log("Testing WikipediaTool with real API...");
    var wikiTool = createWikipediaTool();
    var wikiResult = wikiTool.fetch("JavaScript");
    if (wikiResult.success && wikiResult.data && wikiResult.data.indexOf("programming") !== -1) {
      console.log("✓ WikipediaTool - Successfully fetched 'JavaScript' article");
      results.push({tool: "Wikipedia", status: "PASS", detail: "Fetched article successfully"});
      passed++;
    } else {
      console.log("✗ WikipediaTool - Unexpected response format");
      results.push({tool: "Wikipedia", status: "FAIL", detail: wikiResult.error || "Unexpected format"});
      failed++;
    }
  } catch (e) {
    console.log("✗ WikipediaTool - Exception: " + e.message);
    results.push({tool: "Wikipedia", status: "ERROR", detail: e.message});
    failed++;
  }

  // Weather Tool - Real API call
  try {
    console.log("\nTesting WeatherTool with real API...");
    var weatherTool = createWeatherTool();
    var weatherResult = weatherTool.fetch(40.7128, -74.0060); // New York
    if (weatherResult.success && weatherResult.data) {
      console.log("✓ WeatherTool - Successfully fetched weather for NYC");
      results.push({tool: "Weather", status: "PASS", detail: "Fetched weather successfully"});
      passed++;
    } else {
      console.log("✗ WeatherTool - Failed to fetch weather");
      results.push({tool: "Weather", status: "FAIL", detail: weatherResult.error || "Unknown error"});
      failed++;
    }
  } catch (e) {
    console.log("✗ WeatherTool - Exception: " + e.message);
    results.push({tool: "Weather", status: "ERROR", detail: e.message});
    failed++;
  }

  // Weather Tool - Astronomy
  try {
    console.log("\nTesting WeatherTool astronomy with real API...");
    var weatherTool2 = createWeatherTool();
    var astroResult = weatherTool2.fetchAstronomy(51.5074, -0.1278); // London
    if (astroResult.success && astroResult.data) {
      console.log("✓ WeatherTool (Astronomy) - Successfully fetched sun times for London");
      results.push({tool: "Weather (Astro)", status: "PASS", detail: "Fetched astronomy successfully"});
      passed++;
    } else {
      console.log("✗ WeatherTool (Astronomy) - Failed to fetch");
      results.push({tool: "Weather (Astro)", status: "FAIL", detail: astroResult.error || "Unknown error"});
      failed++;
    }
  } catch (e) {
    console.log("✗ WeatherTool (Astronomy) - Exception: " + e.message);
    results.push({tool: "Weather (Astro)", status: "ERROR", detail: e.message});
    failed++;
  }


  // News Tool - Real API call
  try {
    console.log("\nTesting NewsTool with real API...");
    var newsTool = createNewsTool();
    var newsResult = newsTool.fetch();
    if (newsResult.success && newsResult.data) {
      console.log("✓ NewsTool - Successfully fetched news headlines");
      results.push({tool: "News", status: "PASS", detail: "Fetched headlines successfully"});
      passed++;
    } else {
      console.log("✗ NewsTool - Failed to fetch news");
      results.push({tool: "News", status: "FAIL", detail: newsResult.error || "Unknown error"});
      failed++;
    }
  } catch (e) {
    console.log("✗ NewsTool - Exception: " + e.message);
    results.push({tool: "News", status: "ERROR", detail: e.message});
    failed++;
  }

  // GDACS Tool - Real API call
  try {
    console.log("\nTesting GdacsTool with real API...");
    var gdacsTool = createGdacsTool();
    var gdacsResult = gdacsTool.fetchNearby(35.6762, 139.6503); // Tokyo
    if (gdacsResult.success) {
      console.log("✓ GdacsTool - Successfully fetched disaster alerts");
      results.push({tool: "GDACS", status: "PASS", detail: "Fetched alerts successfully (may be empty)"});
      passed++;
    } else {
      console.log("✗ GdacsTool - Failed to fetch alerts");
      results.push({tool: "GDACS", status: "FAIL", detail: gdacsResult.error || "Unknown error"});
      failed++;
    }
  } catch (e) {
    console.log("✗ GdacsTool - Exception: " + e.message);
    results.push({tool: "GDACS", status: "ERROR", detail: e.message});
    failed++;
  }

  // Search Tool - Real API call
  try {
    console.log("\nTesting SearchTool with real API...");
    var searchTool = createSearchTool();
    var searchResult = searchTool.fetch("OpenAI GPT");
    if (searchResult.success && searchResult.data) {
      console.log("✓ SearchTool - Successfully performed web search");
      results.push({tool: "Search", status: "PASS", detail: "Search completed successfully"});
      passed++;
    } else {
      console.log("✗ SearchTool - Failed to search");
      results.push({tool: "Search", status: "FAIL", detail: searchResult.error || "Unknown error"});
      failed++;
    }
  } catch (e) {
    console.log("✗ SearchTool - Exception: " + e.message);
    results.push({tool: "Search", status: "ERROR", detail: e.message});
    failed++;
  }

  // Browse Tool - Real API call
  try {
    console.log("\nTesting BrowseTool with real API...");
    var browseTool = createBrowseTool();
    var browseResult = browseTool.fetch("https://example.com");
    if (browseResult.success && browseResult.data) {
      console.log("✓ BrowseTool - Successfully fetched webpage");
      results.push({tool: "Browse", status: "PASS", detail: "Fetched webpage successfully"});
      passed++;
    } else {
      console.log("✗ BrowseTool - Failed to fetch webpage");
      results.push({tool: "Browse", status: "FAIL", detail: browseResult.error || "Unknown error"});
      failed++;
    }
  } catch (e) {
    console.log("✗ BrowseTool - Exception: " + e.message);
    results.push({tool: "Browse", status: "ERROR", detail: e.message});
    failed++;
  }

  // ReverseGeocode Tool - Real API call
  try {
    console.log("\nTesting ReverseGeocodeTool with real API...");
    var reverseGeocodeTool = createReverseGeocodeTool();
    var reverseGeocodeResult = reverseGeocodeTool.fetch(36.344227, -5.236868); // Gibraltar area
    if (reverseGeocodeResult.success && reverseGeocodeResult.data) {
      console.log("✓ ReverseGeocodeTool - Successfully reverse geocoded coordinates");
      results.push({tool: "ReverseGeocode", status: "PASS", detail: "Reverse geocoded successfully"});
      passed++;
    } else {
      console.log("✗ ReverseGeocodeTool - Failed to reverse geocode");
      results.push({tool: "ReverseGeocode", status: "FAIL", detail: reverseGeocodeResult.error || "Unknown error"});
      failed++;
    }
  } catch (e) {
    console.log("✗ ReverseGeocodeTool - Exception: " + e.message);
    results.push({tool: "ReverseGeocode", status: "ERROR", detail: e.message});
    failed++;
  }

  // Summary
  console.log("\n╔════════════════════════════════════════════════════════════╗");
  console.log("║           INTEGRATION TEST RESULTS (Informational)        ║");
  console.log("╚════════════════════════════════════════════════════════════╝");
  console.log("\nPassed: " + passed + "/" + (passed + failed));
  console.log("Failed: " + failed + "/" + (passed + failed));

  if (failed > 0) {
    console.log("\n⚠ Failed Tests (informational - not counted as failures):");
    for (var i = 0; i < results.length; i++) {
      if (results[i].status !== "PASS") {
        console.log("  • " + results[i].tool + ": " + results[i].detail);
      }
    }
  }

  console.log("\nℹ Integration tests verify real API connectivity.");
  console.log("  Failures may indicate network issues, API changes, or rate limits.");
  console.log("  These are informational only and do not affect unit test pass/fail status.\n");

  return {
    passed: passed,
    failed: failed,
    total: passed + failed,
    results: results
  };
}

/**
 * Quick integration test for a specific tool
 */
function testWikipediaIntegration() {
  console.log("Testing Wikipedia with real API...");
  var tool = createWikipediaTool();
  var result = tool.fetch("JavaScript");
  console.log("Success: " + result.success);
  console.log("Data length: " + (result.data ? result.data.length : 0));
  console.log("Error: " + result.error);
  return result;
}

function testWeatherIntegration() {
  console.log("Testing Weather with real API...");
  var tool = createWeatherTool();
  var result = tool.fetch(40.7128, -74.0060); // NYC
  console.log("Success: " + result.success);
  console.log("Data: " + result.data);
  console.log("Error: " + result.error);
  return result;
}

function testNewsIntegration() {
  console.log("Testing News with real API...");
  var tool = createNewsTool();
  var result = tool.fetch();
  console.log("Success: " + result.success);
  console.log("Data: " + result.data);
  console.log("Error: " + result.error);
  return result;
}

function testGdacsIntegration() {
  console.log("Testing GDACS with real API...");
  var tool = createGdacsTool();
  var result = tool.fetchNearby(35.6762, 139.6503); // Tokyo
  console.log("Success: " + result.success);
  console.log("Data: " + result.data);
  console.log("Error: " + result.error);
  return result;
}

function testSearchIntegration() {
  console.log("Testing Search with real API...");
  var tool = createSearchTool();
  var result = tool.fetch("OpenAI GPT");
  console.log("Success: " + result.success);
  console.log("Data length: " + (result.data ? result.data.length : 0));
  console.log("Error: " + result.error);
  return result;
}

function testBrowseIntegration() {
  console.log("Testing Browse with real API...");
  var tool = createBrowseTool();
  var result = tool.fetch("https://example.com");
  console.log("Success: " + result.success);
  console.log("Data length: " + (result.data ? result.data.length : 0));
  console.log("Error: " + result.error);
  return result;
}

function testReverseGeocodeIntegration() {
  console.log("Testing ReverseGeocode with real API...");
  var tool = createReverseGeocodeTool();
  var result = tool.fetch(36.344227, -5.236868); // Gibraltar area
  console.log("Success: " + result.success);
  console.log("Data: " + result.data);
  console.log("Error: " + result.error);
  return result;
}
