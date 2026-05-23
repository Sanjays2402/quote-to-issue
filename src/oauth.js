// Quote to Issue — GitHub OAuth device-flow login.
//
// Alternative to a Personal Access Token: the user enters a one-time user_code
// on github.com/login/device, this background poll exchanges that for an
// access token, and we hand the token off to token.js (same encrypted-at-rest
// storage path the PAT uses). The rest of the extension treats device-flow
// tokens identically to PATs.
//
// Notes:
//  * Device flow requires a GitHub OAuth App with "Device flow" enabled. The
//    client_id is public (no secret) and is supplied by the user in Settings.
//  * No client_secret is ever stored or transmitted from the extension.
//  * fetch / sleep are injectable so the smoke test can drive the loop
//    without hitting the real GitHub endpoints.

const DEVICE_CODE_URL = "https://github.com/login/device/code";
const TOKEN_URL = "https://github.com/login/oauth/access_token";
const DEFAULT_SCOPE = "repo";
const MAX_FLOW_SECONDS = 900; // 15 min — GitHub default expiry.

// ---------------------------------------------------------------------------
// Pure validators / parsers
// ---------------------------------------------------------------------------

/**
 * GitHub OAuth App client IDs are public identifiers. Historic format starts
 * with `Iv1.` (16 hex chars), new apps use `Ov23li...` / `Iv23li...`. We keep
 * the check generous — letters, digits, dot/underscore/hyphen — and reject
 * obvious junk (whitespace, too short, too long).
 */
function validateClientId(input) {
  const v = String(input || "").trim();
  if (v.length < 8 || v.length > 80) return false;
  if (/\s/.test(v)) return false;
  if (!/^[A-Za-z0-9._-]+$/.test(v)) return false;
  return true;
}

/**
 * Normalize the JSON returned from /login/device/code. Throws on any
 * malformed/error response so the caller can surface a single failure path.
 */
function parseDeviceCodeResponse(json) {
  if (!json || typeof json !== "object") throw new Error("invalid device-code response");
  if (json.error) throw new Error(String(json.error_description || json.error));
  const { device_code, user_code, verification_uri, expires_in, interval } = json;
  if (!device_code || !user_code || !verification_uri) {
    throw new Error("device-code response missing fields");
  }
  return {
    deviceCode: String(device_code),
    userCode: String(user_code),
    verificationUri: String(verification_uri),
    verificationUriComplete: json.verification_uri_complete
      ? String(json.verification_uri_complete)
      : "",
    expiresIn: Math.max(60, Number(expires_in) || 900),
    interval: Math.max(1, Number(interval) || 5),
  };
}

/**
 * Normalize the JSON returned from /login/oauth/access_token while polling.
 * Returns a tagged union the runner can react to:
 *   { state: "ok", token, scope, tokenType }
 *   { state: "pending" }
 *   { state: "slow_down", interval }
 *   { state: "expired" }
 *   { state: "denied" }
 *   { state: "error", error }
 */
function parseTokenResponse(json) {
  if (!json || typeof json !== "object") return { state: "error", error: "invalid response" };
  if (json.access_token) {
    return {
      state: "ok",
      token: String(json.access_token),
      scope: json.scope ? String(json.scope) : "",
      tokenType: json.token_type ? String(json.token_type) : "bearer",
    };
  }
  switch (json.error) {
    case "authorization_pending": return { state: "pending" };
    case "slow_down":             return { state: "slow_down", interval: Number(json.interval) || 0 };
    case "expired_token":         return { state: "expired" };
    case "access_denied":         return { state: "denied" };
    default: {
      const msg = json.error_description || json.error || "no token in response";
      return { state: "error", error: String(msg) };
    }
  }
}

// ---------------------------------------------------------------------------
// Network helpers (injectable fetch)
// ---------------------------------------------------------------------------

async function requestDeviceCode({ clientId, scope = DEFAULT_SCOPE, fetchImpl } = {}) {
  if (!validateClientId(clientId)) throw new Error("invalid client id");
  const f = fetchImpl || globalThis.fetch;
  if (typeof f !== "function") throw new Error("fetch unavailable");
  const res = await f(DEVICE_CODE_URL, {
    method: "POST",
    headers: { "Accept": "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({ client_id: clientId, scope }),
  });
  if (!res || !res.ok) {
    throw new Error(`device-code HTTP ${res?.status ?? "?"}`);
  }
  const json = await res.json();
  return parseDeviceCodeResponse(json);
}

async function pollDeviceToken({ clientId, deviceCode, fetchImpl } = {}) {
  if (!validateClientId(clientId)) throw new Error("invalid client id");
  if (!deviceCode) throw new Error("device code missing");
  const f = fetchImpl || globalThis.fetch;
  if (typeof f !== "function") throw new Error("fetch unavailable");
  const res = await f(TOKEN_URL, {
    method: "POST",
    headers: { "Accept": "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: clientId,
      device_code: deviceCode,
      grant_type: "urn:ietf:params:oauth:grant-type:device_code",
    }),
  });
  // GitHub returns 200 with `error` field for in-progress polls — don't fail
  // on non-2xx without first trying to read the JSON envelope.
  let json = null;
  try { json = await res.json(); } catch {}
  return parseTokenResponse(json);
}

/**
 * Drive the device-flow end-to-end. `onCode` fires once we know the user_code
 * + verification URL so the UI can render them. Resolves with the access
 * token; rejects on denial / expiry / abort / network failure.
 */
async function runDeviceFlow({
  clientId,
  scope = DEFAULT_SCOPE,
  onCode,
  fetchImpl,
  sleepImpl,
  signal,
  maxSeconds = MAX_FLOW_SECONDS,
} = {}) {
  if (!validateClientId(clientId)) throw new Error("invalid client id");
  const sleep = sleepImpl || ((ms) => new Promise((r) => setTimeout(r, ms)));
  const aborted = () => Boolean(signal?.aborted);
  if (aborted()) throw new Error("device flow aborted");

  const code = await requestDeviceCode({ clientId, scope, fetchImpl });
  if (typeof onCode === "function") {
    try { await onCode(code); } catch {}
  }

  const started = Date.now();
  const deadline = started + Math.min(maxSeconds, code.expiresIn) * 1000;
  let interval = code.interval;

  // Defensive cap on iterations in case a buggy sleepImpl returns instantly.
  for (let i = 0; i < 1000; i++) {
    if (aborted()) throw new Error("device flow aborted");
    if (Date.now() > deadline) throw new Error("device flow timed out");
    await sleep(interval * 1000);
    if (aborted()) throw new Error("device flow aborted");

    const result = await pollDeviceToken({
      clientId,
      deviceCode: code.deviceCode,
      fetchImpl,
    });
    if (result.state === "ok") {
      return { token: result.token, scope: result.scope, userCode: code.userCode };
    }
    if (result.state === "pending") continue;
    if (result.state === "slow_down") {
      interval = Math.max(interval + 5, Number(result.interval) || interval + 5);
      continue;
    }
    if (result.state === "expired") throw new Error("device code expired before approval");
    if (result.state === "denied")  throw new Error("access denied by user");
    throw new Error(result.error || "device flow failed");
  }
  throw new Error("device flow exceeded iteration cap");
}

export {
  DEVICE_CODE_URL,
  TOKEN_URL,
  DEFAULT_SCOPE,
  MAX_FLOW_SECONDS,
  validateClientId,
  parseDeviceCodeResponse,
  parseTokenResponse,
  requestDeviceCode,
  pollDeviceToken,
  runDeviceFlow,
};

if (typeof globalThis !== "undefined") {
  globalThis.__qtiOauth = {
    DEVICE_CODE_URL,
    TOKEN_URL,
    DEFAULT_SCOPE,
    MAX_FLOW_SECONDS,
    validateClientId,
    parseDeviceCodeResponse,
    parseTokenResponse,
    requestDeviceCode,
    pollDeviceToken,
    runDeviceFlow,
  };
}
