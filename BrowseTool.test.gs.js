/**
 * Browse Tool Tests
 */

function runBrowseToolTests() {
  var runner = new TestRunner();

  // Test 2: JSON response
  runner.test("BrowseTool - handles JSON responses", function() {
    var mockHttp = new MockHttpClient();
    mockHttp.mockJsonResponse("api.example.com", { message: "Hello", status: "ok" });

    var tool = new BrowseTool(mockHttp, new BrowseConfig());
    var result = tool.fetch("https://api.example.com/data");

    assertTrue(result.success);
    assertTrue(result.data.indexOf("Hello") !== -1);
    assertTrue(result.data.indexOf("ok") !== -1);
  });

  // Test 3: Plain text response
  runner.test("BrowseTool - handles plain text", function() {
    var mockHttp = new MockHttpClient();
    mockHttp.mockResponse("example.com", 200, "Plain text content", {"Content-Type": "text/plain"});

    var tool = new BrowseTool(mockHttp, new BrowseConfig());
    var result = tool.fetch("https://example.com/file.txt");

    assertTrue(result.success);
    assertEquals(result.data, "Plain text content");
  });

  // Test 4: HTTP 404
  runner.test("BrowseTool - handles 404 not found", function() {
    var mockHttp = new MockHttpClient();
    mockHttp.mockResponse("example.com", 404, "Not Found");

    var tool = new BrowseTool(mockHttp, new BrowseConfig());
    var result = tool.fetch("https://example.com/missing");

    assertFalse(result.success);
    assertEquals(result.error, "NOT_FOUND");
  });

  // Test 5: HTTP 403
  runner.test("BrowseTool - handles 403 forbidden", function() {
    var mockHttp = new MockHttpClient();
    mockHttp.mockResponse("example.com", 403, "Forbidden");

    var tool = new BrowseTool(mockHttp, new BrowseConfig());
    var result = tool.fetch("https://example.com/private");

    assertFalse(result.success);
    assertEquals(result.error, "FORBIDDEN");
  });

  // Test 6: Invalid URL
  runner.test("BrowseTool - rejects invalid URLs", function() {
    var tool = new BrowseTool(new MockHttpClient(), new BrowseConfig());
    var result = tool.fetch("not-a-url");

    assertFalse(result.success);
    assertEquals(result.error, "INVALID_URL");
  });

  // Test 7: Extract article content
  runner.test("BrowseTool - extracts article content", function() {
    var mockHttp = new MockHttpClient();
    var html = '<html><body><nav>Nav content</nav><article><h1>Article Title</h1><p>Article content</p></article><footer>Footer</footer></body></html>';
    mockHttp.mockResponse("example.com", 200, html, {"Content-Type": "text/html"});

    var tool = new BrowseTool(mockHttp, new BrowseConfig());
    var result = tool.fetch("https://example.com/article");

    assertTrue(result.success);
    assertTrue(result.data.indexOf("Article content") !== -1);
    // Should prefer article content over nav/footer
  });

  // Test 8: Content length limit
  runner.test("BrowseTool - respects content length limit", function() {
    var mockHttp = new MockHttpClient();
    var longContent = new Array(5000).join("a");
    mockHttp.mockResponse("example.com", 200, longContent, {"Content-Type": "text/plain"});

    var config = new BrowseConfig(100);  // Max 100 chars
    var tool = new BrowseTool(mockHttp, config);
    var result = tool.fetch("https://example.com");

    assertTrue(result.success);
    assertEquals(result.data.length, 100);
  });

  // Test 9: No content
  runner.test("BrowseTool - handles pages with no content", function() {
    var mockHttp = new MockHttpClient();
    mockHttp.mockResponse("example.com", 200, "<html><body></body></html>", {"Content-Type": "text/html"});

    var tool = new BrowseTool(mockHttp, new BrowseConfig());
    var result = tool.fetch("https://example.com");

    assertFalse(result.success);
    assertEquals(result.error, "NO_CONTENT");
  });

  // Test 10: Exception handling
  runner.test("BrowseTool - handles exceptions", function() {
    var tool = new BrowseTool(null, new BrowseConfig());
    var result = tool.fetch("https://example.com");

    assertFalse(result.success);
    assertTrue(result.error.indexOf("EXCEPTION") !== -1);
  });

  return runner.run();
}
