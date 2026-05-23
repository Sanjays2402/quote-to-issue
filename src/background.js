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
  bulkQuotes: "qti.bulkQuotes",
});

const CONTEXT_MENU_ID = "qti.fileAsIssue";
const CONTEXT_MENU_TITLE = "File as GitHub issue";
const CONTEXT_MENU_BULK_ID = "qti.addToBatch";
const CONTEXT_MENU_BULK_TITLE = "Add to issue batch";
const MAX_BULK_QUOTES = 20;

function __qtiQuoteFingerprint(q) {
  const sel = (q?.selectionText || "").replace(/\s+/g, " ").trim().slice(0, 200);
  const url = String(q?.pageUrl || "").trim();
  return `${url}::${sel}`;
}

// ---------------------------------------------------------------------------
// Markdown helpers (kept lean — duplicated from popup.js so the keyboard
// shortcut path can file an issue without ever instantiating the popup).
// ---------------------------------------------------------------------------

function __qtiHostnameOf(u) {
  try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return ""; }
}

const __QTI_ABBR = new Set([
  "mr", "mrs", "ms", "dr", "prof", "sr", "jr", "st", "mt",
  "vs", "etc", "eg", "ie", "approx", "inc", "ltd", "co", "corp",
  "e.g", "i.e", "u.s", "u.k", "e.u", "a.m", "p.m",
  "no", "vol", "fig", "figs", "ch", "sec", "pp",
]);

function __qtiFirstSentence(text) {
  const s = String(text || "").trim();
  if (!s) return "";
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch !== "." && ch !== "!" && ch !== "?") continue;
    const next = s[i + 1];
    const isBoundary = !next || /\s/.test(next);
    if (!isBoundary) continue;
    if (ch === "." && /\d/.test(s[i - 1] || "") && /\d/.test(next || "")) continue;
    if (ch === ".") {
      let j = i - 1;
      while (j >= 0 && /[A-Za-z.]/.test(s[j])) j--;
      const token = s.slice(j + 1, i).toLowerCase().replace(/\.$/, "");
      if (token && __QTI_ABBR.has(token)) continue;
      if (token.length === 1 && /[a-z]/.test(token) && /[A-Z]/.test(s[i - 1] || "")) continue;
    }
    return s.slice(0, i).trim();
  }
  return s;
}

function __qtiDeriveTitle(q) {
  const t = String(q?.selectionText || "").replace(/\s+/g, " ").trim();
  if (!t) return q?.pageTitle ? `Quote from: ${q.pageTitle}` : "";
  const max = 72;
  const sentence = __qtiFirstSentence(t) || t;
  if (sentence.length <= max) return `Quote: ${sentence}`;
  const head = sentence.slice(0, max - 1);
  const cut = head.replace(/\s+\S*$/, "") || head;
  return `Quote: ${cut}\u2026`;
}

function __qtiBuildSourceUrlAnchor(q) {
  const url = String(q?.pageUrl || "").trim();
  if (!url) return "";
  const text = String(q?.selectionText || "").replace(/\s+/g, " ").trim();
  if (!text) return url;
  if (url.includes("#")) return url;
  const enc = (s) => encodeURIComponent(s).replace(/-/g, "%2D").replace(/,/g, "%2C").replace(/&/g, "%26");
  const MAX = 300;
  if (text.length <= MAX) return `${url}#:~:text=${enc(text)}`;
  const words = text.split(" ").filter(Boolean);
  const startWords = words.slice(0, 6).join(" ");
  const endWords = words.slice(-6).join(" ");
  if (!startWords || !endWords || startWords === endWords) return `${url}#:~:text=${enc(text.slice(0, MAX))}`;
  return `${url}#:~:text=${enc(startWords)},${enc(endWords)}`;
}

function __qtiBuildMarkdownBody(q) {
  if (!q) return "";
  const lines = [];
  const quoted = String(q.selectionText || "").trim();
  if (quoted) {
    for (const ln of quoted.split(/\r?\n/)) lines.push("> " + ln);
    lines.push("");
  }
  const before = String(q.contextBefore || "").trim();
  const after = String(q.contextAfter || "").trim();
  if (before || after) {
    lines.push("**Context:** " + (before ? `\u2026${before} ` : "") + (quoted ? `**${quoted.slice(0, 200)}${quoted.length > 200 ? "\u2026" : ""}**` : "") + (after ? ` ${after}\u2026` : ""));
    lines.push("");
  }
  lines.push("---");
  if (q.pageTitle || q.pageUrl) {
    const title = q.pageTitle ? String(q.pageTitle).replace(/[\[\]]/g, "") : (__qtiHostnameOf(q.pageUrl) || q.pageUrl);
    const anchored = __qtiBuildSourceUrlAnchor(q) || q.pageUrl || "#";
    lines.push(`**Source:** [${title}](${anchored})`);
    if (anchored && anchored !== (q.pageUrl || "") && q.pageUrl) {
      lines.push(`<sub>Plain URL: <${q.pageUrl}></sub>`);
    }
  }
  if (q.nearestHeading) lines.push(`**Section:** ${q.nearestHeading}`);
  if (q.screenshot && q.screenshot.dataUrl) {
    const dim = (q.screenshot.width && q.screenshot.height) ? `${q.screenshot.width}\u00d7${q.screenshot.height}` : "PNG";
    lines.push(`**Screenshot:** captured (${dim}) \u2014 paste from clipboard or attach the downloaded PNG when filing.`);
  }
  if (q.capturedAt) lines.push(`**Captured:** ${q.capturedAt}`);
  return lines.join("\n").trim();
}

function __qtiRenderTemplate(tpl, q) {
  if (!tpl) return "";
  const quoted = String(q?.selectionText || "").trim();
  const quoteBlock = quoted ? quoted.split(/\r?\n/).map((ln) => "> " + ln).join("\n") : "";
  const repls = {
    quote: quoted,
    quote_blockquote: quoteBlock,
    source_title: String(q?.pageTitle || ""),
    source_url: String(q?.pageUrl || ""),
    source_url_anchor: __qtiBuildSourceUrlAnchor(q) || String(q?.pageUrl || ""),
    section: String(q?.nearestHeading || ""),
    captured_at: String(q?.capturedAt || ""),
    context_before: String(q?.contextBefore || ""),
    context_after: String(q?.contextAfter || ""),
  };
  return String(tpl).replace(/\{\{\s*([a-z_]+)\s*\}\}/g, (m, k) => Object.prototype.hasOwnProperty.call(repls, k) ? repls[k] : m);
}

// Briefly flash the action badge to acknowledge the shortcut result, then
// restore the previous batch-count badge (if any) so we don't clobber state.
async function __qtiFlashBadge(text, color, ms = 2400) {
  if (!chrome.action?.setBadgeText) return;
  let prevText = "";
  try { prevText = await chrome.action.getBadgeText({}); } catch { /* ignore */ }
  let prevColor = null;
  try { prevColor = await chrome.action.getBadgeBackgroundColor?.({}); } catch { /* ignore */ }
  try {
    await chrome.action.setBadgeText({ text });
    await chrome.action.setBadgeBackgroundColor?.({ color });
  } catch { /* ignore */ }
  setTimeout(async () => {
    try {
      await chrome.action.setBadgeText({ text: prevText || "" });
      if (prevColor) await chrome.action.setBadgeBackgroundColor?.({ color: prevColor });
    } catch { /* ignore */ }
  }, ms);
}

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

on("getBulkQuotes", async () => {
  const out = await chrome.storage.local.get(STORAGE_KEYS.bulkQuotes);
  const list = out[STORAGE_KEYS.bulkQuotes];
  return Array.isArray(list) ? list : [];
});

on("clearBulkQuotes", async () => {
  await chrome.storage.local.remove(STORAGE_KEYS.bulkQuotes);
  return { cleared: true };
});

on("removeBulkQuote", async (msg) => {
  const id = String(msg?.id || "");
  if (!id) return { removed: false };
  const out = await chrome.storage.local.get(STORAGE_KEYS.bulkQuotes);
  const list = Array.isArray(out[STORAGE_KEYS.bulkQuotes]) ? out[STORAGE_KEYS.bulkQuotes] : [];
  const next = list.filter((q) => String(q?.id || "") !== id);
  await chrome.storage.local.set({ [STORAGE_KEYS.bulkQuotes]: next });
  return { removed: next.length !== list.length, remaining: next.length };
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
      chrome.contextMenus.create({
        id: CONTEXT_MENU_BULK_ID,
        title: CONTEXT_MENU_BULK_TITLE,
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

async function captureVisibleTabScreenshot(windowId) {
  // chrome.tabs.captureVisibleTab — relies on the manifest `activeTab` /
  // `<all_urls>` permissions already declared. Returns a PNG data URL or null.
  if (!chrome.tabs?.captureVisibleTab) return null;
  try {
    const dataUrl = await new Promise((resolve, reject) => {
      try {
        chrome.tabs.captureVisibleTab(
          windowId == null ? undefined : windowId,
          { format: "png" },
          (result) => {
            const err = chrome.runtime?.lastError;
            if (err) reject(new Error(err.message || String(err)));
            else resolve(result || null);
          },
        );
      } catch (e) { reject(e); }
    });
    if (!dataUrl || typeof dataUrl !== "string") return null;
    // Probe dimensions in the service worker via createImageBitmap so the popup
    // can lay out a correctly-proportioned thumbnail without flicker.
    let width = 0, height = 0, bytes = 0;
    try {
      const idx = dataUrl.indexOf(",");
      if (idx > 0) {
        const b64 = dataUrl.slice(idx + 1);
        bytes = Math.floor((b64.length * 3) / 4);
      }
      const blob = await (await fetch(dataUrl)).blob();
      if (typeof createImageBitmap === "function") {
        const bmp = await createImageBitmap(blob);
        width = bmp.width; height = bmp.height;
        bmp.close?.();
      }
    } catch { /* dimensions optional */ }
    return { dataUrl, width, height, bytes, capturedAt: new Date().toISOString() };
  } catch (err) {
    console.warn(LOG_PREFIX, "captureVisibleTab failed", err);
    return null;
  }
}

chrome.contextMenus?.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== CONTEXT_MENU_ID && info.menuItemId !== CONTEXT_MENU_BULK_ID) return;
  // Fire selection capture and screenshot in parallel — both depend on the
  // tab still being focused, and captureVisibleTab will only work while the
  // popup hasn't yet stolen focus.
  const [enriched, screenshot] = await Promise.all([
    captureSelectionFromTab(tab?.id, info.frameId),
    captureVisibleTabScreenshot(tab?.windowId),
  ]);
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
    screenshot: screenshot || null,
    capturedAt: new Date().toISOString(),
  };
  try {
    if (info.menuItemId === CONTEXT_MENU_BULK_ID) {
      // Append to the batch queue. Dedupe by URL + selection fingerprint so
      // accidental double-click on the same passage doesn't bloat the list.
      const out = await chrome.storage.local.get(STORAGE_KEYS.bulkQuotes);
      const prev = Array.isArray(out[STORAGE_KEYS.bulkQuotes]) ? out[STORAGE_KEYS.bulkQuotes] : [];
      const fp = __qtiQuoteFingerprint(quote);
      const filtered = prev.filter((q) => __qtiQuoteFingerprint(q) !== fp);
      const id = (globalThis.crypto?.randomUUID && crypto.randomUUID()) || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
      const next = [{ id: `b_${id}`, ...quote }, ...filtered].slice(0, MAX_BULK_QUOTES);
      await chrome.storage.local.set({ [STORAGE_KEYS.bulkQuotes]: next });
      // Reflect queue size on the action badge so the user sees it without
      // needing to open the popup. Cleared once the batch is filed/emptied.
      try {
        if (chrome.action?.setBadgeText) {
          await chrome.action.setBadgeText({ text: String(next.length) });
          chrome.action.setBadgeBackgroundColor?.({ color: "#7C8CFF" });
        }
      } catch { /* badge optional */ }
    } else {
      await chrome.storage.local.set({ [STORAGE_KEYS.pendingQuote]: quote });
    }
  } catch (err) {
    console.warn(LOG_PREFIX, "storage.set quote failed", err);
  }
  if (info.menuItemId === CONTEXT_MENU_ID && chrome.action?.openPopup) {
    try { await chrome.action.openPopup(); } catch { /* requires user gesture in some contexts */ }
  }
});

// Keep the badge in sync if the popup mutates the batch.
chrome.storage?.onChanged?.addListener((changes, area) => {
  if (area !== "local" || !changes[STORAGE_KEYS.bulkQuotes]) return;
  const list = changes[STORAGE_KEYS.bulkQuotes].newValue;
  const count = Array.isArray(list) ? list.length : 0;
  try {
    if (chrome.action?.setBadgeText) {
      chrome.action.setBadgeText({ text: count > 0 ? String(count) : "" });
      if (count > 0) chrome.action.setBadgeBackgroundColor?.({ color: "#7C8CFF" });
    }
  } catch { /* badge optional */ }
});

chrome.runtime.onStartup?.addListener(() => {
  ensureContextMenu();
  console.log(LOG_PREFIX, "onStartup");
});

// ---------------------------------------------------------------------------
// Keyboard shortcut: file an issue directly, no popup.
//
// Resolution rules:
//   * Target repo = most-recent in qti.recentRepos (the popup writes here on
//     every successful submit). If none, we fall back to staging the quote
//     as the pending one and surface a ! badge so the user opens the popup.
//   * Body template = stored per-repo template (if any) rendered with the
//     standard placeholder set, otherwise the canonical buildMarkdownBody.
//   * Title = deriveTitle. Labels = none (per-repo default labels arrive in
//     a later roadmap item; the keyboard path stays minimal until then).
// ---------------------------------------------------------------------------

async function __qtiBuildQuoteFromActiveTab() {
  const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  const tab = tabs?.[0];
  if (!tab?.id) return { error: "no active tab" };
  const [enriched, screenshot] = await Promise.all([
    captureSelectionFromTab(tab.id),
    captureVisibleTabScreenshot(tab.windowId),
  ]);
  const selectionText = String(enriched?.selectionText || "").trim();
  if (!selectionText) return { error: "no selection — highlight text first" };
  return {
    quote: {
      selectionText,
      selectionHtml: enriched?.selectionHtml ?? "",
      contextBefore: enriched?.contextBefore ?? "",
      contextAfter: enriched?.contextAfter ?? "",
      nearestHeading: enriched?.nearestHeading ?? "",
      pageUrl: tab.url ?? "",
      pageTitle: tab.title ?? "",
      frameUrl: "",
      screenshot: screenshot || null,
      capturedAt: new Date().toISOString(),
    },
  };
}

async function __qtiResolveTargetRepo() {
  try {
    const out = await chrome.storage.local.get(["qti.recentRepos"]);
    const list = Array.isArray(out["qti.recentRepos"]) ? out["qti.recentRepos"] : [];
    for (const entry of list) {
      const v = String(entry?.value || "").trim();
      if (REPO_RE.test(v)) return v;
    }
  } catch { /* ignore */ }
  return "";
}

async function __qtiResolveRepoTemplate(repo) {
  try {
    const out = await chrome.storage.local.get(["qti.repoTemplates"]);
    const map = out["qti.repoTemplates"];
    if (!map || typeof map !== "object") return "";
    const tpl = map[repo.toLowerCase()] || map[repo];
    const body = typeof tpl?.body === "string" ? tpl.body.trim() : "";
    return body;
  } catch { /* ignore */ }
  return "";
}

async function __qtiBumpRecentRepo(repo) {
  try {
    const out = await chrome.storage.local.get(["qti.recentRepos"]);
    const prev = Array.isArray(out["qti.recentRepos"]) ? out["qti.recentRepos"] : [];
    const lower = repo.toLowerCase();
    const filtered = prev.filter((e) => String(e?.value || "").toLowerCase() !== lower);
    const next = [{ value: repo, lastUsed: new Date().toISOString() }, ...filtered].slice(0, 8);
    await chrome.storage.local.set({ "qti.recentRepos": next });
  } catch { /* ignore */ }
}

async function handleFileIssueShortcut() {
  const { quote, error } = await __qtiBuildQuoteFromActiveTab();
  if (error || !quote) {
    console.warn(LOG_PREFIX, "shortcut: capture failed", error);
    __qtiFlashBadge("!", "#E5484D");
    return;
  }
  const repo = await __qtiResolveTargetRepo();
  if (!repo) {
    // No saved repo yet — stage the quote so the popup picks it up and the
    // user can pick a repo. The popup is the one with the chooser UI.
    try { await chrome.storage.local.set({ [STORAGE_KEYS.pendingQuote]: quote }); } catch { /* ignore */ }
    __qtiFlashBadge("?", "#F5A623");
    try { await chrome.action?.openPopup?.(); } catch { /* requires gesture */ }
    return;
  }
  const title = __qtiDeriveTitle(quote);
  const tpl = await __qtiResolveRepoTemplate(repo);
  const body = tpl ? __qtiRenderTemplate(tpl, quote) : __qtiBuildMarkdownBody(quote);
  try {
    const handler = handlers.get("submitIssue");
    const result = await handler({ type: "submitIssue", repo, title, body, labels: [] });
    await __qtiBumpRecentRepo(repo);
    __qtiFlashBadge("\u2713", "#3DD68C");
    console.log(LOG_PREFIX, "shortcut filed #" + (result?.number ?? "?"), result?.htmlUrl);
  } catch (err) {
    console.warn(LOG_PREFIX, "shortcut submit failed", err);
    // Stash the quote so the popup can recover and let the user retry.
    try { await chrome.storage.local.set({ [STORAGE_KEYS.pendingQuote]: quote }); } catch { /* ignore */ }
    __qtiFlashBadge("!", "#E5484D");
  }
}

async function handleAddToBatchShortcut() {
  const { quote, error } = await __qtiBuildQuoteFromActiveTab();
  if (error || !quote) {
    __qtiFlashBadge("!", "#E5484D");
    return;
  }
  try {
    const out = await chrome.storage.local.get(STORAGE_KEYS.bulkQuotes);
    const prev = Array.isArray(out[STORAGE_KEYS.bulkQuotes]) ? out[STORAGE_KEYS.bulkQuotes] : [];
    const fp = __qtiQuoteFingerprint(quote);
    const filtered = prev.filter((q) => __qtiQuoteFingerprint(q) !== fp);
    const id = (globalThis.crypto?.randomUUID && crypto.randomUUID()) || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    const next = [{ id: `b_${id}`, ...quote }, ...filtered].slice(0, MAX_BULK_QUOTES);
    await chrome.storage.local.set({ [STORAGE_KEYS.bulkQuotes]: next });
  } catch (err) {
    console.warn(LOG_PREFIX, "shortcut batch failed", err);
    __qtiFlashBadge("!", "#E5484D");
  }
}

chrome.commands?.onCommand.addListener((command) => {
  if (command === "file-issue-now") {
    handleFileIssueShortcut().catch((err) => console.warn(LOG_PREFIX, "shortcut error", err));
  } else if (command === "add-to-batch") {
    handleAddToBatchShortcut().catch((err) => console.warn(LOG_PREFIX, "shortcut error", err));
  }
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
export const __test__ = { handlers, STORAGE_KEYS, CONTEXT_MENU_ID, CONTEXT_MENU_TITLE, CONTEXT_MENU_BULK_ID, CONTEXT_MENU_BULK_TITLE, MAX_BULK_QUOTES };
