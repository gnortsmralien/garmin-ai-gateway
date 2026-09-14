/**
 * Unit tests for the paging engine.
 *
 * Run with: runPagerTests()
 */

function runPagerTests() {
  var runner = new TestRunner();

  var SAFE_MAX = LIMITS.GARMIN_SAFE_MAX;

  // ---------------------------------------------------------------------------
  // maxPrefixLength
  // ---------------------------------------------------------------------------

  runner.test("maxPrefixLength - single page reserves nothing", function() {
    assertEquals(maxPrefixLength(1), 0);
  });

  runner.test("maxPrefixLength - single digit totals reserve 4 chars", function() {
    assertEquals(maxPrefixLength(9), 4);   // "9/9 "
  });

  runner.test("maxPrefixLength - double digit totals reserve 6 chars", function() {
    assertEquals(maxPrefixLength(12), 6);  // "12/12 "
  });

  // ---------------------------------------------------------------------------
  // buildPages
  // ---------------------------------------------------------------------------

  runner.test("buildPages - empty input yields no pages", function() {
    assertEquals(buildPages("", SAFE_MAX, 16).length, 0);
    assertEquals(buildPages("   ", SAFE_MAX, 16).length, 0);
  });

  runner.test("buildPages - short reply is one unprefixed page", function() {
    var pages = buildPages("Boil the water for 3 min.", SAFE_MAX, 16);
    assertEquals(pages.length, 1);
    assertEquals(pages[0], "Boil the water for 3 min.");
  });

  runner.test("buildPages - text exactly at the limit stays on one page", function() {
    var text = repeatWord("ab", SAFE_MAX);
    assertEquals(text.length, SAFE_MAX);
    assertEquals(buildPages(text, SAFE_MAX, 16).length, 1);
  });

  runner.test("buildPages - no page ever exceeds the device limit", function() {
    var samples = [
      longSentences(400),
      longSentences(700),
      longSentences(1400),
      longSentences(2000),
      repeatWord("word", 900),
      "NoSpacesAtAll".repeat(60)
    ];

    for (var s = 0; s < samples.length; s++) {
      var pages = buildPages(samples[s], SAFE_MAX, 16);
      for (var i = 0; i < pages.length; i++) {
        assertTrue(
          pages[i].length <= SAFE_MAX,
          "sample " + s + " page " + (i + 1) + " was " + pages[i].length + " chars"
        );
      }
    }
  });

  runner.test("buildPages - double digit page counts still fit (regression)", function() {
    // The old code chunked at a fixed 149 and appended the prefix afterwards,
    // so a "10/12 " prefix pushed the payload past the device limit.
    var pages = buildPages(longSentences(2000), SAFE_MAX, 16);
    assertTrue(pages.length >= 10, "expected a double-digit page count, got " + pages.length);

    for (var i = 0; i < pages.length; i++) {
      assertTrue(pages[i].length <= SAFE_MAX, "page " + (i + 1) + " was " + pages[i].length);
    }
  });

  runner.test("buildPages - prefixes are sequential and agree on the total", function() {
    var pages = buildPages(longSentences(900), SAFE_MAX, 16);
    assertTrue(pages.length > 1, "expected multiple pages");

    for (var i = 0; i < pages.length; i++) {
      var expected = (i + 1) + "/" + pages.length + " ";
      assertTrue(
        pages[i].indexOf(expected) === 0,
        "page " + (i + 1) + " started with '" + pages[i].substring(0, 8) + "', wanted '" + expected + "'"
      );
    }
  });

  runner.test("buildPages - no words are lost across the split", function() {
    var text = longSentences(900);
    var pages = buildPages(text, SAFE_MAX, 16);

    var rejoined = pages.map(function(p) {
      return p.replace(/^\d+\/\d+ /, "");
    }).join(" ");

    var original = words(text);
    var delivered = words(rejoined);

    assertEquals(delivered.length, original.length, "word count changed");
    for (var i = 0; i < original.length; i++) {
      assertEquals(delivered[i], original[i], "word " + i + " differs");
    }
  });

  runner.test("buildPages - splits on newlines rather than mid-word (regression)", function() {
    // findSplitPoint used /.*[.!?]/, and . never crosses a newline, so
    // multi-line answers fell through to the mid-word fallback.
    var text = [
      "IMMEDIATE: Move to shelter and get out of the wind.",
      "WATER: Boil for 3 min at this altitude before drinking.",
      "SIGNAL: Lay bright fabric in a triangle on open ground.",
      "SHELTER: Insulate from the ground first, then block wind."
    ].join("\n");

    var pages = buildPages(text, SAFE_MAX, 16);
    assertTrue(pages.length > 1, "expected multiple pages");

    // Every page should start a label, i.e. no page begins mid-word.
    for (var i = 0; i < pages.length; i++) {
      var body = pages[i].replace(/^\d+\/\d+ /, "");
      assertTrue(
        /^[A-Z]/.test(body),
        "page " + (i + 1) + " began mid-word: '" + body.substring(0, 30) + "'"
      );
    }
  });

  runner.test("buildPages - honours MAX_PAGES and marks the cut", function() {
    var pages = buildPages(longSentences(4000), SAFE_MAX, 5);
    assertEquals(pages.length, 5);
    assertTrue(
      pages[4].indexOf("...") !== -1,
      "truncated final page should be marked, got: " + pages[4]
    );
    assertTrue(pages[4].length <= SAFE_MAX, "marked page was " + pages[4].length + " chars");
  });

  runner.test("buildPages - strips markdown before measuring", function() {
    var pages = buildPages("**Bold** and `code` and ## Heading", SAFE_MAX, 16);
    assertEquals(pages.length, 1);
    assertEquals(pages[0].indexOf("*"), -1);
    assertEquals(pages[0].indexOf("`"), -1);
    assertEquals(pages[0].indexOf("#"), -1);
  });

  // ---------------------------------------------------------------------------
  // splitForPaging / findSplitPoint
  // ---------------------------------------------------------------------------

  runner.test("splitForPaging - respects the chunk limit", function() {
    var chunks = splitForPaging(longSentences(900), 100);
    for (var i = 0; i < chunks.length; i++) {
      assertTrue(chunks[i].length <= 100, "chunk " + i + " was " + chunks[i].length);
    }
  });

  runner.test("splitForPaging - terminates on text with no spaces", function() {
    var chunks = splitForPaging("x".repeat(500), 100);
    assertEquals(chunks.length, 5);
    assertEquals(chunks[0].length, 100);
  });

  runner.test("splitForPaging - single short chunk passes through", function() {
    var chunks = splitForPaging("short", 100);
    assertEquals(chunks.length, 1);
    assertEquals(chunks[0], "short");
  });

  runner.test("findSplitPoint - prefers a sentence boundary", function() {
    var text = "Check the oil level first. Then replace the fuel filter before restarting.";
    var point = findSplitPoint(text, 40);
    assertEquals(text.substring(0, point), "Check the oil level first.");
  });

  runner.test("findSplitPoint - sentence scan crosses newlines (regression)", function() {
    // The old regex was /.*[.!?]/ and . never matches \n, so only the first
    // line was ever considered. Here the best boundary is on the second line.
    var text = "Line one.\nLine two ends here. Line three continues past the limit.";
    var point = findSplitPoint(text, 40);
    assertEquals(text.substring(0, point), "Line one.\nLine two ends here.");
  });

  runner.test("findSplitPoint - ignores an early newline that would waste the page", function() {
    // Breaking at 40% of a page costs a whole satellite message, so a boundary
    // that early is rejected in favour of filling the page.
    var text = "Short.\n" + "filler words to fill out the rest of this page nicely";
    var point = findSplitPoint(text, 45);
    assertTrue(point > 30, "split at " + point + ", expected the page to be filled");
  });

  runner.test("findSplitPoint - falls back to a space rather than mid-word", function() {
    var text = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa bb cccccccccccccccccccccccccccc";
    var point = findSplitPoint(text, 34);
    assertEquals(text.charAt(point - 1) === " " || text.charAt(point) === " ", true);
  });

  // ---------------------------------------------------------------------------
  // Resume state
  // ---------------------------------------------------------------------------

  runner.test("page session - checkpoint and reload round-trips", function() {
    var pages = ["1/3 alpha", "2/3 bravo", "3/3 charlie"];
    clearPageSession("msg-round-trip");

    checkpointPages("msg-round-trip", pages, 1);
    var loaded = loadPageSession("msg-round-trip");

    assertNotNull(loaded, "expected a stored session");
    assertEquals(loaded.sent, 1);
    assertEquals(loaded.pages.length, 3);
    assertEquals(loaded.pages[2], "3/3 charlie");

    clearPageSession("msg-round-trip");
    assertEquals(loadPageSession("msg-round-trip"), null);
  });

  runner.test("page session - a completed send stores nothing", function() {
    var pages = ["1/2 alpha", "2/2 bravo"];
    checkpointPages("msg-complete", pages, 2);
    assertEquals(loadPageSession("msg-complete"), null);
  });

  runner.test("page session - expired sessions are discarded", function() {
    PropertiesService.getScriptProperties().setProperty(
      "PAGES_msg-stale",
      JSON.stringify({
        pages: ["1/2 a", "2/2 b"],
        sent: 1,
        timestamp: Date.now() - (LIMITS.PAGE_SESSION_TTL_MS + 1000)
      })
    );

    assertEquals(loadPageSession("msg-stale"), null);
  });

  runner.test("page session - no messageId means no storage", function() {
    checkpointPages(null, ["1/2 a", "2/2 b"], 1);
    assertEquals(loadPageSession(null), null);
  });

  // ---------------------------------------------------------------------------
  // sendPages
  // ---------------------------------------------------------------------------

  runner.test("sendPages - delivers every page in order", function() {
    var sent = [];
    withStubbedGarmin(function() { return true; }, sent, function() {
      var result = sendPages("https://x/txtmsg?extId=abc", ["1/3 a", "2/3 b", "3/3 c"], "TEST", 0, {
        messageId: "msg-send-all"
      });

      assertTrue(result.success, "expected success");
      assertEquals(result.sent, 3);
      assertEquals(sent.length, 3);
      assertEquals(sent[0], "1/3 a");
      assertEquals(sent[2], "3/3 c");
      assertEquals(loadPageSession("msg-send-all"), null, "session should be cleared on success");
    });
  });

  runner.test("sendPages - resumes from startIndex without resending", function() {
    var sent = [];
    withStubbedGarmin(function() { return true; }, sent, function() {
      var result = sendPages("https://x/txtmsg?extId=abc", ["1/3 a", "2/3 b", "3/3 c"], "TEST", 2, {
        messageId: "msg-resume"
      });

      assertTrue(result.success, "expected success");
      assertEquals(sent.length, 1, "only the outstanding page should be sent");
      assertEquals(sent[0], "3/3 c");
    });
  });

  runner.test("sendPages - a failed page checkpoints progress (regression)", function() {
    // Previously a mid-batch failure discarded all progress, so the retry
    // resent page 1 and the user saw duplicates followed by a gap.
    var sent = [];
    clearPageSession("msg-partial");

    var stub = function(message) {
      return message.indexOf("2/3") !== 0;  // page 2 always fails
    };

    withStubbedGarmin(stub, sent, function() {
      var result = sendPages("https://x/txtmsg?extId=abc", ["1/3 a", "2/3 b", "3/3 c"], "TEST", 0, {
        messageId: "msg-partial"
      });

      assertFalse(result.success, "expected failure");
      assertEquals(result.sent, 1);
      assertEquals(result.reason, "PAGE_2_FAILED");

      var pending = loadPageSession("msg-partial");
      assertNotNull(pending, "progress should be checkpointed");
      assertEquals(pending.sent, 1, "page 1 should not be resent");
    });

    clearPageSession("msg-partial");
  });

  runner.test("sendPages - retries a page before giving up", function() {
    var attempts = 0;
    var sent = [];

    var stub = function() {
      attempts++;
      return attempts >= 2;  // first attempt fails, second succeeds
    };

    withStubbedGarmin(stub, sent, function() {
      var result = sendPages("https://x/txtmsg?extId=abc", ["only page"], "TEST", 0, {});
      assertTrue(result.success, "expected the retry to succeed");
      assertEquals(attempts, 2);
    });
  });

  runner.test("paginateAndSend - reports page and character counts", function() {
    var sent = [];
    withStubbedGarmin(function() { return true; }, sent, function() {
      var result = paginateAndSend("https://x/txtmsg?extId=abc", longSentences(500), "TEST", {});
      assertTrue(result.success, "expected success");
      assertTrue(result.pages > 1, "expected multiple pages");
      assertEquals(result.sent, result.pages);
      assertEquals(sent.length, result.pages);
    });
  });

  // ---------------------------------------------------------------------------
  // Parked replies
  //
  // An answer that could not be delivered has already been generated and paid
  // for, and its Gmail message is starred by the time it gets here - so the
  // drain is the only thing in the system that will ever look at it again.
  // ---------------------------------------------------------------------------

  runner.test("parkPendingDelivery - keeps the undelivered pages", function() {
    withParkedFixture("msg-park", ["1/2 a", "2/2 b"], 1, function() {
      assertTrue(parkPendingDelivery("msg-park", "https://x/reply/tok"));

      var state = loadPageSession("msg-park");
      assertTrue(state.parked, "the session is marked parked");
      assertEquals(state.sent, 1, "the delivered page is not resent");
      assertEquals(state.url, "https://x/reply/tok");
    });
  });

  // The advice given to the user has to match what the system will do. Saying
  // "try again" while the answer is queued makes them pay for a second one and
  // then receive both.
  runner.test("parkPendingDelivery - reports whether anything was parked", function() {
    withParkedFixture("msg-parked-flag", ["1/2 a", "2/2 b"], 1, function() {
      assertTrue(parkPendingDelivery("msg-parked-flag", "https://x/reply/tok"),
        "a parked reply reports true, so the user is told it is queued");
    });

    clearPageSession("msg-nothing-parked");
    assertFalse(parkPendingDelivery("msg-nothing-parked", "https://x/reply/tok"),
      "nothing parked reports false, so the user is told to resend");
  });

  runner.test("parkPendingDelivery - nothing to park is not an error", function() {
    clearPageSession("msg-absent");
    assertFalse(parkPendingDelivery("msg-absent", "https://x/reply/tok"));
  });

  runner.test("listPendingDeliveries - returns only parked sessions", function() {
    withParkedFixture("msg-parked-one", ["1/2 a", "2/2 b"], 1, function() {
      withParkedFixture("msg-inflight", ["1/2 c", "2/2 d"], 1, function() {
        parkPendingDelivery("msg-parked-one", "https://x/reply/tok");

        var ids = listPendingDeliveries().map(function(p) { return p.messageId; });
        assertTrue(ids.indexOf("msg-parked-one") !== -1, "the parked one is listed");
        assertTrue(ids.indexOf("msg-inflight") === -1, "an in-flight checkpoint is not");
      });
    });
  });

  runner.test("drainPendingDeliveries - delivers a parked reply and clears it", function() {
    withParkedFixture("msg-drain", ["1/2 a", "2/2 b"], 1, function() {
      parkPendingDelivery("msg-drain", "https://x/reply/tok");
      clearDrainThrottle();

      var sent = [];
      withStubbedGarmin(function() { return true; }, sent, function() {
        var result = drainPendingDeliveries(Date.now() + 60000);

        assertEquals(result.delivered, 1);
        assertEquals(sent.length, 1, "only the outstanding page goes out");
        assertEquals(sent[0], "2/2 b");
        assertEquals(loadPageSession("msg-drain"), null, "a drained reply is cleared");
      });
    });
  });

  runner.test("drainPendingDeliveries - leaves it parked when delivery still fails", function() {
    withParkedFixture("msg-still-down", ["1/2 a", "2/2 b"], 1, function() {
      parkPendingDelivery("msg-still-down", "https://x/reply/tok");
      clearDrainThrottle();

      var sent = [];
      withStubbedGarmin(function() { return false; }, sent, function() {
        var result = drainPendingDeliveries(Date.now() + 60000);

        assertEquals(result.delivered, 0);
        assertEquals(result.attempted, 1);

        var state = loadPageSession("msg-still-down");
        assertNotNull(state, "the answer survives a failed drain");
        assertTrue(state.parked, "and is still parked for the next attempt");
      });
    });
  });

  // A satellite answer that turns up hours late is noise to someone who has
  // long since moved on, so staleness wins over completeness.
  runner.test("drainPendingDeliveries - abandons a reply that has aged out", function() {
    withParkedFixture("msg-stale", ["1/2 a", "2/2 b"], 1, function() {
      parkPendingDelivery("msg-stale", "https://x/reply/tok");

      var state = loadPageSession("msg-stale");
      state.timestamp = Date.now() - HEALTH.PENDING_MAX_AGE_MS - 60000;
      PropertiesService.getScriptProperties()
        .setProperty("PAGES_msg-stale", JSON.stringify(state));
      clearDrainThrottle();

      var sent = [];
      withStubbedGarmin(function() { return true; }, sent, function() {
        var result = drainPendingDeliveries(Date.now() + 60000);

        assertEquals(result.abandoned, 1);
        assertEquals(sent.length, 0, "nothing stale is delivered");
        assertEquals(loadPageSession("msg-stale"), null);
      });
    });
  });

  // The gateway fires every minute; retrying a parked reply that often would
  // just hammer a Garmin that is already down.
  runner.test("drainPendingDeliveries - throttles between attempts", function() {
    withParkedFixture("msg-throttle", ["1/2 a", "2/2 b"], 1, function() {
      parkPendingDelivery("msg-throttle", "https://x/reply/tok");
      clearDrainThrottle();

      var sent = [];
      withStubbedGarmin(function() { return false; }, sent, function() {
        var first = drainPendingDeliveries(Date.now() + 60000);
        assertEquals(first.attempted, 1);

        var second = drainPendingDeliveries(Date.now() + 60000);
        assertTrue(second.skipped, "the immediate re-run is throttled");
        assertEquals(second.attempted, 0);
      });
    });
  });

  runner.test("checkpointPages - a drain mid-flight does not unpark the reply", function() {
    // Losing the flag here would strand the answer permanently: its Gmail
    // message is starred, so nothing but the drain would ever retry it.
    withParkedFixture("msg-keep-parked", ["1/3 a", "2/3 b", "3/3 c"], 1, function() {
      parkPendingDelivery("msg-keep-parked", "https://x/reply/tok");
      checkpointPages("msg-keep-parked", ["1/3 a", "2/3 b", "3/3 c"], 2, "https://x/reply/tok");

      var state = loadPageSession("msg-keep-parked");
      assertTrue(state.parked, "still parked after a partial drain");
      assertEquals(state.sent, 2);
    });
  });

  return runner.run();
}

// =============================================================================
// Helpers
// =============================================================================

/** Swap in a fake Garmin session for the duration of `body`. @private */
function withStubbedGarmin(sendFn, sentLog, body) {
  var original = createGarminSession;

  createGarminSession = function() {
    return {
      send: function(message) {
        var ok = sendFn(message);
        if (ok) sentLog.push(message);
        return ok;
      }
    };
  };

  try {
    body();
  } finally {
    createGarminSession = original;
  }
}

/** Prose of roughly `chars` characters, with sentence boundaries. @private */
function longSentences(chars) {
  var sentences = [
    "Check the battery voltage before anything else.",
    "It should read 12.6 V at rest and stay above 10 V while cranking.",
    "If the reading is low, clean the terminals down to bare metal.",
    "Then inspect the engine to chassis ground strap for corrosion.",
    "Warm the fuel filter if the temperature is below 0 C.",
    "Bleed the fuel system afterwards and try again."
  ];

  var out = "";
  var i = 0;
  while (out.length < chars) {
    out += (out ? " " : "") + sentences[i % sentences.length];
    i++;
  }
  return out.substring(0, chars).trim();
}

/** A string of exactly `chars` characters built from `word`. @private */
function repeatWord(word, chars) {
  var out = "";
  while (out.length < chars) {
    out += (out ? " " : "") + word;
  }
  return out.substring(0, chars);
}

/** @private */
function words(text) {
  return text.split(/\s+/).filter(function(w) { return w.length > 0; });
}

/**
 * Seed a checkpointed session, run `body`, then remove it. Keyed by a
 * test-only message id so the live property store is never disturbed.
 * @private
 */
function withParkedFixture(messageId, pages, sent, body) {
  clearPageSession(messageId);
  checkpointPages(messageId, pages, sent, "https://x/reply/tok");

  try {
    body();
  } finally {
    clearPageSession(messageId);
    clearDrainThrottle();
  }
}

/** @private */
function clearDrainThrottle() {
  PropertiesService.getScriptProperties().deleteProperty(PENDING_DRAIN_STAMP_KEY);
}
