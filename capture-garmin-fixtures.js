#!/usr/bin/env node
/**
 * Refresh the Garmin fixtures from the live Messenger reply page.
 *
 * Why this exists: the unit fixture for the reply page used to be written by
 * hand, from what the author believed Garmin emitted. Garmin emitted something
 * else, so the suite stayed green through a total delivery outage it was
 * written to catch. A fixture is only worth anything if it came from reality.
 *
 * What it captures is deliberately small: the two exact substrings the
 * extractors have to cope with, sliced out of the live response by machine.
 * Vendoring Garmin's whole page and route bundle would be both bulky and
 * somebody else's copyrighted code; the reply id and the account holder's name
 * would come along with it.
 *
 * Usage:
 *   node capture-garmin-fixtures.js <tinyUrlId>
 *
 * The id is the token from any recent inReach notification email:
 *   https://inreachlink.com/<tinyUrlId>
 * It must still be live - Garmin serves a 404 shell for anything else, and the
 * shell carries no route chunk to capture.
 */

const fs = require('fs');
const path = require('path');
const https = require('https');

const ORIGIN = 'https://messenger.garmin.com';
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36';

const OUTPUT = path.join(__dirname, 'GarminFixtures.gs.js');

function get(url) {
  return new Promise((resolve, reject) => {
    https
      .get(url, { headers: { 'User-Agent': USER_AGENT, Accept: '*/*' } }, (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => resolve({ statusCode: res.statusCode, body: data }));
      })
      .on('error', reject);
  });
}

/** Slice `before`/`after` characters around a match, so the capture keeps its real context. */
function windowAround(text, match, before, after) {
  const start = Math.max(0, match.index - before);
  const end = Math.min(text.length, match.index + match[0].length + after);
  return text.substring(start, end);
}

function jsStringLiteral(value) {
  return JSON.stringify(value);
}

async function main() {
  const tinyUrlId = process.argv[2];

  if (!tinyUrlId) {
    console.error('Usage: node capture-garmin-fixtures.js <tinyUrlId>');
    console.error('Take the token from a recent inReach email: https://inreachlink.com/<tinyUrlId>');
    process.exit(1);
  }

  const pageUrl = `${ORIGIN}/web/reply/${tinyUrlId}`;
  console.log(`Fetching ${pageUrl}`);

  const page = await get(pageUrl);
  if (page.statusCode !== 200) {
    console.error(`Reply page returned HTTP ${page.statusCode}; cannot capture.`);
    process.exit(1);
  }

  // 1. How the page references its route chunk. This is the exact shape that
  //    broke discovery: a build-relative path inside the RSC flight payload,
  //    with no /web/_next/ prefix and escaped quotes around it.
  const chunkMatch = page.body.match(/static\/chunks\/app\/[^"'\\\s]*page-[a-z0-9]+\.js/i);
  if (!chunkMatch) {
    console.error('No route page chunk found in the reply page.');
    console.error('Either the reply id has expired, or Garmin has restructured the route.');
    console.error('If the id is fresh, this IS the finding - discovery is broken.');
    process.exit(1);
  }

  const chunkReference = windowAround(page.body, chunkMatch, 160, 40);
  const chunkPath = chunkMatch[0];
  console.log(`  route chunk: ${chunkPath}`);

  // 2. How the route bundle declares the server action.
  const chunkUrl = `${ORIGIN}/web/_next/${chunkPath.replace(/^\/+/, '')}`;
  console.log(`Fetching ${chunkUrl}`);

  const chunk = await get(chunkUrl);
  if (chunk.statusCode !== 200) {
    console.error(`Route chunk returned HTTP ${chunk.statusCode}; cannot capture.`);
    process.exit(1);
  }

  const actionMatch = chunk.body.match(
    /createServerReference[\s\S]{0,200}?"sendReplyAction"\s*\)?/
  );
  if (!actionMatch) {
    console.error('No sendReplyAction declaration found in the route chunk.');
    process.exit(1);
  }

  const actionCall = windowAround(chunk.body, actionMatch, 40, 4);
  const actionId = (actionCall.match(/"([0-9a-f]{20,})"/) || [])[1] || null;
  console.log(`  action id:   ${actionId}`);

  // Neither slice should carry the reply id or anything personal. Fail loudly
  // rather than commit a capture that does.
  for (const [name, slice] of [['chunk reference', chunkReference], ['action call', actionCall]]) {
    if (slice.includes(tinyUrlId)) {
      console.error(`Refusing to write: the ${name} slice contains the reply id.`);
      process.exit(1);
    }
  }

  const capturedAt = new Date().toISOString().substring(0, 10);

  const contents = `/**
 * Captured Garmin Messenger fixtures - DO NOT EDIT BY HAND.
 *
 * Regenerate with:  node capture-garmin-fixtures.js <tinyUrlId>
 *
 * These are verbatim slices of the live reply page and its route bundle, taken
 * by machine. The point is that nobody types them: a fixture written from
 * belief rather than observation is how a hand-written <script src> fixture
 * kept the suite green through a total delivery outage.
 *
 * Captured: ${capturedAt}
 * Source:   ${ORIGIN}/web/reply/<tinyUrlId> and its route chunk
 */

const GARMIN_FIXTURES = {
  CAPTURED_AT: ${jsStringLiteral(capturedAt)},

  // The route chunk path exactly as the page carries it.
  CHUNK_PATH: ${jsStringLiteral(chunkPath)},

  // Its surrounding bytes in the RSC flight payload, escaping and all.
  CHUNK_REFERENCE: ${jsStringLiteral(chunkReference)},

  // The server action id live at capture time. Expected to go stale - that is
  // the whole reason discovery exists.
  ACTION_ID: ${jsStringLiteral(actionId)},

  // The createServerReference call as the bundle declares it.
  ACTION_CALL: ${jsStringLiteral(actionCall)}
};
`;

  fs.writeFileSync(OUTPUT, contents);
  console.log(`\nWrote ${path.relative(process.cwd(), OUTPUT)}`);
  console.log('Run `npm test` to check the extractors still cope with it.');
}

main().catch((e) => {
  console.error(`Capture failed: ${e.message}`);
  process.exit(1);
});
