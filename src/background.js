// Quote to Issue — MV3 service worker
//
// Responsibilities (scaffolding only — features land in subsequent roadmap items):
//   * Lifecycle: install/update bookkeeping in chrome.storage.local.
//   * Message router: dispatch typed messages from popup/content scripts.
//   * Action click: opens the popup (declared in manifest.action).
//
// Keep this file side-effect free at module top-level beyond listener
// registration — MV3 service workers can be terminated and resurrected
// at any time. All state must live in chrome.storage.

const LOG_PREFIX = "[quote-to-issue]";
const STORAGE_KEYS = Object.freeze({
  installedAt: "qti.installedAt",
  lastVersion: "qti.lastVersion",
  pendingQuote: "qti.pendingQuote",
});

const CONTEXT_MENU_ID = "qti.fileAsIssue";
const CONTEXT_MENU_TITLE = "File as GitHub issue";

/** @typedef {{ type: string, [key: string]: unknown }} Msg */

const handlers = new Map();

/**
 * Register a typed message handler.
 * @param {string} type
 * @param {(msg: Msg, sender: chrome.runtime.MessageSender) => Promise<unknown> | unknown} fn
 */
function on(type, fn) {
  handlers.set(type, fn);
}

on("ping", () => ({ ok: true, ts: Date.now() }));

on("getVersion", () => ({
  version: chrome.runtime.getManifest().version,
}));

on("getPendingQuote", async () => {
  const out = await chrome.storage.local.get(STORAGE_KEYS.pendingQuote);
  return out[STORAGE_KEYS.pendingQuote] ?? null;
});

on("clearPendingQuote", async () => {
  await chrome.storage.local.remove(STORAGE_KEYS.pendingQuote);
  return { cleared: true };
});

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

chrome.runtime.onInstalled.addListener(async (details) => {
  const manifest = chrome.runtime.getManifest();
  const now = new Date().toISOString();
  const patch = { [STORAGE_KEYS.lastVersion]: manifest.version };
  if (details.reason === "install") {
    patch[STORAGE_KEYS.installedAt] = now;
  }
  try {
    await chrome.storage.local.set(patch);
  } catch (err) {
    console.warn(LOG_PREFIX, "storage.set failed", err);
  }
  ensureContextMenu();
  console.log(LOG_PREFIX, "onInstalled", details.reason, manifest.version);
});

// ---------------------------------------------------------------------------
// Context menu — "File as GitHub issue" on selection
// ---------------------------------------------------------------------------

function ensureContextMenu() {
  if (!chrome.contextMenus?.create) return;
  try {
    chrome.contextMenus.removeAll(() => {
      chrome.contextMenus.create({
        id: CONTEXT_MENU_ID,
        title: CONTEXT_MENU_TITLE,
        contexts: ["selection"],
      });
    });
  } catch (err) {
    console.warn(LOG_PREFIX, "contextMenus.create failed", err);
  }
}

chrome.contextMenus?.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== CONTEXT_MENU_ID) return;
  const quote = {
    selectionText: info.selectionText ?? "",
    pageUrl: info.pageUrl ?? tab?.url ?? "",
    pageTitle: tab?.title ?? "",
    frameUrl: info.frameUrl ?? "",
    capturedAt: new Date().toISOString(),
  };
  try {
    await chrome.storage.local.set({ [STORAGE_KEYS.pendingQuote]: quote });
  } catch (err) {
    console.warn(LOG_PREFIX, "storage.set pendingQuote failed", err);
  }
  if (chrome.action?.openPopup) {
    try { await chrome.action.openPopup(); } catch { /* requires user gesture in some contexts */ }
  }
});

chrome.runtime.onStartup?.addListener(() => {
  ensureContextMenu();
  console.log(LOG_PREFIX, "onStartup");
});

// ---------------------------------------------------------------------------
// Message router
// ---------------------------------------------------------------------------

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || typeof msg.type !== "string") {
    sendResponse({ ok: false, error: "invalid message" });
    return false;
  }
  const fn = handlers.get(msg.type);
  if (!fn) {
    sendResponse({ ok: false, error: `unknown type: ${msg.type}` });
    return false;
  }
  Promise.resolve()
    .then(() => fn(msg, sender))
    .then((result) => sendResponse({ ok: true, result }))
    .catch((err) => sendResponse({ ok: false, error: String(err?.message ?? err) }));
  return true; // keep the message channel open for async response
});

console.log(LOG_PREFIX, "service worker booted");

// Exported for unit-style smoke checks (not used by the SW runtime).
export const __test__ = { handlers, STORAGE_KEYS, CONTEXT_MENU_ID, CONTEXT_MENU_TITLE };
