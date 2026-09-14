/**
 * Health reporting: alerting, degradation tracking and the Garmin canary.
 *
 * The gateway has been dark twice, both times for the same reason: a scraped
 * Garmin surface changed shape, every layer kept returning "fine", and the
 * reply was dropped at the last step. The second time is the instructive one -
 * runtime discovery of the server action had been failing on EVERY call for
 * weeks, and nobody knew, because a pinned fallback quietly covered for it
 * until Garmin rotated the hash and the cover came off.
 *
 * So the rule this file exists to enforce: a fallback that nobody observes is
 * a time bomb with the timer hidden. Every substitution is counted, and the
 * first one in a window is reported - by email, which is the only channel that
 * does not depend on the thing that breaks.
 */

// =============================================================================
// ==============================  ALERTING  ===================================
// =============================================================================

/**
 * Where alerts go: SYSTEM.ALERT_EMAIL if set, otherwise the ALERT_EMAIL script
 * property, which keeps a personal address out of a public repository.
 *
 * There is deliberately NO "just use the script owner" fallback, convenient as
 * that would be. Session.getEffectiveUser() pulls the userinfo.email scope into
 * a project that needs three scopes without it, and a changed scope set can
 * make Apps Script demand re-authorisation before it will create a trigger or
 * keep running the existing ones.
 *
 * Honest about the evidence: when this fallback existed, the canary trigger
 * could not be saved - the dialog's Save silently no-opped six times, and
 * worked on the first attempt after the call was removed. That is suggestive,
 * not proof; the Overview scope panel shows the GRANTED set rather than what
 * the code needs, so it still lists four and the mechanism was never confirmed.
 * The removal stands on its own merits either way: a project should not ask
 * for a scope it does not use, least of all one whose entire failure history
 * is silent breakage, to save a line of configuration.
 *
 * @returns {string|null}
 */
function resolveAlertEmail() {
  if (SYSTEM.ALERT_EMAIL && SYSTEM.ALERT_EMAIL.length > 0) return SYSTEM.ALERT_EMAIL;

  try {
    const configured = PropertiesService.getScriptProperties().getProperty('ALERT_EMAIL');
    if (configured && configured.length > 0) return configured;
  } catch (e) {
    console.error(`[Health] Could not read the ALERT_EMAIL property: ${e}`);
  }

  return null;
}

/**
 * Send one alert. Never throws - alerting must not be able to break the run
 * it is reporting on.
 *
 * @param {string} subject
 * @param {string} body
 * @returns {boolean} whether it was sent
 */
function sendAlert(subject, body) {
  const to = resolveAlertEmail();

  if (!to) {
    console.error(`[Health] ALERT (undeliverable, no address): ${subject}`);
    return false;
  }

  try {
    MailApp.sendEmail({ to: to, subject: `[SAT-COM] ${subject}`, body: body });
    console.log(`[Health] Alert sent: ${subject}`);
    return true;
  } catch (e) {
    console.error(`[Health] Alert failed to send: ${e}`);
    return false;
  }
}

// =============================================================================
// =========================  DEGRADATION TRACKING  ============================
// =============================================================================

/** @private */
function degradationKey(kind) {
  return 'HEALTH_' + kind;
}

/**
 * Current state for one degradation kind, or null if healthy.
 *
 * @param {string} kind
 * @returns {{count: number, first: number, last: number, alerted: number, detail: string}|null}
 */
function degradationState(kind) {
  const raw = PropertiesService.getScriptProperties().getProperty(degradationKey(kind));
  if (!raw) return null;

  try {
    return JSON.parse(raw);
  } catch (e) {
    PropertiesService.getScriptProperties().deleteProperty(degradationKey(kind));
    return null;
  }
}

/**
 * Note that something degraded, and alert on the first occurrence in a window.
 *
 * The count keeps climbing while the cooldown holds, so the next alert carries
 * the real total rather than looking like a one-off.
 *
 * @param {string} kind - stable identifier, e.g. "ACTION_ID_DISCOVERY"
 * @param {string} detail - one line of context for the alert body
 * @returns {number} occurrences recorded so far
 */
function recordDegradation(kind, detail) {
  const now = Date.now();
  const previous = degradationState(kind);

  const state = {
    count: (previous ? previous.count : 0) + 1,
    first: previous ? previous.first : now,
    last: now,
    alerted: previous ? previous.alerted : 0,
    detail: detail || ''
  };

  console.error(`[Health] DEGRADED ${kind} (x${state.count}): ${state.detail}`);

  if (now - state.alerted > HEALTH.ALERT_COOLDOWN_MS) {
    const sinceFirst = Math.round((now - state.first) / 60000);
    const sent = sendAlert(`Degraded: ${kind}`, [
      `The gateway is still running, but a component has been falling back.`,
      ``,
      `Kind:        ${kind}`,
      `Detail:      ${state.detail}`,
      `Occurrences: ${state.count}`,
      `First seen:  ${new Date(state.first).toISOString()} (${sinceFirst} min ago)`,
      `Last seen:   ${new Date(state.last).toISOString()}`,
      ``,
      `This is a leading indicator, not an outage: a fallback is still holding.`,
      `The previous outage looked exactly like this for weeks before replies`,
      `stopped arriving.`
    ].join('\n'));

    if (sent) state.alerted = now;
  }

  PropertiesService.getScriptProperties().setProperty(degradationKey(kind), JSON.stringify(state));
  return state.count;
}

/**
 * Note that something is working again. Reports recovery only if the problem
 * was ever alerted on, so healthy runs stay silent.
 *
 * @param {string} kind
 */
function clearDegradation(kind) {
  const previous = degradationState(kind);
  if (!previous) return;

  PropertiesService.getScriptProperties().deleteProperty(degradationKey(kind));
  console.log(`[Health] RECOVERED ${kind} after ${previous.count} occurrence(s)`);

  if (previous.alerted > 0) {
    sendAlert(`Recovered: ${kind}`, [
      `${kind} is working again after ${previous.count} occurrence(s).`,
      ``,
      `First seen: ${new Date(previous.first).toISOString()}`,
      `Last seen:  ${new Date(previous.last).toISOString()}`,
      `Recovered:  ${new Date().toISOString()}`
    ].join('\n'));
  }
}

// =============================================================================
// ==========================  REPLY TOKEN MEMORY  =============================
// =============================================================================

const LAST_REPLY_TOKEN_KEY = 'LAST_REPLY_TOKEN';

/**
 * Remember a reply id so the canary has something real to probe against.
 * Probing needs a live reply page; Garmin serves a 404 shell for anything else.
 *
 * @param {string|null} tinyUrlId
 */
function rememberReplyToken(tinyUrlId) {
  if (!tinyUrlId) return;

  PropertiesService.getScriptProperties().setProperty(
    LAST_REPLY_TOKEN_KEY,
    JSON.stringify({ token: tinyUrlId, timestamp: Date.now() })
  );
}

/**
 * The most recent reply id, with its age.
 *
 * @returns {{token: string, timestamp: number, ageMs: number, stale: boolean}|null}
 */
function lastReplyToken() {
  const raw = PropertiesService.getScriptProperties().getProperty(LAST_REPLY_TOKEN_KEY);
  if (!raw) return null;

  try {
    const state = JSON.parse(raw);
    if (!state.token) return null;

    const ageMs = Date.now() - (state.timestamp || 0);
    return {
      token: state.token,
      timestamp: state.timestamp || 0,
      ageMs: ageMs,
      stale: ageMs > HEALTH.TOKEN_TTL_MS
    };
  } catch (e) {
    return null;
  }
}

// =============================================================================
// ==============================  THE CANARY  =================================
// =============================================================================

/**
 * Check that Garmin reply delivery still works, without delivering anything.
 *
 * Intended for its own hourly time-driven trigger. It calls the real server
 * action with a tinyUrlId no conversation can have, so the action is genuinely
 * exercised and no satellite message is produced. See probeGarminDelivery for
 * how the three states are told apart.
 *
 * @returns {{status: string, detail: string}}
 */
function runGarminCanary() {
  const known = lastReplyToken();

  if (!known) {
    console.log(`[Canary] No reply id seen yet, nothing to probe`);
    return { status: 'SKIPPED', detail: 'no reply id recorded yet' };
  }

  const result = probeGarminDelivery(known.token);
  const age = `reply id ${Math.round(known.ageMs / 3600000)}h old`;

  if (result.status === 'HEALTHY') {
    console.log(`[Canary] Garmin delivery healthy (${result.detail})`);
    clearDegradation('GARMIN_DELIVERY');
    clearDegradation('ACTION_ID_DISCOVERY');
    return result;
  }

  if (result.status === 'INCONCLUSIVE') {
    // Garmin unreachable or the stored id has expired. Neither proves a break,
    // and alerting on it would train the alert to be ignored.
    console.log(`[Canary] Inconclusive: ${result.detail} (${age})`);
    return result;
  }

  // An expired reply id looks exactly like a break: Garmin serves a 404 shell,
  // discovery finds no route chunk, and the action refuses the call. Alerting
  // on that would be crying wolf at whatever cadence the device goes quiet.
  if (!result.discovered && known.stale) {
    console.log(`[Canary] Inconclusive: ${result.detail}, but the ${age} may simply have expired`);
    return { status: 'INCONCLUSIVE', detail: `${result.detail} (stale probe id, ${age})` };
  }

  if (result.status === 'DEGRADED') {
    recordDegradation('ACTION_ID_DISCOVERY', `${result.detail} (${age})`);
    return result;
  }

  recordDegradation('GARMIN_DELIVERY', `${result.detail} (${age})`);
  return result;
}

// The canary needs its own hourly time-driven trigger, added by hand under
// Triggers in the Apps Script editor: runGarminCanary, Time-driven, Hour timer,
// every hour. It is deliberately NOT installed from code - ScriptApp would be
// this project's only use of that API, and the scope it pulls in would make
// every existing trigger stop with "Authorization is required" until the owner
// re-authorised by hand. Taking the gateway down to install its own watchdog
// would be a poor trade.
