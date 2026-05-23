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

/**
 * Runs in the page context. Pulls the exact selection plus a small amount of
 * surrounding text so the issue body has useful context, not just the snippet.
 * Returns a JSON-safe object — no DOM references leak across the boundary.
 */
function __qtiCaptureSelection() {
  try {
    const sel = window.getSelection && window.getSelection();
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed) {
      return { selectionText: "", selectionHtml: "", contextBefore: "", contextAfter: "", nearestHeading: "" };
    }
    const range = sel.getRangeAt(0);
    const selectionText = sel.toString();
    // Serialize the selection to HTML (kept short — popup will sanitize/escape).
    let selectionHtml = "";
    try {
      const frag = range.cloneContents();
      const div = document.createElement("div");
      div.appendChild(frag);
      selectionHtml = div.innerHTML.slice(0, 4000);
    } catch { /* ignore */ }
    // Walk up to a block-ish ancestor for the surrounding paragraph.
    let node = range.commonAncestorContainer;
    if (node.nodeType !== 1) node = node.parentNode;
    const BLOCK = /^(P|DIV|LI|BLOCKQUOTE|ARTICLE|SECTION|TD|PRE|FIGCAPTION|DD|DT)$/;
    let block = node;
    while (block && block !== document.body && !(block.tagName && BLOCK.test(block.tagName))) {
      block = block.parentNode;
    }
    let contextBefore = "", contextAfter = "";
    if (block && block.textContent) {
      const full = block.textContent.replace(/\s+/g, " ").trim();
      const idx = full.indexOf(selectionText.replace(/\s+/g, " ").trim());
      if (idx >= 0) {
        contextBefore = full.slice(Math.max(0, idx - 240), idx).trim();
        contextAfter = full.slice(idx + selectionText.length, idx + selectionText.length + 240).trim();
      }
    }
    // Find nearest preceding heading for section anchor.
    let nearestHeading = "";
    let cur = (node.nodeType === 1) ? node : node.parentNode;
    while (cur && cur !== document.body) {
      let sib = cur.previousElementSibling;
      while (sib) {
        if (/^H[1-6]$/.test(sib.tagName)) { nearestHeading = (sib.textContent || "").trim(); break; }
        sib = sib.previousElementSibling;
      }
      if (nearestHeading) break;
      cur = cur.parentNode;
    }
    return { selectionText, selectionHtml, contextBefore, contextAfter, nearestHeading };
  } catch (err) {
    return { selectionText: "", selectionHtml: "", contextBefore: "", contextAfter: "", nearestHeading: "", error: String(err && err.message || err) };
  }
}

async function captureSelectionFromTab(tabId, frameId) {
  if (!chrome.scripting?.executeScript || tabId == null) return null;
  try {
    const results = await chrome.scripting.executeScript({
      target: frameId != null ? { tabId, frameIds: [frameId] } : { tabId },
      func: __qtiCaptureSelection,
    });
    return results?.[0]?.result ?? null;
  } catch (err) {
    console.warn(LOG_PREFIX, "executeScript failed", err);
    return null;
  }
}

chrome.contextMenus?.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== CONTEXT_MENU_ID) return;
  const enriched = await captureSelectionFromTab(tab?.id, info.frameId);
  const selectionText = (enriched?.selectionText || info.selectionText || "").trim();
  const quote = {
    selectionText,
    selectionHtml: enriched?.selectionHtml ?? "",
    contextBefore: enriched?.contextBefore ?? "",
    contextAfter: enriched?.contextAfter ?? "",
    nearestHeading: enriched?.nearestHeading ?? "",
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
