/**
 * Main Test Runner
 *
 * This file provides a central place to run all tests.
 * Add this to your Google Apps Script project and run runAllTests() from the script editor.
 */

/**
 * Run all unit tests
 * Logs results to console and returns true if all tests pass
 */
function runAllTests() {
  console.log("╔════════════════════════════════════════════════════════════╗");
  console.log("║       GARMIN AI GATEWAY - UNIT TEST SUITE                 ║");
  console.log("╚════════════════════════════════════════════════════════════╝\n");

  var allPassed = true;
  var totalTests = 0;
  var totalPassed = 0;
  var totalFailed = 0;

  // Wikipedia Tool Tests
  console.log("\n┌─────────────────────────────────────────────────────────┐");
  console.log("│ Wikipedia Tool Tests                                     │");
  console.log("└─────────────────────────────────────────────────────────┘");
  var wikiPassed = runWikipediaToolTests();
  if (!wikiPassed) allPassed = false;

  // Weather Tool Tests
  console.log("\n┌─────────────────────────────────────────────────────────┐");
  console.log("│ Weather Tool Tests                                       │");
  console.log("└─────────────────────────────────────────────────────────┘");
  var weatherPassed = runWeatherToolTests();
  if (!weatherPassed) allPassed = false;

  // News Tool Tests
  console.log("\n┌─────────────────────────────────────────────────────────┐");
  console.log("│ News Tool Tests                                          │");
  console.log("└─────────────────────────────────────────────────────────┘");
  var newsPassed = runNewsToolTests();
  if (!newsPassed) allPassed = false;

  // GDACS Tool Tests
  console.log("\n┌─────────────────────────────────────────────────────────┐");
  console.log("│ GDACS Tool Tests                                         │");
  console.log("└─────────────────────────────────────────────────────────┘");
  var gdacsPassed = runGdacsToolTests();
  if (!gdacsPassed) allPassed = false;

  // NOTE: Search and Browse tool tests removed - replaced by Interactions API built-in tools

  // ReverseGeocode Tool Tests
  console.log("\n┌─────────────────────────────────────────────────────────┐");
  console.log("│ ReverseGeocode Tool Tests                                │");
  console.log("└─────────────────────────────────────────────────────────┘");
  var reverseGeocodePassed = runReverseGeocodeToolTests();
  if (!reverseGeocodePassed) allPassed = false;

  // Summary
  console.log("\n╔════════════════════════════════════════════════════════════╗");
  console.log("║                    FINAL RESULTS                          ║");
  console.log("╚════════════════════════════════════════════════════════════╝");

  if (allPassed) {
    console.log("✓ ALL UNIT TESTS PASSED");
  } else {
    console.log("✗ SOME UNIT TESTS FAILED - See output above");
  }

  console.log("\n");

  return allPassed;
}

/**
 * Run all tests including integration tests
 * Integration test failures are informational only
 */
function runAllTestsWithIntegration() {
  // Run unit tests first
  var unitTestsPassed = runAllTests();

  // Run integration tests (failures are informational)
  var integrationResults = runIntegrationTests();

  // Final summary
  console.log("\n╔════════════════════════════════════════════════════════════╗");
  console.log("║                  COMPLETE TEST SUMMARY                    ║");
  console.log("╚════════════════════════════════════════════════════════════╝");
  console.log("\nUnit Tests: " + (unitTestsPassed ? "✓ PASSED" : "✗ FAILED"));
  console.log("Integration Tests: " + integrationResults.passed + "/" + integrationResults.total + " passed (informational)");

  if (integrationResults.failed > 0) {
    console.log("\n⚠ Note: Integration test failures are informational and may indicate:");
    console.log("  • Network connectivity issues");
    console.log("  • API rate limiting");
    console.log("  • Temporary API unavailability");
    console.log("  • API response format changes");
  }

  console.log("\n");

  return unitTestsPassed;
}

/**
 * Run only Wikipedia tests
 */
function testWikipedia() {
  return runWikipediaToolTests();
}

/**
 * Run only Weather tests
 */
function testWeather() {
  return runWeatherToolTests();
}

/**
 * Run only News tests
 */
function testNews() {
  return runNewsToolTests();
}

/**
 * Run only GDACS tests
 */
function testGdacs() {
  return runGdacsToolTests();
}

/**
 * Run only ReverseGeocode tests
 */
function testReverseGeocode() {
  return runReverseGeocodeToolTests();
}

/**
 * Quick smoke test - runs a subset of critical tests
 */
function runSmokeTests() {
  console.log("=== SMOKE TESTS ===\n");

  var runner = new TestRunner();

  runner.test("HttpClient Mock - basic functionality", function() {
    var mock = new MockHttpClient();
    mock.mockResponse("test.com", 200, "OK");
    var response = mock.fetch("https://test.com/api", {});
    assertEquals(response.getResponseCode(), 200);
    assertEquals(response.getContentText(), "OK");
  });

  runner.test("WikipediaTool - can be instantiated", function() {
    var tool = new WikipediaTool(new MockHttpClient(), new WikipediaConfig());
    assertNotNull(tool);
  });

  runner.test("WeatherTool - can be instantiated", function() {
    var tool = new WeatherTool(new MockHttpClient(), new WeatherConfig());
    assertNotNull(tool);
  });

  return runner.run();
}

/**
 * Example: How to write a new test
 */
function exampleCustomTest() {
  var runner = new TestRunner();

  runner.test("Example test - demonstrates assertions", function() {
    // Arrange
    var expected = 42;

    // Act
    var actual = 40 + 2;

    // Assert
    assertEquals(actual, expected, "Math should work");
    assertTrue(actual > 0, "Should be positive");
    assertNotNull(actual, "Should not be null");
  });

  return runner.run();
}
