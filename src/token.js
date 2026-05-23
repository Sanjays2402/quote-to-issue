// Quote to Issue — encrypted Personal Access Token storage.
//
// Tokens are encrypted with AES-GCM (256-bit) using a per-install random key.
// Both the key and the ciphertext envelope live in chrome.storage.local.
//
// Caveat: chrome.storage.local is not a hardware-backed secret store. Anyone with
// access to the unpacked profile directory can read the key alongside the
// ciphertext. This module adds at-rest obfuscation and a clean clear-on-revoke
// path; it is NOT a substitute for a secure enclave. Treat the PAT scope as
// minimal (repo issues only) and rotate on suspicion.

const STORAGE_KEYS = Object.freeze({
  key: "qti.tokenKey",
  envelope: "qti.tokenEnvelope",
  rotations: "qti.tokenRotations",
});

const MAX_ROTATIONS = 8;

const subtle = () => globalThis.crypto?.subtle;

// ---------------------------------------------------------------------------
// Base64 helpers (work in DOM + Node — both define atob/btoa).
// ---------------------------------------------------------------------------

function b64encode(buf) {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}

function b64decode(s) {
  const bin = atob(String(s || ""));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// ---------------------------------------------------------------------------
// Pure validators
// ---------------------------------------------------------------------------

/**
 * Light syntactic check for GitHub PATs. Catches typos / wrong-paste rather
 * than enforcing the exact server-side rules.
 */
function looksLikeGithubToken(input) {
  const v = String(input || "").trim();
  if (v.length < 20 || v.length > 255) return false;
  if (/\s/.test(v)) return false;
  if (/^gh[pousr]_[A-Za-z0-9]{16,}$/.test(v)) return true;            // fine-grained / OAuth / app
  if (/^github_pat_[A-Za-z0-9_]{20,}$/.test(v)) return true;          // fine-grained user PAT
  if (/^[A-Fa-f0-9]{40}$/.test(v)) return true;                       // classic 40-char hex
  return false;
}

/**
 * Render a token as redacted text — last 4 visible. For UI status only.
 */
function previewToken(input) {
  const v = String(input || "").trim();
  if (!v) return "";
  if (v.length <= 4) return "•".repeat(v.length);
  return "•".repeat(Math.max(4, v.length - 4)) + v.slice(-4);
}

// ---------------------------------------------------------------------------
// Storage-bound helpers — require chrome.storage.local + WebCrypto subtle.
// ---------------------------------------------------------------------------

async function getOrCreateKey() {
  if (!subtle()) throw new Error("WebCrypto subtle is unavailable");
  if (!globalThis.chrome?.storage?.local) throw new Error("chrome.storage.local unavailable");
  const out = await chrome.storage.local.get(STORAGE_KEYS.key);
  let raw = out[STORAGE_KEYS.key];
  if (typeof raw !== "string" || raw.length < 24) {
    const bytes = crypto.getRandomValues(new Uint8Array(32));
    raw = b64encode(bytes);
    await chrome.storage.local.set({ [STORAGE_KEYS.key]: raw });
  }
  return subtle().importKey(
    "raw",
    b64decode(raw),
    { name: "AES-GCM" },
    false,
    ["encrypt", "decrypt"],
  );
}

async function setToken(plain) {
  const t = String(plain || "").trim();
  if (!t) throw new Error("token is empty");
  const key = await getOrCreateKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await subtle().encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(t));
  const envelope = {
    v: 1,
    alg: "AES-GCM",
    iv: b64encode(iv),
    ct: b64encode(new Uint8Array(ct)),
    createdAt: new Date().toISOString(),
    tail: t.slice(-4),
  };
  await chrome.storage.local.set({ [STORAGE_KEYS.envelope]: envelope });
  return { ok: true, createdAt: envelope.createdAt };
}

async function getToken() {
  if (!globalThis.chrome?.storage?.local) return null;
  const out = await chrome.storage.local.get(STORAGE_KEYS.envelope);
  const env = out[STORAGE_KEYS.envelope];
  if (!env || !env.iv || !env.ct) return null;
  try {
    const key = await getOrCreateKey();
    const pt = await subtle().decrypt(
      { name: "AES-GCM", iv: b64decode(env.iv) },
      key,
      b64decode(env.ct),
    );
    return new TextDecoder().decode(pt);
  } catch {
    // Tampered envelope or rotated key — surface as "no token" so callers
    // prompt the user to re-enter instead of throwing into the void.
    return null;
  }
}

async function hasToken() {
  if (!globalThis.chrome?.storage?.local) return false;
  const out = await chrome.storage.local.get(STORAGE_KEYS.envelope);
  return Boolean(out[STORAGE_KEYS.envelope]?.ct);
}

async function getTokenInfo() {
  if (!globalThis.chrome?.storage?.local) return null;
  const out = await chrome.storage.local.get(STORAGE_KEYS.envelope);
  const env = out[STORAGE_KEYS.envelope];
  if (!env) return null;
  return {
    createdAt: env.createdAt || null,
    tail: env.tail || "",
    alg: env.alg || "AES-GCM",
  };
}

/**
 * Rotate the saved token: append the old token's tail to a redacted
 * rotation log, then swap in the new ciphertext envelope. If no prior
 * token exists this behaves like setToken().
 */
async function rotateToken(plain) {
  if (!globalThis.chrome?.storage?.local) throw new Error("chrome.storage.local unavailable");
  const t = String(plain || "").trim();
  if (!t) throw new Error("token is empty");
  if (!looksLikeGithubToken(t)) throw new Error("token does not look like a GitHub PAT");
  const prior = await getTokenInfo().catch(() => null);
  const current = await getToken().catch(() => null);
  if (current && current === t) {
    throw new Error("new token matches the saved token");
  }
  const out = await chrome.storage.local.get(STORAGE_KEYS.rotations);
  const log = Array.isArray(out[STORAGE_KEYS.rotations]) ? out[STORAGE_KEYS.rotations].slice() : [];
  if (prior) {
    log.unshift({
      retiredAt: new Date().toISOString(),
      createdAt: prior.createdAt || null,
      tail: prior.tail || "",
      alg: prior.alg || "AES-GCM",
    });
  }
  while (log.length > MAX_ROTATIONS) log.pop();
  await chrome.storage.local.set({ [STORAGE_KEYS.rotations]: log });
  return setToken(t);
}

async function getRotationHistory() {
  if (!globalThis.chrome?.storage?.local) return [];
  const out = await chrome.storage.local.get(STORAGE_KEYS.rotations);
  const log = out[STORAGE_KEYS.rotations];
  return Array.isArray(log) ? log.slice(0, MAX_ROTATIONS) : [];
}

async function clearRotationHistory() {
  if (!globalThis.chrome?.storage?.local) return { ok: false };
  await chrome.storage.local.remove(STORAGE_KEYS.rotations);
  return { ok: true };
}

async function clearToken() {
  if (!globalThis.chrome?.storage?.local) return { ok: false };
  await chrome.storage.local.remove(STORAGE_KEYS.envelope);
  return { ok: true };
}

export {
  STORAGE_KEYS,
  MAX_ROTATIONS,
  looksLikeGithubToken,
  previewToken,
  setToken,
  getToken,
  hasToken,
  clearToken,
  getTokenInfo,
  rotateToken,
  getRotationHistory,
  clearRotationHistory,
};

if (typeof globalThis !== "undefined") {
  globalThis.__qtiToken = {
    STORAGE_KEYS,
    MAX_ROTATIONS,
    looksLikeGithubToken,
    previewToken,
    setToken,
    getToken,
    hasToken,
    clearToken,
    getTokenInfo,
    rotateToken,
    getRotationHistory,
    clearRotationHistory,
  };
}
