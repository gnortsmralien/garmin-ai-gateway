/**
 * Unit tests for the Gemini Interactions API client.
 *
 * Run with: runGeminiClientTests()
 */

function runGeminiClientTests() {
  var runner = new TestRunner();

  function client() {
    return createGeminiInteractionsClient("test-key", "gemini-flash-latest");
  }

  // ---------------------------------------------------------------------------
  // extractText
  // ---------------------------------------------------------------------------

  runner.test("extractText - reads a single model step", function() {
    var text = client().extractText({
      id: "interactions/1",
      steps: [{ type: "message", content: { parts: [{ text: "Boil water for 3 min." }] } }]
    });
    assertEquals(text, "Boil water for 3 min.");
  });

  runner.test("extractText - keeps every part of a multi-part answer (regression)", function() {
    // Returning only the last text-bearing step dropped the rest of the answer,
    // which is what made replies look mysteriously clipped.
    var text = client().extractText({
      steps: [
        { type: "tool_call", tool_call: { name: "google_search" } },
        { type: "tool_result", content: "search results here" },
        { type: "message", content: { parts: [{ text: "First half of the answer." }] } },
        { type: "message", content: { parts: [{ text: "Second half of the answer." }] } }
      ]
    });

    assertContains(text, "First half of the answer.");
    assertContains(text, "Second half of the answer.");
  });

  runner.test("extractText - ignores reasoning steps (regression)", function() {
    // A trailing thought step used to be returned as if it were the answer.
    var text = client().extractText({
      steps: [
        { type: "message", content: { parts: [{ text: "The actual answer." }] } },
        { type: "thought", content: { parts: [{ text: "Let me reconsider the units..." }] } }
      ]
    });

    assertEquals(text, "The actual answer.");
  });

  runner.test("extractText - ignores thought-flagged parts", function() {
    var text = client().extractText({
      steps: [{
        type: "message",
        content: { parts: [
          { text: "internal deliberation", thought: true },
          { text: "The actual answer." }
        ] }
      }]
    });

    assertEquals(text, "The actual answer.");
  });

  runner.test("extractText - prefers prose emitted after the last tool call", function() {
    var text = client().extractText({
      steps: [
        { type: "message", content: { parts: [{ text: "Let me look that up." }] } },
        { type: "google_search", tool_call: { name: "google_search" } },
        { type: "message", content: { parts: [{ text: "The forecast is 4 C with rain." }] } }
      ]
    });

    assertEquals(text, "The forecast is 4 C with rain.");
  });

  runner.test("extractText - falls back to prose when only tool steps follow", function() {
    var text = client().extractText({
      steps: [
        { type: "message", content: { parts: [{ text: "Only answer available." }] } },
        { type: "tool_call", tool_call: { name: "google_search" } }
      ]
    });

    assertEquals(text, "Only answer available.");
  });

  runner.test("extractText - supports the outputs array shape", function() {
    var text = client().extractText({ outputs: [{ type: "text", text: "From outputs." }] });
    assertEquals(text, "From outputs.");
  });

  runner.test("extractText - supports the generateContent candidates shape", function() {
    var text = client().extractText({
      candidates: [{ content: { parts: [{ text: "From candidates." }] } }]
    });
    assertEquals(text, "From candidates.");
  });

  runner.test("extractText - returns null when there is nothing to read", function() {
    assertEquals(client().extractText({ id: "x", status: "failed" }), null);
    assertEquals(client().extractText({ steps: [] }), null);
  });

  // ---------------------------------------------------------------------------
  // Step classification
  // ---------------------------------------------------------------------------

  runner.test("isToolStep - recognises tool calls and results", function() {
    var c = client();
    assertTrue(c.isToolStep({ type: "tool_call" }), "tool_call type");
    assertTrue(c.isToolStep({ type: "google_search" }), "search type");
    assertTrue(c.isToolStep({ function_call: { name: "x" } }), "function_call field");
    assertFalse(c.isToolStep({ type: "message" }), "message is not a tool step");
  });

  runner.test("isThoughtStep - recognises reasoning steps", function() {
    var c = client();
    assertTrue(c.isThoughtStep({ thought: true }), "thought flag");
    assertTrue(c.isThoughtStep({ type: "thinking" }), "thinking type");
    assertFalse(c.isThoughtStep({ type: "message" }), "message is not a thought");
  });

  // ---------------------------------------------------------------------------
  // Truncation detection
  // ---------------------------------------------------------------------------

  runner.test("wasTruncated - detects a token-limit stop", function() {
    var c = client();
    assertTrue(c.wasTruncated({ steps: [{ finishReason: "MAX_TOKENS" }] }), "step finishReason");
    assertTrue(c.wasTruncated({ candidates: [{ finish_reason: "MAX_TOKENS" }] }), "candidate finish_reason");
    assertTrue(c.wasTruncated({ status: "incomplete" }), "incomplete status");
    assertFalse(c.wasTruncated({ status: "completed", steps: [{ finishReason: "STOP" }] }), "normal stop");
    assertFalse(c.wasTruncated(null), "null response");
  });

  // ---------------------------------------------------------------------------
  // Payload construction
  // ---------------------------------------------------------------------------

  runner.test("buildPayload - carries the model, input and generation config", function() {
    var payload = client().buildPayload("what is the tide", "SYSTEM RULES", {
      maxOutputTokens: 4096,
      temperature: 0.3
    });

    assertEquals(payload.model, "gemini-flash-latest");
    assertContains(payload.input, "SYSTEM RULES");
    assertContains(payload.input, "what is the tide");
    assertEquals(payload.generation_config.max_output_tokens, 4096);
    assertEquals(payload.generation_config.temperature, 0.3);
  });

  runner.test("buildPayload - defaults to a generous token budget (regression)", function() {
    // A tight cap is spent on reasoning tokens before any prose is emitted,
    // which surfaced as answers that stopped mid-sentence.
    var payload = client().buildPayload("q", null, {});
    assertEquals(payload.generation_config.max_output_tokens, 8192);
  });

  runner.test("buildPayload - stores conversational turns and skips one-shots", function() {
    assertEquals(client().buildPayload("q", null, {}).store, true);
    assertEquals(client().buildPayload("q", null, { store: false }).store, false);
  });

  runner.test("buildPayload - includes the previous interaction id", function() {
    var payload = client().buildPayload("q", null, { previousInteractionId: "interactions/42" });
    assertEquals(payload.previous_interaction_id, "interactions/42");
  });

  runner.test("buildPayload - maps built-in tool names", function() {
    var payload = client().buildPayload("q", null, { tools: ["google_search", "url_context"] });
    assertEquals(payload.tools.length, 2);
    assertEquals(payload.tools[0].type, "google_search");
    assertEquals(payload.tools[1].type, "url_context");
  });

  runner.test("buildPayload - omits tools when none are requested", function() {
    assertEquals(client().buildPayload("q", null, { tools: [] }).tools, undefined);
  });

  // ---------------------------------------------------------------------------
  // Error classification
  // ---------------------------------------------------------------------------

  runner.test("isErrorRetryable - retries transient failures", function() {
    var c = client();
    assertTrue(c.isErrorRetryable("The model is overloaded. Please try again later."), "overloaded");
    assertTrue(c.isErrorRetryable("429 rate limit exceeded"), "rate limit");
    assertFalse(c.isErrorRetryable("API key not valid"), "bad key");
    assertFalse(c.isErrorRetryable(""), "empty");
  });

  return runner.run();
}
