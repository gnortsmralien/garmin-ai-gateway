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

  // A trimmed copy of the real Garmin Messenger reply page markup.
  var MESSENGER_HTML = [
    '<!DOCTYPE html><html><head><title>Garmin Messenger</title>',
    '<script src="/web/_next/static/chunks/493-b123362a0b052b35.js" async=""></script>',
    '<script src="/web/_next/static/chunks/app/(public)/reply/%5BtinyUrlId%5D/page-bd52b15b7da15760.js" async=""></script>',
    '</head><body><form data-slot="composer-root"></form></body></html>'
  ].join("");

  // The shape emitted by the Next.js build for the reply route.
  var CHUNK_JS =
    'var m=r(70468);let g=(0,m.createServerReference)("60e0518dd113775ab471a769fddd3860d84bad10e6",' +
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

  runner.test("extractReplyChunkPath - finds the reply route chunk", function() {
    assertEquals(
      extractReplyChunkPath(MESSENGER_HTML),
      "/web/_next/static/chunks/app/(public)/reply/%5BtinyUrlId%5D/page-bd52b15b7da15760.js"
    );
  });

  runner.test("extractReplyChunkPath - returns null when the route chunk is absent", function() {
    assertEquals(extractReplyChunkPath("<html><body>nothing</body></html>"), null);
  });

  runner.test("extractSendReplyActionId - recovers the live action id", function() {
    assertEquals(
      extractSendReplyActionId(CHUNK_JS),
      "60e0518dd113775ab471a769fddd3860d84bad10e6"
    );
  });

  runner.test("extractSendReplyActionId - ignores other server references", function() {
    var other = '(0,m.createServerReference)("aaaabbbbccccddddeeeeffff",m.callServer,void 0,m.findSourceMapURL,"someOtherAction");';
    assertEquals(extractSendReplyActionId(other), null);
  });

  // A Garmin redeploy rotates the hash; discovery is what keeps delivery alive.
  runner.test("extractSendReplyActionId - tracks a rotated hash", function() {
    var rotated = CHUNK_JS.replace("60e0518dd113775ab471a769fddd3860d84bad10e6", "ffff11112222333344445555666677778888aaaa99");
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

  return runner.run();
}

/** @private */
function repeatChar(chr, count) {
  var out = "";
  for (var i = 0; i < count; i++) out += chr;
  return out;
}
