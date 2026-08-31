/**
 * Unit tests for shared utilities and conversation-state handling.
 *
 * Run with: runUtilsTests()
 */

function runUtilsTests() {
  var runner = new TestRunner();

  // ---------------------------------------------------------------------------
  // renderTemplate
  // ---------------------------------------------------------------------------

  runner.test("renderTemplate - replaces every occurrence (regression)", function() {
    // String.replace with a string pattern only replaces the first match, so
    // repeated placeholders used to survive into the prompt.
    var out = renderTemplate("{{A}} then {{B}} then {{A}}", { A: "one", B: "two" });
    assertEquals(out, "one then two then one");
  });

  runner.test("renderTemplate - substitutes numbers", function() {
    assertEquals(renderTemplate("max {{MAX}} chars", { MAX: 700 }), "max 700 chars");
  });

  runner.test("renderTemplate - leaves unknown placeholders alone", function() {
    assertEquals(renderTemplate("{{A}} {{C}}", { A: "x" }), "x {{C}}");
  });

  runner.test("renderTemplate - renders null as empty", function() {
    assertEquals(renderTemplate("[{{A}}]", { A: null }), "[]");
  });

  runner.test("charsToWords - approximates six characters per word", function() {
    assertEquals(charsToWords(350), 58);
    assertEquals(charsToWords(700), 117);
    assertTrue(charsToWords(1) >= 1, "never returns zero");
  });

  // ---------------------------------------------------------------------------
  // cleanOutput
  // ---------------------------------------------------------------------------

  runner.test("cleanOutput - strips markdown emphasis and headings", function() {
    assertEquals(cleanOutput("## Title\n**bold** and *italic* and `code`"), "Title\nbold and italic and code");
  });

  runner.test("cleanOutput - strips fenced code blocks", function() {
    assertEquals(cleanOutput("```js\nvar x = 1;\n```"), "var x = 1;");
  });

  runner.test("cleanOutput - strips leading bullets", function() {
    assertEquals(cleanOutput("- first\n- second"), "first\nsecond");
  });

  runner.test("cleanOutput - collapses blank lines and runs of spaces", function() {
    assertEquals(cleanOutput("a\n\n\nb    c"), "a\nb c");
  });

  runner.test("cleanOutput - handles empty input", function() {
    assertEquals(cleanOutput(""), "");
    assertEquals(cleanOutput(null), "");
  });

  // ---------------------------------------------------------------------------
  // truncateSmart
  // ---------------------------------------------------------------------------

  runner.test("truncateSmart - returns short text unchanged", function() {
    assertEquals(truncateSmart("short", 100), "short");
  });

  runner.test("truncateSmart - cuts at a sentence boundary", function() {
    var text = "First sentence here. Second sentence runs on well past the limit.";
    assertEquals(truncateSmart(text, 30), "First sentence here.");
  });

  runner.test("truncateSmart - keeps a word boundary when no sentence ends in range", function() {
    var text = "First sentence here. Second sentence runs on well past the limit.";
    var out = truncateSmart(text, 40);
    assertTrue(out.length <= 40, "was " + out.length);
    assertContains(out, "Second sentence");
  });

  runner.test("truncateSmart - scans across newlines (regression)", function() {
    // The old regex used . which never crosses \n, so it only ever inspected
    // the first line and fell through to a mid-word cut.
    var text = "Line one.\nLine two ends here. And then a third line continues on and on.";
    var out = truncateSmart(text, 40);
    assertEquals(out, "Line one.\nLine two ends here.");
  });

  runner.test("truncateSmart - never exceeds the limit", function() {
    var text = "word ".repeat(200);
    for (var limit = 10; limit <= 200; limit += 37) {
      assertTrue(
        truncateSmart(text, limit).length <= limit,
        "limit " + limit + " produced " + truncateSmart(text, limit).length
      );
    }
  });

  runner.test("truncateSmart - falls back to a word boundary with an ellipsis", function() {
    var text = "alpha bravo charlie delta echo foxtrot golf hotel india juliet";
    var out = truncateSmart(text, 30);
    assertTrue(out.length <= 30, "was " + out.length);
    assertContains(out, "...");
  });

  // ---------------------------------------------------------------------------
  // Retry bookkeeping
  // ---------------------------------------------------------------------------

  runner.test("retry count - increments and clears", function() {
    clearRetryCount("msg-retry");
    assertEquals(getRetryCount("msg-retry"), 0);

    assertEquals(incrementRetryCount("msg-retry"), 1);
    assertEquals(incrementRetryCount("msg-retry"), 2);
    assertEquals(getRetryCount("msg-retry"), 2);

    clearRetryCount("msg-retry");
    assertEquals(getRetryCount("msg-retry"), 0);
  });

  runner.test("retry count - corrupt data reads as zero", function() {
    PropertiesService.getScriptProperties().setProperty("RETRY_msg-corrupt", "not json");
    assertEquals(getRetryCount("msg-corrupt"), 0);
    PropertiesService.getScriptProperties().deleteProperty("RETRY_msg-corrupt");
  });

  runner.test("cleanupOldRetries - removes entries past the TTL", function() {
    var props = PropertiesService.getScriptProperties();
    props.setProperty("RETRY_msg-old", JSON.stringify({
      count: 1,
      timestamp: Date.now() - (RETRY.ENTRY_TTL_MS + 1000)
    }));
    props.setProperty("RETRY_msg-new", JSON.stringify({ count: 1, timestamp: Date.now() }));

    cleanupOldRetries();

    assertEquals(props.getProperty("RETRY_msg-old"), null);
    assertNotNull(props.getProperty("RETRY_msg-new"), "recent entry should survive");
    props.deleteProperty("RETRY_msg-new");
  });

  // ---------------------------------------------------------------------------
  // Conversation reset detection
  // ---------------------------------------------------------------------------

  runner.test("isNewConversationRequested - matches standalone keywords", function() {
    var manager = createInteractionStateManager();
    assertTrue(manager.isNewConversationRequested("NEW"), "NEW");
    assertTrue(manager.isNewConversationRequested("reset"), "reset");
    assertTrue(manager.isNewConversationRequested("start over"), "start over");
  });

  runner.test("isNewConversationRequested - matches an explicit prefix", function() {
    var manager = createInteractionStateManager();
    assertTrue(manager.isNewConversationRequested("NEW: how do I splint a wrist"), "NEW:");
    assertTrue(manager.isNewConversationRequested("new - what is the tide"), "new -");
  });

  runner.test("isNewConversationRequested - ignores ordinary questions (regression)", function() {
    // /^NEW\b/ used to reset the conversation on any question starting with
    // the word "new".
    var manager = createInteractionStateManager();
    assertFalse(manager.isNewConversationRequested("new tent recommendations?"), "new tent");
    assertFalse(manager.isNewConversationRequested("fresh water sources nearby"), "fresh water");
    assertFalse(manager.isNewConversationRequested("news headlines"), "news headlines");
  });

  runner.test("stripResetPrefix - removes the command, keeps the question", function() {
    assertEquals(stripResetPrefix("NEW: how do I splint a wrist"), "how do I splint a wrist");
    assertEquals(stripResetPrefix("new - what is the tide"), "what is the tide");
    assertEquals(stripResetPrefix("how do I splint a wrist"), "how do I splint a wrist");
    assertEquals(stripResetPrefix("NEW"), "NEW");
  });

  runner.test("interaction state - stores, reads back and expires", function() {
    var manager = createInteractionStateManager();
    manager.clearInteractionId("sender-a");

    assertEquals(manager.getInteractionId("sender-a", "hello"), null);

    manager.setInteractionId("sender-a", "interactions/12345");
    assertEquals(manager.getInteractionId("sender-a", "hello"), "interactions/12345");

    // An explicit reset drops it.
    assertEquals(manager.getInteractionId("sender-a", "NEW: hello"), null);
    assertEquals(manager.getInteractionId("sender-a", "hello"), null);
  });

  runner.test("extractSenderKey - is stable and derived from the address", function() {
    var a = extractSenderKey("https://x/txtmsg?extId=abc&adr=me%40example.com");
    var b = extractSenderKey("https://x/txtmsg?extId=zzz&adr=me%40example.com");
    var c = extractSenderKey("https://x/txtmsg?extId=abc&adr=other%40example.com");

    assertEquals(a, b, "same address should give the same key regardless of extId");
    assertTrue(a !== c, "different addresses should give different keys");
    assertEquals(a.indexOf("me@example.com"), -1, "key should not leak the address");
  });

  return runner.run();
}
