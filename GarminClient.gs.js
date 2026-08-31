/**
 * Garmin inReach reply client.
 *
 * Garmin retired the old explore.garmin.com reply form (a server-rendered page
 * with hidden Guid/MessageId/ReplyAddress inputs POSTed to /TextMessage/TxtMsg)
 * and replaced it with Garmin Messenger, a Next.js app on messenger.garmin.com.
 * Replies now go through a React Server Action named `sendReplyAction`, called
 * as sendReplyAction(tinyUrlId, messageText).
 *
 * The notification email carries a short https://inreachlink.com/<token> link.
 * That token IS the tinyUrlId: the short link 301s to
 * https://messenger.garmin.com/r?extId=<token>, and the composer lives at
 * https://messenger.garmin.com/web/reply/<token>.
 *
 * Server Action IDs are content hashes that change on every Garmin front-end
 * deploy, so the id is discovered at run time from the route's JS chunk and
 * only falls back to the pinned constant if discovery fails. That keeps a
 * Garmin redeploy from silently killing delivery again.
 *
 * A GarminSession resolves the link and discovers the action id once, then
 * reuses both for every page of a multi-page reply.
 */

function GarminSession(url) {
  this.url = url;
  this.tinyUrlId = extractTinyUrlId(url);
  this.legacy = isLegacyReplyUrl(url);

  // Legacy explore.garmin.com links still use the old hidden-form POST.
  this.pageUrl = this.legacy ? stripAdrParam(url) : messengerReplyUrl(this.tinyUrlId);

  const domainMatch = url.match(/https:\/\/[^/]+/);
  this.origin = domainMatch ? domainMatch[0] : null;
  this.postUrl = this.legacy && this.origin ? this.origin + GARMIN.ENDPOINT_SUFFIX : null;

  this.formValues = null;
  this.actionId = null;
}

/**
 * POST one message. Returns true on success.
 *
 * @param {string} message
 * @param {boolean} [refresh] - re-read the reply page before posting
 * @returns {boolean}
 */
GarminSession.prototype.send = function(message, refresh) {
  if (SYSTEM.SIMULATE_GARMIN) {
    console.log(`[SIM] POST (${message.length} chars): "${message}"`);
    return true;
  }

  if (this.legacy) return this.sendLegacy(message, refresh);
  return this.sendMessenger(message, !!refresh);
};

/**
 * Deliver through the Garmin Messenger server action.
 * @private
 */
GarminSession.prototype.sendMessenger = function(message, refresh) {
  try {
    if (!this.tinyUrlId) {
      console.error(`[Garmin] No reply id in URL: ${String(this.url).substring(0, 100)}`);
      return false;
    }

    if (message.length > GARMIN.MAX_MESSAGE_CHARS) {
      console.error(`[Garmin] Message of ${message.length} chars exceeds the ${GARMIN.MAX_MESSAGE_CHARS} limit`);
      return false;
    }

    const actionId = this.ensureActionId(refresh);
    if (!actionId) {
      console.error(`[Garmin] No sendReplyAction id available`);
      return false;
    }

    debug(`[Garmin] Server action POST ${this.pageUrl} (${message.length} chars)`);

    const response = UrlFetchApp.fetch(this.pageUrl, {
      method: 'post',
      contentType: 'text/plain;charset=UTF-8',
      payload: buildReplyActionBody(this.tinyUrlId, message),
      followRedirects: true,
      headers: {
        'User-Agent': GARMIN.USER_AGENT,
        'Accept': 'text/x-component',
        'Next-Action': actionId,
        'Referer': this.pageUrl,
        'Origin': GARMIN.MESSENGER_ORIGIN
      },
      muteHttpExceptions: true
    });

    const code = response.getResponseCode();
    const body = response.getContentText();

    if (!isActionSuccess(code, body)) {
      console.error(`[Garmin] Server action failed HTTP ${code}: ${body.substring(0, 200)}`);
      // A rotated deploy invalidates the cached action id; drop it so the next
      // attempt rediscovers rather than replaying a stale hash.
      this.actionId = null;
      return false;
    }

    debug(`[Garmin] Server action accepted`);
    return true;
  } catch (e) {
    console.error(`[Garmin] Exception: ${e}`);
    this.actionId = null;
    return false;
  }
};

/**
 * Fetch the reply page and read the current sendReplyAction id out of its
 * route chunk. Cached for the life of the session.
 *
 * @param {boolean} force - rediscover even if an id is cached
 * @returns {string|null}
 * @private
 */
GarminSession.prototype.ensureActionId = function(force) {
  if (this.actionId && !force) return this.actionId;

  this.actionId = discoverSendReplyActionId(this.pageUrl) || GARMIN.SEND_REPLY_ACTION_ID;
  return this.actionId;
};

/**
 * Legacy explore.garmin.com hidden-form delivery, kept for links issued before
 * the Messenger migration.
 * @private
 */
GarminSession.prototype.sendLegacy = function(message, refresh) {
  try {
    if (!this.postUrl) {
      console.error(`[Garmin] Could not derive POST URL from ${this.url.substring(0, 80)}`);
      return false;
    }

    const values = this.ensureFormValues(!!refresh);
    if (!values) {
      console.error(`[Garmin] No form values available`);
      return false;
    }
    if (!values.replyAddress) {
      console.error(`[Garmin] No ReplyAddress available`);
      return false;
    }

    const payload = {
      'Guid': values.guid,
      'ReplyAddress': values.replyAddress,
      'MessageId': values.messageId,
      'ReplyMessage': message
    };

    debug(`[Garmin] Legacy POST ${this.postUrl} (${message.length} chars)`);

    const response = UrlFetchApp.fetch(this.postUrl, {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify(payload),
      followRedirects: true,
      headers: {
        'User-Agent': GARMIN.USER_AGENT,
        'Accept': '*/*',
        'Referer': this.pageUrl,
        'Origin': this.origin,
        'X-Requested-With': 'XMLHttpRequest'
      },
      muteHttpExceptions: true
    });

    const code = response.getResponseCode();
    const responseText = response.getContentText();

    if (code !== 200) {
      console.error(`[Garmin] HTTP ${code}: ${responseText.substring(0, 200)}`);
      this.formValues = null;
      return false;
    }

    try {
      const json = JSON.parse(responseText);
      if (json.Success === true || json.success === true) return true;
      if (json.error === true || json.Success === false || json.success === false) {
        console.error(`[Garmin] API returned error: ${json.message || json.Message || 'unknown'}`);
        this.formValues = null;
        return false;
      }
    } catch (e) {
      // Non-JSON body with HTTP 200 - treat as success.
    }

    return true;
  } catch (e) {
    console.error(`[Garmin] Exception: ${e}`);
    this.formValues = null;
    return false;
  }
};

/** @private */
GarminSession.prototype.ensureFormValues = function(force) {
  if (this.formValues && !force) return this.formValues;

  let values = extractGarminFormValues(this.pageUrl);

  if (!values) {
    debug(`[Garmin] Form extraction failed, falling back to URL parameters`);
    values = this.fallbackFormValues();
  }

  if (values && !values.replyAddress) {
    values.replyAddress = this.replyAddressFromUrl();
  }

  this.formValues = values;
  return values;
};

/** @private */
GarminSession.prototype.fallbackFormValues = function() {
  const extIdMatch = this.url.match(/extId=([a-zA-Z0-9\-_]+)/);
  if (!extIdMatch) {
    console.error(`[Garmin] Fallback failed - no extId in URL`);
    return null;
  }

  return {
    guid: extIdMatch[1],
    messageId: String(Math.floor(Date.now() / 1000)),
    replyAddress: this.replyAddressFromUrl()
  };
};

/** @private */
GarminSession.prototype.replyAddressFromUrl = function() {
  const match = this.url.match(/adr=([^&\s]+)/);
  return match ? decodeURIComponent(match[1]) : null;
};

/**
 * @param {string} url - Garmin reply URL
 * @returns {GarminSession}
 */
function createGarminSession(url) {
  return new GarminSession(url);
}

/**
 * Send a single message. Convenience wrapper for one-shot sends such as error
 * notifications; multi-page replies go through Pager.sendPages so the session
 * is reused.
 *
 * @param {string} url
 * @param {string} message
 * @returns {boolean}
 */
function postToGarmin(url, message) {
  return createGarminSession(url).send(message, false);
}

// =============================================================================
// =========================  MESSENGER LINK HANDLING  =========================
// =============================================================================

/**
 * Is this a pre-migration explore.garmin.com reply link?
 *
 * @param {string} url
 * @returns {boolean}
 */
function isLegacyReplyUrl(url) {
  return !!url && /explore\.garmin\.com\/textmessage\/txtmsg/i.test(url);
}

/**
 * Pull the Messenger reply id (tinyUrlId) out of any of the link shapes Garmin
 * hands out: the inreachlink.com short link, the /r?extId= redirect target, or
 * the composer URL itself.
 *
 * @param {string} url
 * @returns {string|null}
 */
function extractTinyUrlId(url) {
  if (!url) return null;

  const patterns = [
    /inreachlink\.com\/([A-Za-z0-9_\-]+)/i,
    /messenger\.garmin\.com\/web\/reply\/([A-Za-z0-9_\-]+)/i,
    /messenger\.garmin\.com\/reply\/([A-Za-z0-9_\-]+)/i,
    /[?&]extId=([A-Za-z0-9_\-]+)/i
  ];

  for (let i = 0; i < patterns.length; i++) {
    const match = url.match(patterns[i]);
    if (match && match[1]) return match[1];
  }

  return null;
}

/**
 * Composer URL for a reply id. Garmin Messenger serves the app under a /web
 * base path.
 *
 * @param {string|null} tinyUrlId
 * @returns {string|null}
 */
function messengerReplyUrl(tinyUrlId) {
  return tinyUrlId ? GARMIN.MESSENGER_ORIGIN + '/web/reply/' + tinyUrlId : null;
}

/**
 * Body for a `sendReplyAction(tinyUrlId, messageText)` server-action call.
 * Next.js expects the arguments as a JSON array.
 *
 * @param {string} tinyUrlId
 * @param {string} message
 * @returns {string}
 */
function buildReplyActionBody(tinyUrlId, message) {
  return JSON.stringify([tinyUrlId, message]);
}

/**
 * Locate the reply route's JS chunk in the page HTML.
 *
 * @param {string} html
 * @returns {string|null} chunk path, still URL-encoded as it appears in the HTML
 */
function extractReplyChunkPath(html) {
  if (!html) return null;
  const match = html.match(/\/web\/_next\/static\/chunks\/app\/[^"'\\\s]*reply[^"'\\\s]*page-[a-z0-9]+\.js/i);
  return match ? match[0] : null;
}

/**
 * Read the sendReplyAction id out of the route chunk source.
 *
 * @param {string} js
 * @returns {string|null}
 */
function extractSendReplyActionId(js) {
  if (!js) return null;
  const match = js.match(/createServerReference\)\s*\(\s*"([0-9a-f]{20,})"[^)]*?"sendReplyAction"/);
  return match ? match[1] : null;
}

/**
 * Fetch the reply page, then its route chunk, and recover the current
 * sendReplyAction id. Returns null if anything in the chain fails; the caller
 * falls back to the pinned id.
 *
 * @param {string} pageUrl
 * @returns {string|null}
 */
function discoverSendReplyActionId(pageUrl) {
  if (!pageUrl) return null;

  try {
    const pageResponse = UrlFetchApp.fetch(pageUrl, {
      method: 'get',
      headers: { 'User-Agent': GARMIN.USER_AGENT, 'Accept': 'text/html' },
      muteHttpExceptions: true,
      followRedirects: true
    });

    if (pageResponse.getResponseCode() !== 200) {
      debug(`[Garmin] Reply page returned ${pageResponse.getResponseCode()}`);
      return null;
    }

    const chunkPath = extractReplyChunkPath(pageResponse.getContentText());
    if (!chunkPath) {
      debug(`[Garmin] No reply route chunk in page HTML`);
      return null;
    }

    const chunkResponse = UrlFetchApp.fetch(GARMIN.MESSENGER_ORIGIN + chunkPath, {
      method: 'get',
      headers: { 'User-Agent': GARMIN.USER_AGENT, 'Accept': '*/*' },
      muteHttpExceptions: true,
      followRedirects: true
    });

    if (chunkResponse.getResponseCode() !== 200) return null;

    const actionId = extractSendReplyActionId(chunkResponse.getContentText());
    if (actionId) debug(`[Garmin] Discovered sendReplyAction id ${actionId}`);
    return actionId;
  } catch (e) {
    console.error(`[Garmin] Action id discovery failed: ${e}`);
    return null;
  }
}

/**
 * Did the server action accept the reply?
 *
 * Next.js answers a server action with a 200 flight stream, or a 303 when the
 * action redirects. An action that threw comes back as 200 carrying an error
 * digest, so the body has to be inspected rather than the status alone.
 *
 * @param {number} code
 * @param {string} body
 * @returns {boolean}
 */
function isActionSuccess(code, body) {
  if (code === 303) return true;
  if (code !== 200) return false;
  if (!body) return true;
  return !/"digest"\s*:\s*"|__NEXT_REDIRECT_ERROR|Internal Server Error/.test(body);
}

// =============================================================================
// ===========================  LEGACY FORM SCRAPING  ==========================
// =============================================================================

/**
 * Remove an `adr` query parameter, leaving a well-formed URL.
 *
 * @param {string} url
 * @returns {string}
 */
function stripAdrParam(url) {
  if (!url) return url;

  const queryStart = url.indexOf('?');
  if (queryStart === -1) return url;

  const base = url.substring(0, queryStart);
  const params = url.substring(queryStart + 1).split('&').filter(function(part) {
    return part && part.toLowerCase().indexOf('adr=') !== 0;
  });

  return params.length ? base + '?' + params.join('&') : base;
}

/**
 * Extract the hidden form values (Guid, MessageId, ReplyAddress) from a legacy
 * explore.garmin.com reply page.
 *
 * @param {string} pageUrl
 * @returns {{guid: string, messageId: string, replyAddress: (string|null)}|null}
 */
function extractGarminFormValues(pageUrl) {
  try {
    debug(`[Garmin] Fetching reply page for form values...`);

    const response = UrlFetchApp.fetch(pageUrl, {
      method: 'get',
      headers: {
        'User-Agent': GARMIN.USER_AGENT,
        'Accept': 'text/html,application/xhtml+xml'
      },
      muteHttpExceptions: true,
      followRedirects: true
    });

    const statusCode = response.getResponseCode();
    if (statusCode !== 200) {
      console.error(`[Garmin] Page fetch failed with status ${statusCode}`);
      return null;
    }

    const html = response.getContentText();
    debug(`[Garmin] Page fetched, ${html.length} chars`);

    const guid = matchHiddenField(html, 'Guid');
    const messageId = matchHiddenField(html, 'MessageId');
    const replyAddress = matchHiddenField(html, 'ReplyAddress');

    if (!guid) {
      console.error(`[Garmin] Could not extract Guid from page`);
      return null;
    }

    if (!messageId) {
      console.error(`[Garmin] Could not extract MessageId from page`);
      return null;
    }

    return { guid: guid, messageId: messageId, replyAddress: replyAddress };
  } catch (e) {
    console.error(`[Garmin] Exception fetching page: ${e}`);
    return null;
  }
}

/**
 * Read a hidden input's value, tolerating attribute order.
 * @private
 */
function matchHiddenField(html, fieldName) {
  const patterns = [
    new RegExp('name="' + fieldName + '"[^>]*value="([^"]*)"', 'i'),
    new RegExp('id="' + fieldName + '"[^>]*value="([^"]*)"', 'i'),
    new RegExp('value="([^"]*)"[^>]*name="' + fieldName + '"', 'i'),
    new RegExp('value="([^"]*)"[^>]*id="' + fieldName + '"', 'i')
  ];

  for (let i = 0; i < patterns.length; i++) {
    const match = html.match(patterns[i]);
    if (match && match[1]) return match[1];
  }

  return null;
}
