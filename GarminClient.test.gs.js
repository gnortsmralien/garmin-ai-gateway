/**
 * Unit tests for Garmin Messenger reply delivery.
 *
 * These cover the pure link/protocol helpers. The network path (send) is
 * exercised by Pager tests, which stub createGarminSession wholesale.
 *
 * Run with: runGarminClientTests()
 */

function runGarminClientTests() {
  var runner = new TestRunner();

  // A trimmed copy of the real Garmin Messenger reply page markup, captured
  // 2026-09-14. The route chunk is NOT a <script src> - it appears only inside
  // the RSC flight payload, as a path relative to the build's asset root with
  // no /web/_next/ prefix. An extractor that insists on the absolute form finds
  // nothing here, which is how delivery broke while these tests stayed green.
  var MESSENGER_HTML = [
    '<!DOCTYPE html><html><head><title>Garmin Messenger</title>',
    '<script src="/web/_next/static/chunks/webpack-d878e7abadf5a59a.js"></script>',
    '</head><body><script>self.__next_f.push([1,"1c:I[45712,[\\"872\\",',
    '\\"static/chunks/872-f7f885460f56ee16.js\\",\\"830\\",',
    '\\"static/chunks/app/(reply)/reply/%5BtinyUrlId%5D/page-bc45dad094cf3426.js\\"],',
    '\\"default\\"]"])</script></body></html>'
  ].join("");

  // The same page before Garmin moved the route group, where the chunk was
  // prefetched as an absolute <script src>.
  var LEGACY_MESSENGER_HTML =
    '<script src="/web/_next/static/chunks/app/(public)/reply/%5BtinyUrlId%5D/page-bd52b15b7da15760.js" async=""></script>';

  // The shape emitted by the Next.js build for the reply route.
  var CHUNK_JS =
    'var m=r(68428);let g=(0,m.createServerReference)("60334910b222fcd08a0a5ae00c8a5ad85cb9acffdf",' +
    'm.callServer,void 0,m.findSourceMapURL,"sendReplyAction");';

  // ---------------------------------------------------------------------------
  // extractTinyUrlId
  // ---------------------------------------------------------------------------

  runner.test("extractTinyUrlId - reads the inreachlink.com short link", function() {
    assertEquals(
      extractTinyUrlId("https://inreachlink.com/ggLTIxMn9cA9cwC07_2Il4w"),
      "ggLTIxMn9cA9cwC07_2Il4w"
    );
  });

  runner.test("extractTinyUrlId - reads the /r?extId= redirect target", function() {
    assertEquals(
      extractTinyUrlId("https://messenger.garmin.com/r?extId=ggLTIxMn9cA9cwC07_2Il4w"),
      "ggLTIxMn9cA9cwC07_2Il4w"
    );
  });

  runner.test("extractTinyUrlId - reads the composer URL", function() {
    assertEquals(
      extractTinyUrlId("https://messenger.garmin.com/web/reply/ggLTIxMn9cA9cwC07_2Il4w"),
      "ggLTIxMn9cA9cwC07_2Il4w"
    );
  });

  runner.test("extractTinyUrlId - keeps underscores and hyphens in the token", function() {
    assertEquals(extractTinyUrlId("https://inreachlink.com/a-b_c123"), "a-b_c123");
  });

  runner.test("extractTinyUrlId - returns null when there is no id", function() {
    assertEquals(extractTinyUrlId("https://example.com/nothing"), null);
    assertEquals(extractTinyUrlId(null), null);
  });

  // ---------------------------------------------------------------------------
  // messengerReplyUrl / isLegacyReplyUrl
  // ---------------------------------------------------------------------------

  runner.test("messengerReplyUrl - builds the /web/reply composer URL", function() {
    assertEquals(
      messengerReplyUrl("ABC123"),
      "https://messenger.garmin.com/web/reply/ABC123"
    );
  });

  runner.test("messengerReplyUrl - returns null without an id", function() {
    assertEquals(messengerReplyUrl(null), null);
  });

  runner.test("isLegacyReplyUrl - recognises pre-migration explore.garmin.com links", function() {
    assertTrue(isLegacyReplyUrl("https://explore.garmin.com/textmessage/txtmsg?extId=abc-123"));
    assertTrue(!isLegacyReplyUrl("https://inreachlink.com/ABC123"));
    assertTrue(!isLegacyReplyUrl("https://messenger.garmin.com/web/reply/ABC123"));
  });

  // ---------------------------------------------------------------------------
  // Server action wiring
  // ---------------------------------------------------------------------------

  runner.test("buildReplyActionBody - encodes sendReplyAction(tinyUrlId, text)", function() {
    assertEquals(
      buildReplyActionBody("ABC123", "Rain expected. Descend before dusk."),
      '["ABC123","Rain expected. Descend before dusk."]'
    );
  });

  runner.test("buildReplyActionBody - escapes quotes and newlines", function() {
    var body = buildReplyActionBody("ABC123", 'say "hi"\nthen go');
    assertEquals(body, '["ABC123","say \\"hi\\"\\nthen go"]');
  });

  runner.test("extractReplyChunkPath - finds the chunk in the RSC flight payload", function() {
    assertEquals(
      extractReplyChunkPath(MESSENGER_HTML),
      "/web/_next/static/chunks/app/(reply)/reply/%5BtinyUrlId%5D/page-bc45dad094cf3426.js"
    );
  });

  runner.test("extractReplyChunkPath - still reads an absolute <script src>", function() {
    assertEquals(
      extractReplyChunkPath(LEGACY_MESSENGER_HTML),
      "/web/_next/static/chunks/app/(public)/reply/%5BtinyUrlId%5D/page-bd52b15b7da15760.js"
    );
  });

  runner.test("extractReplyChunkPath - returns null when the route chunk is absent", function() {
    assertEquals(extractReplyChunkPath("<html><body>nothing</body></html>"), null);
  });

  // The route group is Garmin's to rename, so a page chunk that does not say
  // "reply" is a later candidate rather than no candidate at all.
  runner.test("extractReplyChunkPaths - ranks reply chunks ahead of other routes", function() {
    var html =
      '"static/chunks/app/(main)/conversations/page-aaaa1111.js",' +
      '"static/chunks/app/(reply)/reply/%5BtinyUrlId%5D/page-bbbb2222.js"';
    var paths = extractReplyChunkPaths(html);
    assertEquals(paths.length, 2);
    assertEquals(paths[0], "/web/_next/static/chunks/app/(reply)/reply/%5BtinyUrlId%5D/page-bbbb2222.js");
    assertEquals(paths[1], "/web/_next/static/chunks/app/(main)/conversations/page-aaaa1111.js");
  });

  runner.test("extractReplyChunkPaths - de-duplicates repeated references", function() {
    var once = '"static/chunks/app/(reply)/reply/%5BtinyUrlId%5D/page-bbbb2222.js"';
    assertEquals(extractReplyChunkPaths(once + "," + once).length, 1);
  });

  runner.test("extractReplyChunkPaths - returns an empty list for empty input", function() {
    assertEquals(extractReplyChunkPaths(null).length, 0);
    assertEquals(extractReplyChunkPaths("").length, 0);
  });

  runner.test("extractSendReplyActionId - recovers the live action id", function() {
    assertEquals(
      extractSendReplyActionId(CHUNK_JS),
      "60334910b222fcd08a0a5ae00c8a5ad85cb9acffdf"
    );
  });

  runner.test("extractSendReplyActionId - tolerates a dropped call wrapper", function() {
    var bare = 'm.createServerReference("60334910b222fcd08a0a5ae00c8a5ad85cb9acffdf",' +
      'm.callServer,void 0,m.findSourceMapURL,"sendReplyAction");';
    assertEquals(extractSendReplyActionId(bare), "60334910b222fcd08a0a5ae00c8a5ad85cb9acffdf");
  });

  runner.test("extractSendReplyActionId - ignores other server references", function() {
    var other = '(0,m.createServerReference)("aaaabbbbccccddddeeeeffff",m.callServer,void 0,m.findSourceMapURL,"someOtherAction");';
    assertEquals(extractSendReplyActionId(other), null);
  });

  // A Garmin redeploy rotates the hash; discovery is what keeps delivery alive.
  runner.test("extractSendReplyActionId - tracks a rotated hash", function() {
    var rotated = CHUNK_JS.replace("60334910b222fcd08a0a5ae00c8a5ad85cb9acffdf", "ffff11112222333344445555666677778888aaaa99");
    assertEquals(extractSendReplyActionId(rotated), "ffff11112222333344445555666677778888aaaa99");
  });

  // ---------------------------------------------------------------------------
  // isActionSuccess
  // ---------------------------------------------------------------------------

  runner.test("isActionSuccess - accepts a 200 flight response", function() {
    assertTrue(isActionSuccess(200, '0:null\n1:"$@2"\n'));
  });

  runner.test("isActionSuccess - accepts a 303 redirect", function() {
    assertTrue(isActionSuccess(303, ""));
  });

  runner.test("isActionSuccess - rejects a thrown server action", function() {
    assertTrue(!isActionSuccess(200, '1:E{"digest":"3149042934","message":"boom"}'));
  });

  runner.test("isActionSuccess - rejects non-2xx", function() {
    assertTrue(!isActionSuccess(404, "Not Found"));
    assertTrue(!isActionSuccess(500, "Internal Server Error"));
  });

  // ---------------------------------------------------------------------------
  // Session wiring
  // ---------------------------------------------------------------------------

  runner.test("GarminSession - routes a short link to the Messenger composer", function() {
    var session = createGarminSession("https://inreachlink.com/ABC123");
    assertTrue(!session.legacy, "short links are not legacy");
    assertEquals(session.tinyUrlId, "ABC123");
    assertEquals(session.pageUrl, "https://messenger.garmin.com/web/reply/ABC123");
  });

  runner.test("GarminSession - keeps legacy links on the old form POST", function() {
    var session = createGarminSession(
      "https://explore.garmin.com/textmessage/txtmsg?extId=abc-123&adr=me%40example.com"
    );
    assertTrue(session.legacy, "explore.garmin.com stays legacy");
    assertEquals(session.postUrl, "https://explore.garmin.com/TextMessage/TxtMsg");
  });

  runner.test("GarminSession - refuses a message over the 160 character cap", function() {
    var session = createGarminSession("https://inreachlink.com/ABC123");
    // Guards the cap without touching the network: the length check precedes
    // any fetch, so UrlFetchApp is never reached.
    assertTrue(!session.send(repeatChar("x", GARMIN.MAX_MESSAGE_CHARS + 1), false));
  });

  // ---------------------------------------------------------------------------
  // Delivery
  //
  // This path used to be untestable - the session reached straight for
  // UrlFetchApp, and the Pager tests stubbed the whole session out. So a send
  // that answered 404 on every single call shipped twice without a failing
  // test. The HTTP client is injectable now; these exercise the real thing.
  // ---------------------------------------------------------------------------

  runner.test("send - posts the discovered action id", function() {
    var http = deliveringGarminMock();
    var session = createGarminSession("https://inreachlink.com/ABC123", http);

    assertTrue(session.send("Rain expected. Descend before dusk.", false));

    var posts = http.posts();
    assertEquals(posts.length, 1);
    assertEquals(posts[0].options.headers["Next-Action"], GARMIN_FIXTURES.ACTION_ID);
    assertTrue(
      posts[0].options.payload.indexOf("ABC123") !== -1,
      "the reply id is the first server-action argument"
    );
  });

  // The outage, healed in place: Garmin says the hash is gone, so rediscover
  // and re-post now rather than spending a delivery attempt on a dead id.
  runner.test("send - rediscovers and re-posts when the action id has rotated", function() {
    var http = garminMock(garminDiscoveryRoutes().concat([
      {
        method: "post", contains: "/web/reply/", status: 404, times: 1,
        body: "Server action not found.", headers: { "x-nextjs-action-not-found": "1" }
      },
      { method: "post", contains: "/web/reply/", status: 200, body: "0:null" }
    ]));

    // Start from a stale pinned id, as a session would after a Garmin deploy.
    var session = createGarminSession("https://inreachlink.com/ABC123", http);
    session.actionId = "deadbeefdeadbeefdeadbeefdeadbeef00";

    assertTrue(session.send("hello", false), "the retry inside the same attempt succeeds");
    assertEquals(http.posts().length, 2);
    assertEquals(http.posts()[1].options.headers["Next-Action"], GARMIN_FIXTURES.ACTION_ID);
  });

  // If rediscovery can only hand back the id that just failed, posting it a
  // second time would be pure waste.
  runner.test("send - does not re-post when rediscovery returns the same dead id", function() {
    var http = garminMock([
      { method: "get", contains: "/web/reply/", status: 200, body: "<html>no route chunk</html>" },
      {
        method: "post", contains: "/web/reply/", status: 404,
        body: "Server action not found.", headers: { "x-nextjs-action-not-found": "1" }
      }
    ]);

    var session = createGarminSession("https://inreachlink.com/ABC123", http);

    assertFalse(session.send("hello", false));
    assertEquals(http.posts().length, 1);
  });

  runner.test("send - a thrown server action is a failed delivery", function() {
    var http = garminMock(garminDiscoveryRoutes().concat([
      { method: "post", contains: "/web/reply/", status: 200, body: '1:E{"digest":"3691864381"}' }
    ]));

    var session = createGarminSession("https://inreachlink.com/ABC123", http);
    assertFalse(session.send("hello", false));
  });

  // The leading indicator. Delivery still works here - the pinned id answers -
  // but this is exactly the state that held silently for weeks last time.
  runner.test("send - records a degradation when it has to use the pinned id", function() {
    resetHealthState();

    var http = garminMock([
      { method: "get", contains: "/web/reply/", status: 200, body: "<html>no route chunk</html>" },
      { method: "post", contains: "/web/reply/", status: 200, body: "0:null" }
    ]);

    var session = createGarminSession("https://inreachlink.com/ABC123", http);

    assertTrue(session.send("hello", false), "the fallback still delivers");
    assertEquals(session.actionId, GARMIN.SEND_REPLY_ACTION_ID);

    var state = degradationState("ACTION_ID_DISCOVERY");
    assertNotNull(state, "falling back is never silent");
    assertEquals(state.count, 1);

    resetHealthState();
  });

  runner.test("send - a successful discovery clears a standing degradation", function() {
    resetHealthState();
    recordDegradation("ACTION_ID_DISCOVERY", "an earlier failure");

    var session = createGarminSession("https://inreachlink.com/ABC123", deliveringGarminMock());
    assertTrue(session.send("hello", false));
    assertEquals(degradationState("ACTION_ID_DISCOVERY"), null, "recovery is recorded too");

    resetHealthState();
  });

  // Alerting writes to the live property store when this runs in the editor.
  return withPreservedProperties(TOUCHED_PROPERTIES, function() {
    return runner.run();
  });
}

/** @private */
function repeatChar(chr, count) {
  var out = "";
  for (var i = 0; i < count; i++) out += chr;
  return out;
}
