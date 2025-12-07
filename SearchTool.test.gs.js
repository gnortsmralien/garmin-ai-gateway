/**
 * Search Tool Tests
 */

function runSearchToolTests() {
  var runner = new TestRunner();

  // Test 1: Successful search
  runner.test("SearchTool - successful search returns results", function() {
    var mockHttp = new MockHttpClient();
    var html = '<a class="result__a" href="https://example.com">Test Result</a>' +
                '<a class="result__snippet">Test snippet</a>';
    mockHttp.mockResponse("duckduckgo.com", 200, html);

    var tool = new SearchTool(mockHttp, new SearchConfig());
    var result = tool.fetch("test query");

    assertTrue(result.success);
    assertTrue(result.data.indexOf("Test Result") !== -1);
    assertTrue(result.data.indexOf("Test snippet") !== -1);
    assertEquals(result.error, null);
  });

  // Test 2: No results found
  runner.test("SearchTool - handles no results", function() {
    var mockHttp = new MockHttpClient();
    mockHttp.mockResponse("duckduckgo.com", 200, "<html><body></body></html>");

    var tool = new SearchTool(mockHttp, new SearchConfig());
    var result = tool.fetch("nonexistent query");

    assertFalse(result.success);
    assertEquals(result.error, "NO_RESULTS");
    assertEquals(result.data, null);
  });

  // Test 3: HTTP error
  runner.test("SearchTool - handles HTTP 503", function() {
    var mockHttp = new MockHttpClient();
    mockHttp.mockResponse("duckduckgo.com", 503, "Service Unavailable");

    var tool = new SearchTool(mockHttp, new SearchConfig());
    var result = tool.fetch("test");

    assertFalse(result.success);
    assertEquals(result.error, "HTTP_503");
  });

  // Test 4: Multiple results
  runner.test("SearchTool - parses multiple results", function() {
    var mockHttp = new MockHttpClient();
    var html = '<a class="result__a" href="https://one.com">Result 1</a>' +
                '<a class="result__snippet">Snippet 1</a>' +
                '<a class="result__a" href="https://two.com">Result 2</a>' +
                '<a class="result__snippet">Snippet 2</a>';
    mockHttp.mockResponse("duckduckgo.com", 200, html);

    var tool = new SearchTool(mockHttp, new SearchConfig());
    var result = tool.fetch("test");

    assertTrue(result.success);
    assertTrue(result.data.indexOf("Result 1") !== -1);
    assertTrue(result.data.indexOf("Result 2") !== -1);
  });

  // Test 6: URL decoding
  runner.test("SearchTool - decodes DuckDuckGo redirect URLs", function() {
    var tool = new SearchTool(null, new SearchConfig());
    var encoded = "//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com";
    var decoded = tool.decodeUrl(encoded);

    assertEquals(decoded, "https://example.com");
  });

  // Test 7: Text cleaning (HTML entities)
  runner.test("SearchTool - cleans HTML entities", function() {
    var tool = new SearchTool(null, new SearchConfig());
    var dirty = "Test &amp; Example &quot;text&quot;";
    var clean = tool.cleanText(dirty);

    assertEquals(clean, 'Test & Example "text"');
  });

  // Test 8: Text cleaning (HTML tags)
  runner.test("SearchTool - removes HTML tags", function() {
    var tool = new SearchTool(null, new SearchConfig());
    var dirty = "Test <b>bold</b> <i>italic</i>";
    var clean = tool.cleanText(dirty);

    assertEquals(clean, "Test bold italic");
  });

  // Test 9: Exception handling
  runner.test("SearchTool - handles exceptions", function() {
    var tool = new SearchTool(null, new SearchConfig());
    var result = tool.fetch("test");

    assertFalse(result.success);
    assertTrue(result.error.indexOf("EXCEPTION") !== -1);
  });

  // Test 10: Empty query handling
  runner.test("SearchTool - handles empty results gracefully", function() {
    var mockHttp = new MockHttpClient();
    mockHttp.mockResponse("duckduckgo.com", 200, "");

    var tool = new SearchTool(mockHttp, new SearchConfig());
    var result = tool.fetch("");

    assertFalse(result.success);
    assertEquals(result.error, "NO_RESULTS");
  });

  return runner.run();
}
