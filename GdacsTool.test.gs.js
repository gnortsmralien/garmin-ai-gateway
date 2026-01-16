/**
 * GDACS Tool Tests
 */

function runGdacsToolTests() {
  var runner = new TestRunner();

  // Test 1: Successful fetch with nearby alerts
  runner.test("GdacsTool - finds nearby alerts", function() {
    var mockHttp = new MockHttpClient();
    var mockXml = new MockXmlParser();

    mockHttp.mockResponse("gdacs.org", 200, "<rss></rss>");
    mockXml.mockGdacsResponse([
      { level: "Orange", lat: 40.5, lon: -3.7, title: "Earthquake M6.5", type: "EQ" }
    ]);

    var tool = new GdacsTool(mockHttp, mockXml, new GdacsConfig());
    var result = tool.fetchNearby(40.4168, -3.7038);

    assertTrue(result.success);
    assertTrue(result.data.indexOf("ORANGE") !== -1);
    assertTrue(result.data.indexOf("EQ") !== -1);
    assertEquals(result.error, null);
  });

  // Test 2: No alerts nearby
  runner.test("GdacsTool - no alerts nearby", function() {
    var mockHttp = new MockHttpClient();
    var mockXml = new MockXmlParser();

    mockHttp.mockResponse("gdacs.org", 200, "<rss></rss>");
    mockXml.mockGdacsResponse([]);

    var tool = new GdacsTool(mockHttp, mockXml, new GdacsConfig());
    var result = tool.fetchNearby(40.4168, -3.7038);

    assertTrue(result.success);
    assertEquals(result.data, null);
    assertEquals(result.error, null);
  });

  // Test 3: HTTP error
  runner.test("GdacsTool - handles HTTP 503", function() {
    var mockHttp = new MockHttpClient();
    var mockXml = new MockXmlParser();

    mockHttp.mockResponse("gdacs.org", 503, "Service Unavailable");

    var tool = new GdacsTool(mockHttp, mockXml, new GdacsConfig());
    var result = tool.fetchNearby(40.4168, -3.7038);

    assertFalse(result.success);
    assertEquals(result.error, "HTTP_503");
    assertEquals(result.data, null);
  });

  // Test 4: Invalid XML/RSS
  runner.test("GdacsTool - handles invalid XML", function() {
    var mockHttp = new MockHttpClient();
    var mockXml = new MockXmlParser();

    mockHttp.mockResponse("gdacs.org", 200, "<rss></rss>");
    mockXml.mockError("INVALID_RSS");

    var tool = new GdacsTool(mockHttp, mockXml, new GdacsConfig());
    var result = tool.fetchNearby(40.4168, -3.7038);

    assertFalse(result.success);
    assertEquals(result.error, "INVALID_RSS");
  });

  // Test 5: Filter by alert level (Orange only)
  runner.test("GdacsTool - filters Green alerts when min is Orange", function() {
    var mockHttp = new MockHttpClient();
    var mockXml = new MockXmlParser();

    mockHttp.mockResponse("gdacs.org", 200, "<rss></rss>");
    mockXml.mockGdacsResponse([
      { level: "Green", lat: 40.5, lon: -3.7, title: "Minor Event", type: "EQ" },
      { level: "Orange", lat: 40.5, lon: -3.7, title: "Major Event", type: "FL" }
    ]);

    var tool = new GdacsTool(mockHttp, mockXml, new GdacsConfig(null, 500, "Orange"));
    var result = tool.fetchNearby(40.4168, -3.7038);

    assertTrue(result.success);
    assertTrue(result.data.indexOf("Major Event") !== -1);
    assertTrue(result.data.indexOf("Minor Event") === -1);
  });

  // Test 6: Filter by distance
  runner.test("GdacsTool - filters alerts beyond radius", function() {
    var mockHttp = new MockHttpClient();
    var mockXml = new MockXmlParser();

    mockHttp.mockResponse("gdacs.org", 200, "<rss></rss>");
    mockXml.mockGdacsResponse([
      { level: "Orange", lat: 50.0, lon: 10.0, title: "Far Event", type: "EQ" }  // >500km away
    ]);

    var tool = new GdacsTool(mockHttp, mockXml, new GdacsConfig(null, 500));
    var result = tool.fetchNearby(40.4168, -3.7038);

    assertTrue(result.success);
    assertEquals(result.data, null);  // Too far, no alerts
  });

  // Test 7: Sort by distance
  runner.test("GdacsTool - sorts alerts by distance", function() {
    var mockHttp = new MockHttpClient();
    var mockXml = new MockXmlParser();

    mockHttp.mockResponse("gdacs.org", 200, "<rss></rss>");
    mockXml.mockGdacsResponse([
      { level: "Orange", lat: 41.0, lon: -3.7, title: "Far", type: "EQ" },
      { level: "Orange", lat: 40.5, lon: -3.7, title: "Near", type: "FL" }
    ]);

    var tool = new GdacsTool(mockHttp, mockXml, new GdacsConfig());
    var result = tool.fetchNearby(40.4168, -3.7038);

    assertTrue(result.success);
    var lines = result.data.split("\n");
    assertTrue(lines[0].indexOf("Near") !== -1);  // Closest first
  });

  // Test 8: Max 3 alerts shown
  runner.test("GdacsTool - shows max 3 alerts", function() {
    var mockHttp = new MockHttpClient();
    var mockXml = new MockXmlParser();

    mockHttp.mockResponse("gdacs.org", 200, "<rss></rss>");
    mockXml.mockGdacsResponse([
      { level: "Orange", lat: 40.5, lon: -3.7, title: "Event 1", type: "EQ" },
      { level: "Orange", lat: 40.6, lon: -3.7, title: "Event 2", type: "FL" },
      { level: "Orange", lat: 40.7, lon: -3.7, title: "Event 3", type: "TC" },
      { level: "Orange", lat: 40.8, lon: -3.7, title: "Event 4", type: "VO" }
    ]);

    var tool = new GdacsTool(mockHttp, mockXml, new GdacsConfig());
    var result = tool.fetchNearby(40.4168, -3.7038);

    assertTrue(result.success);
    var lines = result.data.split("\n");
    assertEquals(lines.length, 3);
  });

  // Test 9: Haversine distance calculation
  runner.test("GdacsTool - calculates distance correctly", function() {
    var tool = new GdacsTool(null, null, new GdacsConfig());

    // Madrid to Barcelona ~500km
    var distance = tool.haversineDistance(40.4168, -3.7038, 41.3851, 2.1734);

    assertTrue(distance > 480 && distance < 520);
  });

  // Test 10: Exception handling
  runner.test("GdacsTool - handles exceptions", function() {
    var mockHttp = new MockHttpClient();
    var mockXml = new MockXmlParser();

    // Mock will throw when httpClient is null
    var tool = new GdacsTool(null, mockXml, new GdacsConfig());
    var result = tool.fetchNearby(40.4168, -3.7038);

    assertFalse(result.success);
    assertTrue(result.error.indexOf("EXCEPTION") !== -1);
  });

  return runner.run();
}
