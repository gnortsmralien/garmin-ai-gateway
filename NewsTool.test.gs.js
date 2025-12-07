/**
 * Unit Tests for NewsTool
 *
 * Run these tests by calling: runNewsToolTests()
 */

/**
 * Mock XML Service for testing
 * @implements {IXmlService}
 */
function MockXmlService() {
  this.mockDocument = null;
}

MockXmlService.prototype.parse = function(xmlString) {
  if (this.mockDocument) {
    return this.mockDocument;
  }
  throw new Error("No mock XML document configured");
};

MockXmlService.prototype.setMockDocument = function(doc) {
  this.mockDocument = doc;
};

/**
 * Helper to create mock XML elements
 */
function MockXmlElement(name, text) {
  this.name = name;
  this.text = text || null;
  this.children = [];
}

MockXmlElement.prototype.getChild = function(childName) {
  for (var i = 0; i < this.children.length; i++) {
    if (this.children[i].name === childName) {
      return this.children[i];
    }
  }
  return null;
};

MockXmlElement.prototype.getChildren = function(childName) {
  var result = [];
  for (var i = 0; i < this.children.length; i++) {
    if (this.children[i].name === childName) {
      result.push(this.children[i]);
    }
  }
  return result;
};

MockXmlElement.prototype.getChildText = function(childName) {
  var child = this.getChild(childName);
  return child ? child.text : null;
};

MockXmlElement.prototype.addChild = function(child) {
  this.children.push(child);
  return this;
};

function MockXmlDocument(rootElement) {
  this.rootElement = rootElement;
}

MockXmlDocument.prototype.getRootElement = function() {
  return this.rootElement;
};

// =============================================================================
// TESTS
// =============================================================================

function runNewsToolTests() {
  var runner = new TestRunner();

  // Test 1: Successful fetch with headlines
  runner.test("NewsTool - successful fetch returns headlines", function() {
    var mockHttp = new MockHttpClient();
    var mockXml = new MockXmlService();
    var config = new NewsConfig();
    var tool = new NewsTool(mockHttp, mockXml, config);

    // Build mock RSS structure
    var root = new MockXmlElement("rss");
    var channel = new MockXmlElement("channel");
    root.addChild(channel);

    var item1 = new MockXmlElement("item");
    item1.addChild(new MockXmlElement("title", "Breaking: Major news event - CNN"));
    channel.addChild(item1);

    var item2 = new MockXmlElement("item");
    item2.addChild(new MockXmlElement("title", "Tech update today - TechCrunch"));
    channel.addChild(item2);

    mockXml.setMockDocument(new MockXmlDocument(root));
    mockHttp.mockResponse("news.google.com", 200, "<rss></rss>");

    var result = tool.fetch();

    assertTrue(result.success, "Should succeed");
    assertContains(result.data, "Breaking: Major news event", "Should contain first headline");
    assertContains(result.data, "Tech update today", "Should contain second headline");
    assertContains(result.data, "•", "Should have bullet points");
  });

  // Test 2: Strips source from titles
  runner.test("NewsTool - strips source from headlines", function() {
    var mockHttp = new MockHttpClient();
    var mockXml = new MockXmlService();
    var config = new NewsConfig();
    var tool = new NewsTool(mockHttp, mockXml, config);

    var root = new MockXmlElement("rss");
    var channel = new MockXmlElement("channel");
    root.addChild(channel);

    var item1 = new MockXmlElement("item");
    item1.addChild(new MockXmlElement("title", "Breaking News - CNN"));
    channel.addChild(item1);

    mockXml.setMockDocument(new MockXmlDocument(root));
    mockHttp.mockResponse("news.google.com", 200, "<rss></rss>");

    var result = tool.fetch();

    assertTrue(result.success, "Should succeed");
    assertContains(result.data, "Breaking News", "Should contain headline");
    assertTrue(result.data.indexOf("- CNN") === -1, "Should strip source");
  });

  // Test 3: Truncates long headlines
  runner.test("NewsTool - truncates long headlines", function() {
    var mockHttp = new MockHttpClient();
    var mockXml = new MockXmlService();
    var config = new NewsConfig();
    var tool = new NewsTool(mockHttp, mockXml, config);

    var root = new MockXmlElement("rss");
    var channel = new MockXmlElement("channel");
    root.addChild(channel);

    var longTitle = "";
    for (var i = 0; i < 100; i++) {
      longTitle += "word ";
    }

    var item1 = new MockXmlElement("item");
    item1.addChild(new MockXmlElement("title", longTitle));
    channel.addChild(item1);

    mockXml.setMockDocument(new MockXmlDocument(root));
    mockHttp.mockResponse("news.google.com", 200, "<rss></rss>");

    var result = tool.fetch();

    assertTrue(result.success, "Should succeed");
    assertContains(result.data, "...", "Should truncate with ellipsis");
    assertTrue(result.data.length < longTitle.length, "Should be shorter than original");
  });

  // Test 4: Limits to max headlines
  runner.test("NewsTool - limits to max headlines", function() {
    var mockHttp = new MockHttpClient();
    var mockXml = new MockXmlService();
    var config = new NewsConfig("https://news.google.com/rss", 2);
    var tool = new NewsTool(mockHttp, mockXml, config);

    var root = new MockXmlElement("rss");
    var channel = new MockXmlElement("channel");
    root.addChild(channel);

    for (var i = 1; i <= 10; i++) {
      var item = new MockXmlElement("item");
      item.addChild(new MockXmlElement("title", "Headline " + i));
      channel.addChild(item);
    }

    mockXml.setMockDocument(new MockXmlDocument(root));
    mockHttp.mockResponse("news.google.com", 200, "<rss></rss>");

    var result = tool.fetch();

    assertTrue(result.success, "Should succeed");
    var lines = result.data.split("\n");
    assertEquals(lines.length, 2, "Should have exactly 2 headlines");
  });

  // Test 5: HTTP error
  runner.test("NewsTool - handles HTTP errors", function() {
    var mockHttp = new MockHttpClient();
    var mockXml = new MockXmlService();
    var config = new NewsConfig();
    var tool = new NewsTool(mockHttp, mockXml, config);

    mockHttp.mockResponse("news.google.com", 500, "Server Error");

    var result = tool.fetch();

    assertFalse(result.success, "Should fail");
    assertEquals(result.error, "HTTP_500", "Should have HTTP_500 error");
  });

  // Test 6: Invalid RSS (no channel)
  runner.test("NewsTool - handles invalid RSS", function() {
    var mockHttp = new MockHttpClient();
    var mockXml = new MockXmlService();
    var config = new NewsConfig();
    var tool = new NewsTool(mockHttp, mockXml, config);

    var root = new MockXmlElement("rss");
    // No channel element

    mockXml.setMockDocument(new MockXmlDocument(root));
    mockHttp.mockResponse("news.google.com", 200, "<rss></rss>");

    var result = tool.fetch();

    assertFalse(result.success, "Should fail");
    assertEquals(result.error, "INVALID_RSS", "Should have INVALID_RSS error");
  });

  // Test 7: No headlines in feed
  runner.test("NewsTool - handles empty feed", function() {
    var mockHttp = new MockHttpClient();
    var mockXml = new MockXmlService();
    var config = new NewsConfig();
    var tool = new NewsTool(mockHttp, mockXml, config);

    var root = new MockXmlElement("rss");
    var channel = new MockXmlElement("channel");
    root.addChild(channel);
    // No items

    mockXml.setMockDocument(new MockXmlDocument(root));
    mockHttp.mockResponse("news.google.com", 200, "<rss></rss>");

    var result = tool.fetch();

    assertFalse(result.success, "Should fail");
    assertEquals(result.error, "NO_HEADLINES", "Should have NO_HEADLINES error");
  });

  // Test 8: XML parse error
  runner.test("NewsTool - handles XML parse errors", function() {
    var mockHttp = new MockHttpClient();
    var mockXml = new MockXmlService();
    var config = new NewsConfig();
    var tool = new NewsTool(mockHttp, mockXml, config);

    // Don't set mock document, will throw error
    mockHttp.mockResponse("news.google.com", 200, "<invalid xml");

    var result = tool.fetch();

    assertFalse(result.success, "Should fail");
    assertContains(result.error, "EXCEPTION", "Should have exception error");
  });

  // Test 9: Empty title handling
  runner.test("NewsTool - handles empty titles", function() {
    var mockHttp = new MockHttpClient();
    var mockXml = new MockXmlService();
    var config = new NewsConfig();
    var tool = new NewsTool(mockHttp, mockXml, config);

    var root = new MockXmlElement("rss");
    var channel = new MockXmlElement("channel");
    root.addChild(channel);

    var item1 = new MockXmlElement("item");
    item1.addChild(new MockXmlElement("title", ""));
    channel.addChild(item1);

    var item2 = new MockXmlElement("item");
    item2.addChild(new MockXmlElement("title", "Real Headline"));
    channel.addChild(item2);

    mockXml.setMockDocument(new MockXmlDocument(root));
    mockHttp.mockResponse("news.google.com", 200, "<rss></rss>");

    var result = tool.fetch();

    assertTrue(result.success, "Should succeed");
    // Should still include empty headline with bullet
    assertContains(result.data, "•", "Should have bullets");
  });

  // Test 10: Custom RSS URL
  runner.test("NewsTool - uses custom RSS URL", function() {
    var mockHttp = new MockHttpClient();
    var mockXml = new MockXmlService();
    var config = new NewsConfig("https://custom.news.com/feed", 5);
    var tool = new NewsTool(mockHttp, mockXml, config);

    var root = new MockXmlElement("rss");
    var channel = new MockXmlElement("channel");
    root.addChild(channel);

    var item = new MockXmlElement("item");
    item.addChild(new MockXmlElement("title", "Test"));
    channel.addChild(item);

    mockXml.setMockDocument(new MockXmlDocument(root));
    mockHttp.mockResponse("custom.news.com", 200, "<rss></rss>");

    var result = tool.fetch();

    assertTrue(result.success, "Should succeed");
    var requests = mockHttp.getRequests();
    assertContains(requests[0].url, "custom.news.com", "Should use custom URL");
  });

  return runner.run();
}
