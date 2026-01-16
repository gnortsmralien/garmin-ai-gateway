/**
 * Unit Tests for ReverseGeocodeTool
 *
 * Run these tests by calling: runReverseGeocodeToolTests()
 */

function runReverseGeocodeToolTests() {
  var runner = new TestRunner();

  // Test 1: Successful reverse geocode with full address
  runner.test("ReverseGeocodeTool - successful reverse geocode returns location", function() {
    var mockHttp = new MockHttpClient();
    var config = new ReverseGeocodeConfig();
    var tool = new ReverseGeocodeTool(mockHttp, config);

    mockHttp.mockJsonResponse("nominatim.openstreetmap.org", {
      place_id: 12345,
      display_name: "Main Street, Downtown, San Francisco, California, USA",
      address: {
        city: "San Francisco",
        state: "California",
        country: "USA"
      }
    });

    var result = tool.fetch(37.7749, -122.4194);

    assertTrue(result.success, "Should succeed");
    assertNotNull(result.data, "Should have data");
    assertContains(result.data, "San Francisco", "Should contain city name");
    assertContains(result.data, "California", "Should contain state");
    assertContains(result.data, "USA", "Should contain country");
  });

  // Test 2: Village location with natural features
  runner.test("ReverseGeocodeTool - handles village with natural features", function() {
    var mockHttp = new MockHttpClient();
    var config = new ReverseGeocodeConfig();
    var tool = new ReverseGeocodeTool(mockHttp, config);

    mockHttp.mockJsonResponse("nominatim.openstreetmap.org", {
      display_name: "Zermatt, Switzerland",
      address: {
        village: "Zermatt",
        state: "Valais",
        country: "Switzerland",
        peak: "Matterhorn"
      }
    });

    var result = tool.fetch(46.0207, 7.7491);

    assertTrue(result.success, "Should succeed");
    assertContains(result.data, "Zermatt", "Should contain village name");
    assertContains(result.data, "Matterhorn", "Should mention nearby peak");
  });

  // Test 3: Town location without state
  runner.test("ReverseGeocodeTool - handles town without state", function() {
    var mockHttp = new MockHttpClient();
    var config = new ReverseGeocodeConfig();
    var tool = new ReverseGeocodeTool(mockHttp, config);

    mockHttp.mockJsonResponse("nominatim.openstreetmap.org", {
      display_name: "Gibraltar",
      address: {
        town: "Gibraltar",
        country: "Gibraltar"
      }
    });

    var result = tool.fetch(36.1408, -5.3536);

    assertTrue(result.success, "Should succeed");
    assertContains(result.data, "Gibraltar", "Should contain location name");
    assertFalse(result.data.indexOf("undefined") >= 0, "Should not contain 'undefined'");
  });

  // Test 4: HTTP error handling
  runner.test("ReverseGeocodeTool - handles HTTP errors", function() {
    var mockHttp = new MockHttpClient();
    var config = new ReverseGeocodeConfig();
    var tool = new ReverseGeocodeTool(mockHttp, config);

    mockHttp.mockResponse("nominatim.openstreetmap.org", 500, "Server Error");

    var result = tool.fetch(40.7128, -74.0060);

    assertFalse(result.success, "Should fail");
    assertEquals(result.error, "HTTP_500", "Should have HTTP_500 error");
    assertEquals(result.data, null, "Should have no data");
  });

  // Test 5: Location not found
  runner.test("ReverseGeocodeTool - handles location not found", function() {
    var mockHttp = new MockHttpClient();
    var config = new ReverseGeocodeConfig();
    var tool = new ReverseGeocodeTool(mockHttp, config);

    mockHttp.mockJsonResponse("nominatim.openstreetmap.org", {
      error: "Unable to geocode"
    });

    var result = tool.fetch(0, 0); // Middle of ocean

    assertFalse(result.success, "Should fail");
    assertEquals(result.error, "NOT_FOUND", "Should have NOT_FOUND error");
  });

  // Test 6: Malformed JSON response
  runner.test("ReverseGeocodeTool - handles malformed JSON", function() {
    var mockHttp = new MockHttpClient();
    var config = new ReverseGeocodeConfig();
    var tool = new ReverseGeocodeTool(mockHttp, config);

    mockHttp.mockResponse("nominatim.openstreetmap.org", 200, "invalid json");

    var result = tool.fetch(40.7128, -74.0060);

    assertFalse(result.success, "Should fail");
    assertContains(result.error, "EXCEPTION", "Should have exception error");
  });

  // Test 7: URL contains correct parameters
  runner.test("ReverseGeocodeTool - builds URL with correct parameters", function() {
    var mockHttp = new MockHttpClient();
    var config = new ReverseGeocodeConfig();
    var tool = new ReverseGeocodeTool(mockHttp, config);

    mockHttp.mockJsonResponse("nominatim.openstreetmap.org", {
      display_name: "Test Location",
      address: {
        city: "Test City",
        country: "Test Country"
      }
    });

    tool.fetch(52.52, 13.41);

    var requests = mockHttp.getRequests();
    assertEquals(requests.length, 1, "Should make one request");
    assertContains(requests[0].url, "lat=52.52", "Should include latitude");
    assertContains(requests[0].url, "lon=13.41", "Should include longitude");
    assertContains(requests[0].url, "format=json", "Should request JSON format");
    assertContains(requests[0].url, "addressdetails=1", "Should request address details");
  });

  // Test 8: Falls back to display_name when no structured address
  runner.test("ReverseGeocodeTool - uses display_name when address is empty", function() {
    var mockHttp = new MockHttpClient();
    var config = new ReverseGeocodeConfig();
    var tool = new ReverseGeocodeTool(mockHttp, config);

    mockHttp.mockJsonResponse("nominatim.openstreetmap.org", {
      display_name: "Remote Location, Somewhere Far Away",
      address: {}
    });

    var result = tool.fetch(0, 0);

    assertTrue(result.success, "Should succeed");
    assertContains(result.data, "Remote Location", "Should use display_name");
  });

  // Test 9: Custom user agent is sent
  runner.test("ReverseGeocodeTool - sends custom User-Agent header", function() {
    var mockHttp = new MockHttpClient();
    var config = new ReverseGeocodeConfig("https://nominatim.openstreetmap.org/reverse", "TestAgent/1.0");
    var tool = new ReverseGeocodeTool(mockHttp, config);

    mockHttp.mockJsonResponse("nominatim.openstreetmap.org", {
      display_name: "Test",
      address: { city: "Test" }
    });

    tool.fetch(40.7128, -74.0060);

    var requests = mockHttp.getRequests();
    assertEquals(requests.length, 1, "Should make one request");
    assertNotNull(requests[0].options, "Should have options");
    assertNotNull(requests[0].options.headers, "Should have headers");
    assertEquals(requests[0].options.headers["User-Agent"], "TestAgent/1.0", "Should use custom user agent");
  });

  // Test 10: Handles water bodies
  runner.test("ReverseGeocodeTool - includes water body information", function() {
    var mockHttp = new MockHttpClient();
    var config = new ReverseGeocodeConfig();
    var tool = new ReverseGeocodeTool(mockHttp, config);

    mockHttp.mockJsonResponse("nominatim.openstreetmap.org", {
      display_name: "Lake Geneva Area",
      address: {
        village: "Montreux",
        state: "Vaud",
        country: "Switzerland",
        water: "Lake Geneva"
      }
    });

    var result = tool.fetch(46.4312, 6.9107);

    assertTrue(result.success, "Should succeed");
    assertContains(result.data, "Montreux", "Should contain village");
    assertContains(result.data, "Lake Geneva", "Should mention water body");
  });

  // Test 11: Coordinates formatting precision
  runner.test("ReverseGeocodeTool - handles precise coordinates", function() {
    var mockHttp = new MockHttpClient();
    var config = new ReverseGeocodeConfig();
    var tool = new ReverseGeocodeTool(mockHttp, config);

    mockHttp.mockJsonResponse("nominatim.openstreetmap.org", {
      display_name: "Test",
      address: { city: "Test" }
    });

    tool.fetch(36.344227, -5.236868);

    var requests = mockHttp.getRequests();
    assertContains(requests[0].url, "lat=36.344227", "Should preserve latitude precision");
    assertContains(requests[0].url, "lon=-5.236868", "Should preserve longitude precision");
  });

  // Test 12: Edge case - only country available
  runner.test("ReverseGeocodeTool - handles minimal address data", function() {
    var mockHttp = new MockHttpClient();
    var config = new ReverseGeocodeConfig();
    var tool = new ReverseGeocodeTool(mockHttp, config);

    mockHttp.mockJsonResponse("nominatim.openstreetmap.org", {
      display_name: "Middle of Nowhere",
      address: {
        country: "Antarctica"
      }
    });

    var result = tool.fetch(-90, 0); // South Pole

    assertTrue(result.success, "Should succeed");
    assertContains(result.data, "Antarctica", "Should show country");
  });

  return runner.run();
}
