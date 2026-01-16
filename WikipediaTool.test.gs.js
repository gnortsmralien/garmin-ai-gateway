/**
 * Unit Tests for WikipediaTool
 *
 * Run these tests by calling: runWikipediaToolTests()
 */

/**
 * Simple test framework for Google Apps Script
 */
function TestRunner() {
  this.tests = [];
  this.passed = 0;
  this.failed = 0;
}

TestRunner.prototype.test = function(name, fn) {
  this.tests.push({ name: name, fn: fn });
};

TestRunner.prototype.run = function() {
  console.log("\n=== Running Tests ===\n");

  for (var i = 0; i < this.tests.length; i++) {
    var test = this.tests[i];
    try {
      test.fn();
      this.passed++;
      console.log("✓ " + test.name);
    } catch (e) {
      this.failed++;
      console.log("✗ " + test.name);
      console.log("  Error: " + e.message);
      if (e.stack) {
        console.log("  Stack: " + e.stack);
      }
    }
  }

  console.log("\n=== Test Results ===");
  console.log("Passed: " + this.passed);
  console.log("Failed: " + this.failed);
  console.log("Total: " + this.tests.length);

  return this.failed === 0;
};

/**
 * Simple assertions
 */
function assert(condition, message) {
  if (!condition) {
    throw new Error(message || "Assertion failed");
  }
}

function assertEquals(actual, expected, message) {
  if (actual !== expected) {
    throw new Error(
      (message || "Assertion failed") +
      "\nExpected: " + JSON.stringify(expected) +
      "\nActual: " + JSON.stringify(actual)
    );
  }
}

function assertNotNull(value, message) {
  if (value === null || value === undefined) {
    throw new Error(message || "Value should not be null");
  }
}

function assertTrue(value, message) {
  assertEquals(value, true, message);
}

function assertFalse(value, message) {
  assertEquals(value, false, message);
}

function assertContains(haystack, needle, message) {
  if (typeof haystack === 'string' && haystack.indexOf(needle) === -1) {
    throw new Error(
      (message || "String should contain value") +
      "\nHaystack: " + haystack +
      "\nNeedle: " + needle
    );
  }
}

// =============================================================================
// WIKIPEDIA TOOL TESTS
// =============================================================================

function runWikipediaToolTests() {
  var runner = new TestRunner();

  // Test 1: Successful fetch
  runner.test("WikipediaTool - successful fetch returns data", function() {
    var mockHttp = new MockHttpClient();
    var config = new WikipediaConfig();
    var tool = new WikipediaTool(mockHttp, config);

    mockHttp.mockJsonResponse("wikipedia.org", {
      type: "standard",
      extract: "Hypothermia is a medical emergency that occurs when your body loses heat faster than it can produce heat."
    });

    var result = tool.fetch("hypothermia");

    assertTrue(result.success, "Should succeed");
    assertNotNull(result.data, "Should have data");
    assertContains(result.data, "Hypothermia", "Should contain search term");
    assertEquals(result.error, null, "Should have no error");
  });

  // Test 2: 404 Not Found
  runner.test("WikipediaTool - handles 404 not found", function() {
    var mockHttp = new MockHttpClient();
    var config = new WikipediaConfig();
    var tool = new WikipediaTool(mockHttp, config);

    mockHttp.mockResponse("wikipedia.org", 404, "Not Found");

    var result = tool.fetch("nonexistentpage12345");

    assertFalse(result.success, "Should fail");
    assertEquals(result.error, "NOT_FOUND", "Should have NOT_FOUND error");
    assertEquals(result.data, null, "Should have no data");
  });

  // Test 3: Disambiguation page
  runner.test("WikipediaTool - handles disambiguation pages", function() {
    var mockHttp = new MockHttpClient();
    var config = new WikipediaConfig();
    var tool = new WikipediaTool(mockHttp, config);

    mockHttp.mockJsonResponse("wikipedia.org", {
      type: "disambiguation",
      extract: "Mercury may refer to..."
    });

    var result = tool.fetch("mercury");

    assertFalse(result.success, "Should fail on disambiguation");
    assertEquals(result.error, "DISAMBIGUATION", "Should have DISAMBIGUATION error");
  });

  // Test 4: Truncates long extracts
  runner.test("WikipediaTool - truncates long extracts", function() {
    var mockHttp = new MockHttpClient();
    var config = new WikipediaConfig("https://en.wikipedia.org/api/rest_v1/page/summary", 100, "test");
    var tool = new WikipediaTool(mockHttp, config);

    var longText = "";
    for (var i = 0; i < 200; i++) {
      longText += "word ";
    }

    mockHttp.mockJsonResponse("wikipedia.org", {
      type: "standard",
      extract: longText
    });

    var result = tool.fetch("test");

    assertTrue(result.success, "Should succeed");
    assertTrue(result.data.length <= 103, "Should truncate to max + '...'"); // 100 + "..."
    assertContains(result.data, "...", "Should end with ellipsis");
  });

  // Test 5: HTTP error codes
  runner.test("WikipediaTool - handles HTTP errors", function() {
    var mockHttp = new MockHttpClient();
    var config = new WikipediaConfig();
    var tool = new WikipediaTool(mockHttp, config);

    mockHttp.mockResponse("wikipedia.org", 500, "Internal Server Error");

    var result = tool.fetch("test");

    assertFalse(result.success, "Should fail");
    assertEquals(result.error, "HTTP_500", "Should have HTTP_500 error");
  });

  // Test 6: Malformed JSON
  runner.test("WikipediaTool - handles malformed JSON", function() {
    var mockHttp = new MockHttpClient();
    var config = new WikipediaConfig();
    var tool = new WikipediaTool(mockHttp, config);

    mockHttp.mockResponse("wikipedia.org", 200, "not valid json {{{");

    var result = tool.fetch("test");

    assertFalse(result.success, "Should fail");
    assertContains(result.error, "EXCEPTION", "Should have exception error");
  });

  // Test 7: Encodes query properly
  runner.test("WikipediaTool - encodes query in URL", function() {
    var mockHttp = new MockHttpClient();
    var config = new WikipediaConfig();
    var tool = new WikipediaTool(mockHttp, config);

    mockHttp.mockJsonResponse("wikipedia.org", {
      type: "standard",
      extract: "Test"
    });

    tool.fetch("first aid kit");

    var requests = mockHttp.getRequests();
    assertEquals(requests.length, 1, "Should make one request");
    assertContains(requests[0].url, "first%20aid%20kit", "Should encode spaces");
  });

  // Test 8: Sends correct User-Agent
  runner.test("WikipediaTool - sends User-Agent header", function() {
    var mockHttp = new MockHttpClient();
    var config = new WikipediaConfig("https://test.com", 500, "MyCustomAgent/1.0");
    var tool = new WikipediaTool(mockHttp, config);

    mockHttp.mockJsonResponse("test.com", {
      type: "standard",
      extract: "Test"
    });

    tool.fetch("test");

    var requests = mockHttp.getRequests();
    assertNotNull(requests[0].options.headers, "Should have headers");
    assertEquals(requests[0].options.headers['User-Agent'], "MyCustomAgent/1.0", "Should use custom User-Agent");
  });

  // Test 9: Empty extract
  runner.test("WikipediaTool - handles empty extract", function() {
    var mockHttp = new MockHttpClient();
    var config = new WikipediaConfig();
    var tool = new WikipediaTool(mockHttp, config);

    mockHttp.mockJsonResponse("wikipedia.org", {
      type: "standard",
      extract: ""
    });

    var result = tool.fetch("test");

    assertTrue(result.success, "Should succeed");
    assertEquals(result.data, "", "Should return empty string");
  });

  // Test 10: Trims whitespace from query
  runner.test("WikipediaTool - trims whitespace from query", function() {
    var mockHttp = new MockHttpClient();
    var config = new WikipediaConfig();
    var tool = new WikipediaTool(mockHttp, config);

    mockHttp.mockJsonResponse("wikipedia.org", {
      type: "standard",
      extract: "Test"
    });

    tool.fetch("  whitespace test  ");

    var requests = mockHttp.getRequests();
    assertContains(requests[0].url, "whitespace%20test", "Should trim whitespace");
  });

  return runner.run();
}
