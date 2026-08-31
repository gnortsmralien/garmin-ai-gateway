/**
 * Unit tests for tool trigger matching.
 *
 * The tools themselves have their own suites; this covers the dispatcher's
 * decision about whether to run them at all, which is where false positives
 * used to burn API calls and derail answers.
 *
 * Run with: runToolboxTests()
 */

function runToolboxTests() {
  var runner = new TestRunner();
  var T = TOOLBOX_CONFIG.TRIGGERS;

  runner.test("triggerMatches - fires on a whole-word keyword", function() {
    assertTrue(triggerMatches("what is the weather like", T.WEATHER), "weather");
    assertTrue(triggerMatches("any NEWS today", T.NEWS), "news");
    assertTrue(triggerMatches("when is sunset", T.ASTRONOMY), "sunset");
    assertTrue(triggerMatches("any earthquake nearby", T.DISASTERS), "earthquake");
  });

  runner.test("triggerMatches - is case insensitive", function() {
    assertTrue(triggerMatches("WEATHER", T.WEATHER), "upper");
    assertTrue(triggerMatches("weather", T.WEATHER), "lower");
    assertTrue(triggerMatches("Weather", T.WEATHER), "mixed");
  });

  runner.test("triggerMatches - does not fire on substrings", function() {
    assertFalse(triggerMatches("how do I weatherproof a tent", T.WEATHER), "weatherproof");
    assertFalse(triggerMatches("the newsagent was closed", T.NEWS), "newsagent");
    assertFalse(triggerMatches("moonlight sonata", T.ASTRONOMY), "moonlight");
  });

  runner.test("triggerMatches - handles hyphenated keywords", function() {
    assertTrue(triggerMatches("give me FULL-WEATHER", T.FULL_WEATHER), "hyphenated");
    assertTrue(triggerMatches("give me FULL WEATHER", T.FULL_WEATHER), "spaced");
  });

  runner.test("triggerMatches - handles multi-word keywords", function() {
    assertTrue(triggerMatches("where am i right now", T.REVERSE_GEOCODE), "where am i");
    assertFalse(triggerMatches("how far to the road", T.REVERSE_GEOCODE), "unrelated");
  });

  runner.test("triggerMatches - generic words no longer fire weather (regression)", function() {
    // TEMP, WIND, COLD, HOT and HUMID were removed from the trigger list
    // because they fired on historical and general-knowledge questions.
    assertFalse(triggerMatches("what temperature does water boil at", T.WEATHER), "temperature");
    assertFalse(triggerMatches("how do I treat cold hands", T.WEATHER), "cold");
    assertFalse(triggerMatches("which way does the wind erode rock", T.WEATHER), "wind");
  });

  runner.test("WIKIPEDIA trigger - captures the search term", function() {
    var match = "WIKI snake bite treatment".match(T.WIKIPEDIA);
    assertNotNull(match, "expected a match");
    assertEquals(match[1].trim(), "snake bite treatment");
  });

  runner.test("WIKIPEDIA trigger - only fires at the start of the message", function() {
    assertEquals("please WIKI snake bite".match(T.WIKIPEDIA), null);
  });

  // ---------------------------------------------------------------------------
  // Context assembly
  // ---------------------------------------------------------------------------

  runner.test("runToolbox - reports missing GPS instead of guessing", function() {
    var result = runToolbox("what is the weather", null, "TEST");
    assertContains(result.context, "WEATHER");
    assertContains(result.context, "NOT AVAILABLE");
    assertContains(result.context, "Send Location");
  });

  runner.test("runToolbox - includes coordinates when present", function() {
    var result = runToolbox("how far to the coast", { lat: 45.3, lon: -122.2 }, "TEST");
    assertContains(result.context, "45.3");
    assertContains(result.context, "-122.2");
  });

  runner.test("runToolbox - accepts coordinates on the equator (regression)", function() {
    // The old guard was `coords.lat && coords.lon`, so a latitude or longitude
    // of exactly 0 was treated as "no coordinates".
    var result = runToolbox("how far to the coast", { lat: 0, lon: 32.5 }, "TEST");
    assertContains(result.context, "LOCATION");
  });

  runner.test("runToolbox - stays quiet when nothing is triggered", function() {
    var result = runToolbox("how do I tie a bowline", null, "TEST");
    assertEquals(result.context, "");
    assertEquals(result.errors.length, 0);
  });

  return runner.run();
}
