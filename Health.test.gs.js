/**
 * Unit tests for alerting, degradation tracking, the canary probe and the
 * parked-reply drain.
 *
 * These cover the machinery that is supposed to notice the next outage. It is
 * worth testing precisely because it only ever runs when something else has
 * already gone wrong, which is the worst possible time to find out it does not
 * work.
 *
 * These tests are pushed to Apps Script and can be run from the editor against
 * the LIVE property store, so every one of them touches only the keys listed in
 * TOUCHED_PROPERTIES, and the whole suite runs inside a snapshot/restore. No
 * test may call deleteAllProperties: GEMINI_KEY lives in that same store.
 *
 * Run with: runHealthTests()
 */

function runHealthTests() {
  var runner = new TestRunner();

  // ---------------------------------------------------------------------------
  // Alert addressing
  // ---------------------------------------------------------------------------

  runner.test("resolveAlertEmail - prefers the explicit config value", function() {
    withAlertConfig("configured@example.com", null, function() {
      assertEquals(resolveAlertEmail(), "configured@example.com");
    });
  });

  runner.test("resolveAlertEmail - falls back to the script property", function() {
    withAlertConfig(null, "property@example.com", function() {
      assertEquals(resolveAlertEmail(), "property@example.com");
    });
  });

  // Needing no configuration is the point: the previous alerting was wired
  // correctly and stayed silent through two outages because nobody filled it in.
  runner.test("resolveAlertEmail - falls back to the script owner", function() {
    withAlertConfig(null, null, function() {
      assertTrue(resolveAlertEmail().length > 0, "the owner address is always available");
    });
  });

  runner.test("sendAlert - sends, and prefixes the subject", function() {
    resetHealthState();
    assertTrue(sendAlert("Something happened", "body text"));
    assertEquals(lastSentEmail().subject, "[SAT-COM] Something happened");
  });

  // ---------------------------------------------------------------------------
  // Degradation tracking
  // ---------------------------------------------------------------------------

  runner.test("recordDegradation - alerts on the first occurrence", function() {
    resetHealthState();
    assertEquals(recordDegradation("TEST_KIND", "first"), 1);
    assertEquals(sentEmailCount(), 1);
    assertTrue(lastSentEmail().subject.indexOf("Degraded: TEST_KIND") !== -1);
  });

  runner.test("recordDegradation - counts silently while the cooldown holds", function() {
    resetHealthState();
    recordDegradation("TEST_KIND", "first");
    assertEquals(sentEmailCount(), 1);

    assertEquals(recordDegradation("TEST_KIND", "second"), 2);
    assertEquals(recordDegradation("TEST_KIND", "third"), 3);

    // Still one alert - but the counter kept climbing, so whenever the next one
    // does go out it reports the real total instead of looking like a one-off.
    assertEquals(sentEmailCount(), 1);
    assertEquals(degradationState("TEST_KIND").count, 3);
  });

  runner.test("recordDegradation - alerts again once the cooldown expires", function() {
    resetHealthState();
    recordDegradation("TEST_KIND", "first");

    var state = degradationState("TEST_KIND");
    state.alerted = Date.now() - HEALTH.ALERT_COOLDOWN_MS - 1000;
    PropertiesService.getScriptProperties()
      .setProperty("HEALTH_TEST_KIND", JSON.stringify(state));

    recordDegradation("TEST_KIND", "later");
    assertEquals(sentEmailCount(), 2);
  });

  runner.test("recordDegradation - keeps kinds apart", function() {
    resetHealthState();
    recordDegradation("TEST_KIND", "a");
    recordDegradation("TEST_OTHER", "b");

    assertEquals(degradationState("TEST_KIND").count, 1);
    assertEquals(degradationState("TEST_OTHER").count, 1);
    assertEquals(sentEmailCount(), 2);
  });

  runner.test("clearDegradation - reports recovery only after an alert", function() {
    resetHealthState();
    recordDegradation("TEST_KIND", "broken");
    assertEquals(sentEmailCount(), 1);

    clearDegradation("TEST_KIND");
    assertEquals(degradationState("TEST_KIND"), null);
    assertEquals(sentEmailCount(), 2);
    assertTrue(lastSentEmail().subject.indexOf("Recovered: TEST_KIND") !== -1);
  });

  runner.test("clearDegradation - stays silent when nothing was wrong", function() {
    resetHealthState();
    clearDegradation("TEST_KIND");
    assertEquals(sentEmailCount(), 0);
  });

  // ---------------------------------------------------------------------------
  // Reply token memory
  // ---------------------------------------------------------------------------

  runner.test("rememberReplyToken - round-trips the newest id", function() {
    resetHealthState();
    rememberReplyToken("ABC123");

    var known = lastReplyToken();
    assertEquals(known.token, "ABC123");
    assertTrue(!known.stale, "a fresh token is not stale");
  });

  runner.test("lastReplyToken - marks an aged id stale", function() {
    resetHealthState();
    PropertiesService.getScriptProperties().setProperty(
      LAST_REPLY_TOKEN_KEY,
      JSON.stringify({ token: "OLD", timestamp: Date.now() - HEALTH.TOKEN_TTL_MS - 1000 })
    );

    assertTrue(lastReplyToken().stale, "an id older than the TTL is stale");
  });

  runner.test("lastReplyToken - returns null when nothing is stored", function() {
    resetHealthState();
    assertEquals(lastReplyToken(), null);
  });

  // ---------------------------------------------------------------------------
  // isActionNotFound - the signal the whole canary turns on
  // ---------------------------------------------------------------------------

  runner.test("isActionNotFound - reads the Next.js header", function() {
    assertTrue(isActionNotFound(
      new MockHttpResponse(404, "Server action not found.", { "x-nextjs-action-not-found": "1" })
    ));
  });

  runner.test("isActionNotFound - does not care how the header is cased", function() {
    assertTrue(isActionNotFound(
      new MockHttpResponse(404, "", { "X-NextJS-Action-Not-Found": "1" })
    ));
  });

  runner.test("isActionNotFound - falls back to the body if a proxy strips the header", function() {
    assertTrue(isActionNotFound(new MockHttpResponse(404, "Server action not found.", {})));
  });

  runner.test("isActionNotFound - an ordinary 404 is not this", function() {
    assertTrue(!isActionNotFound(new MockHttpResponse(404, "<html>Not Found</html>", {})));
  });

  runner.test("isActionNotFound - a rejected reply is not this", function() {
    assertTrue(!isActionNotFound(new MockHttpResponse(500, '1:E{"digest":"3691864381"}', {})));
  });

  runner.test("headerValue - returns null for a missing header", function() {
    assertEquals(headerValue({ "content-type": "text/html" }, "x-missing"), null);
    assertEquals(headerValue(null, "anything"), null);
  });

  // ---------------------------------------------------------------------------
  // The canary probe
  // ---------------------------------------------------------------------------

  runner.test("probeGarminDelivery - HEALTHY when discovery works and the action answers", function() {
    var result = probeGarminDelivery("ABC123", healthyGarminMock());

    assertEquals(result.status, "HEALTHY");
    assertTrue(result.discovered, "the id came from the live chunk");
    assertEquals(result.actionId, GARMIN_FIXTURES.ACTION_ID);
  });

  // The probe must never be able to deliver. It calls the real action with an
  // id no conversation can own, so the action runs and finds nobody.
  runner.test("probeGarminDelivery - posts an id that cannot address anyone", function() {
    var http = healthyGarminMock();
    probeGarminDelivery("ABC123", http);

    var posts = http.posts();
    assertEquals(posts.length, 1);
    assertTrue(
      posts[0].options.payload.indexOf(GARMIN.CANARY_INVALID_ID) !== -1,
      "the probe payload carries the canary id"
    );
    assertTrue(
      posts[0].options.payload.indexOf("ABC123") === -1,
      "the probe never addresses the real conversation"
    );
  });

  // The state that held silently for weeks before delivery collapsed.
  runner.test("probeGarminDelivery - DEGRADED when only the pinned fallback answers", function() {
    var http = garminMock([
      { method: "get", contains: "/web/reply/", status: 200, body: "<html>no route chunk</html>" },
      { method: "post", contains: "/web/reply/", status: 500, body: '1:E{"digest":"1"}' }
    ]);

    var result = probeGarminDelivery("ABC123", http);

    assertEquals(result.status, "DEGRADED");
    assertTrue(!result.discovered, "discovery failed");
    assertEquals(result.actionId, GARMIN.SEND_REPLY_ACTION_ID);
  });

  // The outage itself.
  runner.test("probeGarminDelivery - BROKEN when the action id is not served", function() {
    var http = garminMock([
      { method: "get", contains: "/web/reply/", status: 200, body: GARMIN_FIXTURES.CHUNK_REFERENCE },
      { method: "get", contains: GARMIN_FIXTURES.CHUNK_PATH, status: 200, body: GARMIN_FIXTURES.ACTION_CALL },
      {
        method: "post", contains: "/web/reply/", status: 404,
        body: "Server action not found.", headers: { "x-nextjs-action-not-found": "1" }
      }
    ]);

    assertEquals(probeGarminDelivery("ABC123", http).status, "BROKEN");
  });

  runner.test("probeGarminDelivery - INCONCLUSIVE without an id to probe", function() {
    assertEquals(probeGarminDelivery(null, garminMock([])).status, "INCONCLUSIVE");
  });

  // A Garmin blip or an expired reply id proves nothing either way. Alerting on
  // it would only teach the reader to ignore the alert.
  runner.test("probeGarminDelivery - INCONCLUSIVE on an unexpected status", function() {
    var http = garminMock([
      { method: "get", contains: "/web/reply/", status: 502, body: "Bad Gateway" },
      { method: "post", contains: "/web/reply/", status: 502, body: "Bad Gateway" }
    ]);

    assertEquals(probeGarminDelivery("ABC123", http).status, "INCONCLUSIVE");
  });

  // An expired reply id is indistinguishable from a break at the wire level, so
  // it must not raise one. Otherwise the canary cries wolf whenever the device
  // has been quiet for a week.
  runner.test("runGarminCanary - will not call a break on a stale reply id", function() {
    resetHealthState();
    PropertiesService.getScriptProperties().setProperty(
      LAST_REPLY_TOKEN_KEY,
      JSON.stringify({ token: "OLD", timestamp: Date.now() - HEALTH.TOKEN_TTL_MS - 1000 })
    );

    var result = withStubbedProbe(
      { status: "BROKEN", detail: "action not served", discovered: false },
      runGarminCanary
    );

    assertEquals(result.status, "INCONCLUSIVE");
    assertEquals(degradationState("GARMIN_DELIVERY"), null, "no alert on an unprovable break");
    resetHealthState();
  });

  runner.test("runGarminCanary - does call a break on a fresh reply id", function() {
    resetHealthState();
    rememberReplyToken("FRESH");

    var result = withStubbedProbe(
      { status: "BROKEN", detail: "action not served", discovered: true },
      runGarminCanary
    );

    assertEquals(result.status, "BROKEN");
    assertNotNull(degradationState("GARMIN_DELIVERY"), "a provable break is reported");
    resetHealthState();
  });

  runner.test("runGarminCanary - skips when no reply id has been seen", function() {
    resetHealthState();
    assertEquals(runGarminCanary().status, "SKIPPED");
    assertEquals(sentEmailCount(), 0);
  });

  // ---------------------------------------------------------------------------
  // Captured fixtures
  // ---------------------------------------------------------------------------

  // These assert against bytes sliced out of the live page by
  // capture-garmin-fixtures.js. The fixture they replaced was written by hand
  // from what the author believed Garmin emitted, and the suite passed all the
  // way through an outage because of it.
  runner.test("captured fixture - the real page reference yields a usable chunk path", function() {
    var paths = extractReplyChunkPaths(GARMIN_FIXTURES.CHUNK_REFERENCE);
    assertTrue(paths.length > 0, "at least one candidate from the captured payload");
    assertEquals(paths[0], "/web/_next/" + GARMIN_FIXTURES.CHUNK_PATH);
  });

  runner.test("captured fixture - the real bundle yields the action id", function() {
    assertEquals(
      extractSendReplyActionId(GARMIN_FIXTURES.ACTION_CALL),
      GARMIN_FIXTURES.ACTION_ID
    );
  });

  // The captured path is build-relative, which is precisely what the original
  // extractor could not see. Guard against quietly regressing to the old shape.
  runner.test("captured fixture - the path really is build-relative", function() {
    assertTrue(
      GARMIN_FIXTURES.CHUNK_PATH.indexOf("/web/_next/") !== 0,
      "Garmin ships the path without the asset-root prefix"
    );
  });

  // Everything above writes to the live property store when run from the Apps
  // Script editor, so the whole suite runs inside a snapshot.
  return withPreservedProperties(TOUCHED_PROPERTIES, function() {
    return runner.run();
  });
}

// =============================================================================
// =============================  TEST HELPERS  ================================
// =============================================================================

/**
 * Every property key these tests are allowed to touch. Anything outside this
 * list - GEMINI_KEY above all - must come through untouched.
 */
var TOUCHED_PROPERTIES = [
  "HEALTH_TEST_KIND",
  "HEALTH_TEST_OTHER",
  "HEALTH_GARMIN_DELIVERY",
  "HEALTH_ACTION_ID_DISCOVERY",
  "HEALTH_GARMIN_ACTION_ROTATED",
  "ALERT_EMAIL",
  "LAST_REPLY_TOKEN"
];

/**
 * Snapshot the listed keys, run `body`, then put them back exactly as they
 * were - including being absent.
 * @private
 */
function withPreservedProperties(keys, body) {
  var props = PropertiesService.getScriptProperties();
  var saved = {};

  for (var i = 0; i < keys.length; i++) saved[keys[i]] = props.getProperty(keys[i]);

  try {
    return body();
  } finally {
    for (var j = 0; j < keys.length; j++) {
      if (saved[keys[j]] === null || saved[keys[j]] === undefined) {
        props.deleteProperty(keys[j]);
      } else {
        props.setProperty(keys[j], saved[keys[j]]);
      }
    }
  }
}

/** Clear only this suite's keys, and the outbox. @private */
function resetHealthState() {
  var props = PropertiesService.getScriptProperties();
  for (var i = 0; i < TOUCHED_PROPERTIES.length; i++) {
    props.deleteProperty(TOUCHED_PROPERTIES[i]);
  }
  clearSentEmails();
}

/** @private */
function clearSentEmails() {
  if (typeof sentEmails !== "undefined" && sentEmails) sentEmails.length = 0;
}

/** @private */
function sentEmailCount() {
  return typeof sentEmails === "undefined" || !sentEmails ? 0 : sentEmails.length;
}

/** @private */
function lastSentEmail() {
  return sentEmailCount() === 0 ? null : sentEmails[sentEmails.length - 1];
}

/**
 * Run `body` with the alert address resolved from a known configuration.
 * @private
 */
function withAlertConfig(configValue, propertyValue, body) {
  var originalConfig = SYSTEM.ALERT_EMAIL;
  resetHealthState();

  SYSTEM.ALERT_EMAIL = configValue;
  if (propertyValue) {
    PropertiesService.getScriptProperties().setProperty("ALERT_EMAIL", propertyValue);
  }

  try {
    body();
  } finally {
    SYSTEM.ALERT_EMAIL = originalConfig;
    resetHealthState();
  }
}

/**
 * Run `body` with probeGarminDelivery replaced by a fixed verdict.
 * @private
 */
function withStubbedProbe(verdict, body) {
  var original = probeGarminDelivery;
  probeGarminDelivery = function() { return verdict; };

  try {
    return body();
  } finally {
    probeGarminDelivery = original;
  }
}

/**
 * An HTTP client that answers on method AND url.
 *
 * The shared MockHttpClient matches on url alone, and the probe GETs and POSTs
 * the same reply URL - so without this a probe would "pass" by reading the page
 * back as though it were the action's answer.
 *
 * A route may carry `times`, after which it stops matching and a later route
 * takes over - which is how a rotation is staged: the first POST is refused,
 * the one after it succeeds.
 *
 * @param {Array<{method: string, contains: string, status: number, body: string, headers: (Object|undefined), times: (number|undefined)}>} routes
 * @private
 */
function garminMock(routes) {
  var used = [];

  return {
    requests: [],

    fetch: function(url, options) {
      var method = ((options && options.method) || "get").toLowerCase();
      this.requests.push({ url: url, options: options, method: method });

      for (var i = 0; i < routes.length; i++) {
        if (routes[i].method !== method) continue;
        if (url.indexOf(routes[i].contains) === -1) continue;

        used[i] = (used[i] || 0) + 1;
        if (routes[i].times && used[i] > routes[i].times) continue;

        return new MockHttpResponse(routes[i].status, routes[i].body, routes[i].headers || {});
      }

      return new MockHttpResponse(404, "Not Found", {});
    },

    posts: function() {
      return this.requests.filter(function(r) { return r.method === "post"; });
    },

    gets: function() {
      return this.requests.filter(function(r) { return r.method === "get"; });
    }
  };
}

/**
 * A Garmin that behaves, seen from the CANARY: the reply page carries a route
 * chunk, the chunk declares the action, and the action refuses the canary's
 * impossible reply id. That refusal is the pass - only live code could produce
 * it - which is why the POST here answers 500 rather than 200.
 * @private
 */
function healthyGarminMock() {
  return garminMock(garminDiscoveryRoutes().concat([
    { method: "post", contains: "/web/reply/", status: 500, body: '1:E{"digest":"3691864381"}' }
  ]));
}

/**
 * A Garmin that behaves, seen from a REAL SEND: same discovery, but the action
 * accepts the reply and answers with a flight stream.
 * @private
 */
function deliveringGarminMock() {
  return garminMock(garminDiscoveryRoutes().concat([
    { method: "post", contains: "/web/reply/", status: 200, body: "0:null" }
  ]));
}

/**
 * The two GETs that make action-id discovery succeed.
 *
 * Chunk first: its URL also contains "/web/reply/" as a substring would not,
 * but keeping the more specific route ahead of the general one is the habit
 * that stops a mock from quietly answering the wrong request.
 * @private
 */
function garminDiscoveryRoutes() {
  return [
    { method: "get", contains: GARMIN_FIXTURES.CHUNK_PATH, status: 200, body: GARMIN_FIXTURES.ACTION_CALL },
    { method: "get", contains: "/web/reply/", status: 200, body: GARMIN_FIXTURES.CHUNK_REFERENCE }
  ];
}
