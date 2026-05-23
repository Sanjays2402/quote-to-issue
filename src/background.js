// Quote to Issue — MV3 service worker
//
// Responsibilities:
//   * Lifecycle: install/update bookkeeping in chrome.storage.local.
//   * Context menu: "File as GitHub issue" on selection.
//   * GitHub Issues API submission (uses the stored encrypted PAT).
//   * Message router: dispatch typed messages from popup/content scripts.
//
// Keep this file side-effect free at module top-level beyond listener
// registration — MV3 service workers can be terminated and resurrected
// at any time. All state must live in chrome.storage.

import { getToken } from "./token.js";

const LOG_PREFIX = "[quote-to-issue]";
const GITHUB_API = "https://api.github.com";
const REPO_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}\/[A-Za-z0-9._-]{1,100}$/;
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

// submitIssue — POST a GitHub issue using the stored PAT.
// payload: { repo: "owner/name", title, body, labels?: string[] }
on("submitIssue", async (msg) => {
  const repo = String(msg?.repo || "").trim();
  const title = String(msg?.title || "").trim();
  const body = String(msg?.body || "");
  const labels = Array.isArray(msg?.labels)
    ? msg.labels.map((s) => String(s).trim()).filter(Boolean).slice(0, 24)
    : [];
  if (!REPO_RE.test(repo)) throw new Error("Invalid repo (use owner/name)");
  if (!title) throw new Error("Issue title is required");
  const token = await getToken();
  if (!token) throw new Error("No GitHub token saved — open settings to add one.");
  const res = await fetch(`${GITHUB_API}/repos/${repo}/issues`, {
    method: "POST",
    headers: {
      "Accept": "application/vnd.github+json",
      "Authorization": `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ title, body, labels }),
  });
  let data = null;
  try { data = await res.json(); } catch { /* may be empty */ }
  if (!res.ok) {
    const msgs = [];
    if (data?.message) msgs.push(data.message);
    if (Array.isArray(data?.errors)) {
      for (const e of data.errors) {
        if (e?.message) msgs.push(e.message);
        else if (e?.field && e?.code) msgs.push(`${e.field}: ${e.code}`);
      }
    }
    const detail = msgs.length ? msgs.join(" — ") : `${res.status} ${res.statusText}`;
    const err = new Error(`GitHub: ${detail}`);
    err.status = res.status;
    throw err;
  }
  return {
    number: data?.number ?? null,
    htmlUrl: data?.html_url ?? null,
    nodeId: data?.node_id ?? null,
    repo,
  };
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
