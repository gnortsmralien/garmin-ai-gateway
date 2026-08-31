/**
 * Unit tests for inbound email parsing.
 *
 * Run with: runMessageParserTests()
 */

function runMessageParserTests() {
  var runner = new TestRunner();

  // A realistic Garmin inReach notification. Note that Gmail hard-wraps the
  // plain-text body, so the user's message spans two lines.
  var WRAPPED_EMAIL = [
    "AI: what is the correct ibuprofen dose for a 30 kg child with a fever and",
    "how often can it safely be repeated",
    "",
    "View the location or send a reply to Test User:",
    "https://explore.garmin.com/textmessage/txtmsg?extId=abc-123&adr=me%40example.com",
    "",
    "Test User sent this message from: Lat 45.344227 Lon -122.236868",
    "",
    "Do not reply directly to this message."
  ].join("\n");

  var SHORT_EMAIL = [
    "AI: how do I splint a wrist",
    "",
    "View the location or send a reply to Test User:",
    "https://inreachlink.com/ABC123",
    "",
    "Do not reply directly to this message."
  ].join("\n");

  // ---------------------------------------------------------------------------
  // extractMessageText
  // ---------------------------------------------------------------------------

  runner.test("extractMessageText - rejoins a Gmail-wrapped message (regression)", function() {
    // Reading only body.split('\n')[0] truncated every message Gmail wrapped,
    // which is any inReach message over ~76 characters.
    var text = extractMessageText(WRAPPED_EMAIL);
    assertEquals(
      text,
      "AI: what is the correct ibuprofen dose for a 30 kg child with a fever and how often can it safely be repeated"
    );
  });

  runner.test("extractMessageText - stops at the reply URL", function() {
    assertEquals(extractMessageText(SHORT_EMAIL), "AI: how do I splint a wrist");
  });

  runner.test("extractMessageText - stops at Garmin boilerplate", function() {
    var body = "AI: where am I\nTest User sent this message from: Lat 1.0 Lon 2.0";
    assertEquals(extractMessageText(body), "AI: where am I");
  });

  runner.test("extractMessageText - skips leading blank lines", function() {
    assertEquals(extractMessageText("\n\nAI: hello there\n\nmore"), "AI: hello there");
  });

  runner.test("extractMessageText - empty body yields empty string", function() {
    assertEquals(extractMessageText(""), "");
    assertEquals(extractMessageText(null), "");
  });

  // ---------------------------------------------------------------------------
  // parseAiPrompt
  // ---------------------------------------------------------------------------

  runner.test("parseAiPrompt - strips the AI prefix", function() {
    var parsed = parseAiPrompt(SHORT_EMAIL);
    assertTrue(parsed.ok, "expected a valid prompt");
    assertEquals(parsed.prompt, "how do I splint a wrist");
  });

  runner.test("parseAiPrompt - keeps the full wrapped question", function() {
    var parsed = parseAiPrompt(WRAPPED_EMAIL);
    assertTrue(parsed.ok, "expected a valid prompt");
    assertContains(parsed.prompt, "how often can it safely be repeated");
  });

  runner.test("parseAiPrompt - accepts lowercase and space separator", function() {
    assertTrue(parseAiPrompt("ai how far to the next road").ok, "lowercase 'ai '");
    assertTrue(parseAiPrompt("Ai: how far to the next road").ok, "mixed case 'Ai:'");
  });

  runner.test("parseAiPrompt - rejects messages not addressed to the gateway", function() {
    var parsed = parseAiPrompt("Hello, having a great hike\n\nhttps://x");
    assertFalse(parsed.ok, "should be rejected");
    assertEquals(parsed.reason, "NOT_ADDRESSED_TO_AI");
  });

  runner.test("parseAiPrompt - rejects an empty question", function() {
    var parsed = parseAiPrompt("AI: \n\nhttps://x");
    assertFalse(parsed.ok, "should be rejected");
    assertEquals(parsed.reason, "EMPTY_PROMPT");
  });

  // ---------------------------------------------------------------------------
  // Links and addresses
  // ---------------------------------------------------------------------------

  runner.test("extractGarminLink - finds an explore.garmin.com link", function() {
    assertEquals(
      extractGarminLink(WRAPPED_EMAIL),
      "https://explore.garmin.com/textmessage/txtmsg?extId=abc-123&adr=me%40example.com"
    );
  });

  runner.test("extractGarminLink - finds an inreachlink.com short link", function() {
    assertEquals(extractGarminLink(SHORT_EMAIL), "https://inreachlink.com/ABC123");
  });

  runner.test("extractGarminLink - returns null when absent", function() {
    assertEquals(extractGarminLink("AI: hello\n\nno links here"), null);
  });

  runner.test("extractRecipientAddress - handles both header forms", function() {
    assertEquals(extractRecipientAddress("me@example.com"), "me@example.com");
    assertEquals(extractRecipientAddress("Test User <me@example.com>"), "me@example.com");
    assertEquals(extractRecipientAddress(null), null);
  });

  runner.test("extractLogId - takes the first 8 chars of extId", function() {
    assertEquals(extractLogId("https://x/txtmsg?extId=abcdef123456&adr=y"), "abcdef12");
    assertEquals(extractLogId("https://x/txtmsg?no=id"), "UNKNOWN");
  });

  // ---------------------------------------------------------------------------
  // Coordinates
  // ---------------------------------------------------------------------------

  runner.test("extractCoordinates - reads the Garmin location line", function() {
    var coords = extractCoordinates(WRAPPED_EMAIL);
    assertNotNull(coords, "expected coordinates");
    assertEquals(coords.lat, 45.344227);
    assertEquals(coords.lon, -122.236868);
  });

  runner.test("extractCoordinates - reads a parenthesised pair", function() {
    var coords = extractCoordinates("somewhere (51.5074, -0.1278) in London");
    assertNotNull(coords, "expected coordinates");
    assertEquals(coords.lat, 51.5074);
    assertEquals(coords.lon, -0.1278);
  });

  runner.test("extractCoordinates - reads a Google Maps URL", function() {
    var coords = extractCoordinates("see https://maps.google.com/?q=@40.7128,-74.0060 here");
    assertNotNull(coords, "expected coordinates");
    assertEquals(coords.lat, 40.7128);
  });

  runner.test("extractCoordinates - rejects out-of-range values", function() {
    assertEquals(extractCoordinates("Lat 200.0 Lon 500.0"), null);
  });

  runner.test("extractCoordinates - rejects null island", function() {
    assertEquals(extractCoordinates("total (0, 0) items"), null);
  });

  runner.test("extractCoordinates - returns null when absent", function() {
    assertEquals(extractCoordinates("AI: hello there"), null);
  });

  // ---------------------------------------------------------------------------
  // Commands
  // ---------------------------------------------------------------------------

  runner.test("extractSizeOverride - reads both spellings", function() {
    assertEquals(extractSizeOverride("explain knots SIZE 800"), 800);
    assertEquals(extractSizeOverride("explain knots RESPONSE SIZE 500"), 500);
    assertEquals(extractSizeOverride("explain knots"), null);
  });

  runner.test("stripSizeOverride - removes the command from the question", function() {
    assertEquals(stripSizeOverride("how do I purify water SIZE 800"), "how do I purify water");
    assertEquals(stripSizeOverride("SIZE 800 how do I purify water"), "how do I purify water");
    assertEquals(stripSizeOverride("how do I purify water"), "how do I purify water");
  });

  runner.test("isHelpCommand - recognises the usual phrasings", function() {
    assertTrue(isHelpCommand("HELP"), "HELP");
    assertTrue(isHelpCommand("help"), "help");
    assertTrue(isHelpCommand("?"), "?");
    assertTrue(isHelpCommand("what can you do"), "what can you do");
    assertTrue(isHelpCommand("HELP SIZE 600"), "HELP with size");
  });

  runner.test("isHelpCommand - does not fire on questions containing 'help'", function() {
    assertFalse(isHelpCommand("how do I help someone with hypothermia"), "should not match");
  });

  runner.test("getHelpText - fits within the page ceiling", function() {
    var pages = buildPages(getHelpText(), LIMITS.GARMIN_SAFE_MAX, LIMITS.MAX_PAGES);
    assertTrue(pages.length > 0, "expected pages");
    assertTrue(
      pages.length <= LIMITS.MAX_PAGES,
      "help text needs " + pages.length + " pages"
    );
    for (var i = 0; i < pages.length; i++) {
      assertTrue(pages[i].length <= LIMITS.GARMIN_SAFE_MAX, "page " + (i + 1) + " too long");
    }
  });

  return runner.run();
}
