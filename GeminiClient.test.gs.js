/**
 * Unit tests for the stable generateContent client.
 *
 * Run with: runGeminiClientTests()
 */

function runGeminiClientTests() {
  var runner = new TestRunner();

  function clientWith(status, body) {
    var http = new MockHttpClient();
    http.mockResponse(":generateContent", status, typeof body === "string" ? body : JSON.stringify(body));
    return { client: new GeminiClient(new GeminiConfig("test-key", "gemini-3.5-flash-lite"), http), http: http };
  }

  function okBody(parts, extra) {
    var body = { candidates: [{ content: { role: "model", parts: parts }, finishReason: "STOP" }], modelVersion: "gemini-3.5-flash-lite" };
    for (var k in (extra || {})) body[k] = extra[k];
    return body;
  }

  runner.test("call - hits the stable v1 endpoint for the pinned model", function() {
    var t = clientWith(200, okBody([{ text: "OK" }]));
    t.client.call("hi", "sys", {});
    var url = t.http.getRequests()[0].url;
    assertContains(url, "/v1/models/gemini-3.5-flash-lite:generateContent");
    assertEquals(url.indexOf("v1beta"), -1, "must not use the beta API");
  });

  runner.test("call - returns joined answer text and skips thought parts", function() {
    var t = clientWith(200, okBody([{ text: "thinking...", thought: true }, { text: "Boil water " }, { text: "for 3 min." }]));
    var r = t.client.call("q", "sys", {});
    assertTrue(r.success, "success");
    assertEquals(r.text, "Boil water for 3 min.");
    assertEquals(r.modelVersion, "gemini-3.5-flash-lite");
  });

  runner.test("buildPayload - history, system instruction, tools, thinking", function() {
    var t = clientWith(200, okBody([{ text: "OK" }]));
    var p = t.client.buildPayload("now?", "be brief", {
      history: [{ q: "first q", a: "first a" }],
      tools: ["google_search", "url_context", "unknown"],
      thinkingLevel: "LOW",
      temperature: 0.4
    });
    assertEquals(p.contents.length, 3);
    assertEquals(p.contents[0].role, "user");
    assertEquals(p.contents[1].role, "model");
    assertEquals(p.contents[1].parts[0].text, "first a");
    assertEquals(p.contents[2].parts[0].text, "now?");
    assertEquals(p.systemInstruction.parts[0].text, "be brief");
    assertEquals(JSON.stringify(p.tools), JSON.stringify([{ googleSearch: {} }, { urlContext: {} }]));
    assertEquals(p.generationConfig.thinkingConfig.thinkingLevel, "LOW");
  });

  runner.test("call - array-wrapped 402 surfaces Google's message (regression 2026-11-16)", function() {
    // This exact shape hid behind "No text in response. Keys: 0" for hours.
    var t = clientWith(402, [{ error: { code: 402, message: "Your prepayment credits are depleted." } }]);
    var r = t.client.call("q", "sys", {});
    assertFalse(r.success, "should fail");
    assertEquals(r.httpCode, 402);
    assertContains(r.error.message, "prepayment credits are depleted");
    assertFalse(r.error.retryable, "402 does not fix itself on retry");
  });

  runner.test("call - 429 and 503 are retryable, 400 and 404 are not", function() {
    assertTrue(clientWith(429, { error: { message: "Resource exhausted" } }).client.call("q").error.retryable, "429");
    assertTrue(clientWith(503, { error: { message: "The model is overloaded" } }).client.call("q").error.retryable, "503");
    assertFalse(clientWith(400, { error: { message: "Invalid JSON payload" } }).client.call("q").error.retryable, "400");
    assertFalse(clientWith(404, { error: { message: "models/x is not found" } }).client.call("q").error.retryable, "404");
  });

  runner.test("call - non-2xx without an error object is still an error", function() {
    var r = clientWith(502, "<html>Bad Gateway</html>").client.call("q");
    assertFalse(r.success, "should fail");
    assertContains(r.error.message, "HTTP 502");
    assertTrue(r.error.retryable, "5xx is retryable");
  });

  runner.test("call - token limit with no prose is retryable", function() {
    var t = clientWith(200, { candidates: [{ content: { parts: [{ text: "...", thought: true }] }, finishReason: "MAX_TOKENS" }] });
    var r = t.client.call("q");
    assertFalse(r.success, "no answer text");
    assertTrue(r.error.retryable, "thinking ate the budget - worth another try");
  });

  runner.test("call - safety block names the reason and is not retried", function() {
    var r = clientWith(200, { promptFeedback: { blockReason: "SAFETY" } }).client.call("q");
    assertFalse(r.success, "blocked");
    assertContains(r.error.message, "SAFETY");
    assertFalse(r.error.retryable, "a block will not change on retry");
  });

  runner.test("call - unparseable 200 body fails cleanly", function() {
    var r = clientWith(200, "not json").client.call("q");
    assertFalse(r.success, "should fail");
    assertContains(r.error.message, "Unparseable");
  });

  runner.test("call - network exception is caught and classed retryable", function() {
    var http = { fetch: function() { throw new Error("Timeout: request timed out"); } };
    var r = new GeminiClient(new GeminiConfig("k", "m"), http).call("q");
    assertFalse(r.success, "should fail");
    assertTrue(r.error.retryable, "timeouts are transient");
  });

  return runner.run();
}
