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
  captureSettings: "qti.captureSettings",
  offlineQueue: "qti.offlineQueue",
});

const MAX_OFFLINE_QUEUE = 25;
const MAX_QUEUE_ATTEMPTS = 8;
const OFFLINE_ALARM = "qti.offlineRetry";
const OFFLINE_ALARM_MIN = 5;

const CONTEXT_MENU_ID = "qti.fileAsIssue";
const CONTEXT_MENU_TITLE = "File as GitHub issue";
const CONTEXT_MENU_BULK_ID = "qti.addToBatch";
const CONTEXT_MENU_BULK_TITLE = "Add to issue batch";
const MAX_BULK_QUOTES = 20;

// ---------------------------------------------------------------------------
// Privacy mode — scrub query params and auth tokens from captured URLs.
// Mirrors popup.js scrubUrlForPrivacy so the SW shortcut and context-menu
// paths produce the same redacted URL before anything is stored.
// ---------------------------------------------------------------------------
function __qtiScrubUrlForPrivacy(rawUrl) {
  const s = String(rawUrl || "").trim();
  if (!s) return "";
  let u;
  try { u = new URL(s); } catch { return ""; }
  if (u.protocol !== "http:" && u.protocol !== "https:") return "";
  u.username = "";
  u.password = "";
  u.search = "";
  u.hash = "";
  return u.toString();
}

async function __qtiPrivacyModeEnabled() {
  try {
    const out = await chrome.storage.local.get(STORAGE_KEYS.captureSettings);
    const s = out[STORAGE_KEYS.captureSettings];
    return !!(s && typeof s === "object" && s.privacyMode === true);
  } catch { return false; }
}

function __qtiApplyPrivacyToQuote(q, enabled) {
  if (!enabled || !q) return q;
  const next = { ...q };
  if (next.pageUrl) next.pageUrl = __qtiScrubUrlForPrivacy(next.pageUrl);
  if (next.frameUrl) next.frameUrl = __qtiScrubUrlForPrivacy(next.frameUrl);
  return next;
}

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

function __qtiBuildCodeFence(q) {
  const raw = String(q?.selectionText || "");
  if (!raw) return "";
  // Pick a fence longer than any backtick run inside the code, per CommonMark.
  let maxRun = 0;
  const re = /`+/g;
  let m;
  while ((m = re.exec(raw))) { if (m[0].length > maxRun) maxRun = m[0].length; }
  const fence = "`".repeat(Math.max(3, maxRun + 1));
  const lang = String(q?.codeLanguage || "").trim().toLowerCase().replace(/[^a-z0-9+#._-]/g, "").slice(0, 32);
  return `${fence}${lang}\n${raw.replace(/\r\n?/g, "\n")}\n${fence}`;
}

const __qtiBulletLineRe = /^\s*(?:[-*•·◦▪●‣⁃∙]|\d{1,3}[.)])\s+/;
function __qtiDetectTaskListLines(text) {
  const raw = String(text || "");
  if (!raw) return null;
  const lines = raw.split(/\r?\n/);
  const nonEmpty = lines.filter((ln) => ln.trim());
  if (nonEmpty.length < 2) return null;
  if (!nonEmpty.every((ln) => __qtiBulletLineRe.test(ln))) return null;
  const out = nonEmpty.map((ln) => "- [ ] " + ln.replace(__qtiBulletLineRe, "").trim()).filter((ln) => ln.length > 6);
  return out.length >= 2 ? out : null;
}

function __qtiBuildMarkdownBody(q) {
  if (!q) return "";
  const lines = [];
  const quoted = String(q.selectionText || "").trim();
  if (quoted && q && q.isCode) {
    lines.push(__qtiBuildCodeFence(q));
    lines.push("");
  } else if (quoted) {
    const tasks = (q.taskListEnabled === false) ? null : __qtiDetectTaskListLines(quoted);
    if (tasks) {
      for (const t of tasks) lines.push(t);
    } else {
      for (const ln of quoted.split(/\r?\n/)) lines.push("> " + ln);
    }
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
  if (q.author) lines.push(`**Author:** ${q.author}`);
  if (q.publishedAt) lines.push(`**Published:** ${__qtiFormatPublishDate(q.publishedAt)}`);
  if (q.screenshot && q.screenshot.dataUrl) {
    const dim = (q.screenshot.width && q.screenshot.height) ? `${q.screenshot.width}\u00d7${q.screenshot.height}` : "PNG";
    lines.push(`**Screenshot:** captured (${dim}) \u2014 paste from clipboard or attach the downloaded PNG when filing.`);
  }
  if (q.capturedAt) lines.push(`**Captured:** ${q.capturedAt}`);
  return lines.join("\n").trim();
}

function __qtiFormatPublishDate(raw) {
  const s = String(raw || "").trim();
  if (!s) return "";
  const t = Date.parse(s);
  if (Number.isFinite(t)) {
    const d = new Date(t);
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, "0");
    const day = String(d.getUTCDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  }
  return s.slice(0, 64);
}

function __qtiRenderTemplate(tpl, q) {
  if (!tpl) return "";
  const quoted = String(q?.selectionText || "").trim();
  const quoteBlock = quoted ? quoted.split(/\r?\n/).map((ln) => "> " + ln).join("\n") : "";
  const quoteCode = (q && q.isCode) ? __qtiBuildCodeFence(q) : (quoted ? "```\n" + quoted + "\n```" : "");
  const taskLines = __qtiDetectTaskListLines(quoted);
  const quoteTaskList = taskLines ? taskLines.join("\n") : "";
  const repls = {
    quote: quoted,
    quote_blockquote: quoteBlock,
    quote_code: quoteCode,
    quote_tasklist: quoteTaskList,
    code_language: String(q?.codeLanguage || ""),
    source_title: String(q?.pageTitle || ""),
    source_url: String(q?.pageUrl || ""),
    source_url_anchor: __qtiBuildSourceUrlAnchor(q) || String(q?.pageUrl || ""),
    section: String(q?.nearestHeading || ""),
    captured_at: String(q?.capturedAt || ""),
    context_before: String(q?.contextBefore || ""),
    context_after: String(q?.contextAfter || ""),
    author: String(q?.author || ""),
    published_at: __qtiFormatPublishDate(q?.publishedAt),
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

// ---------------------------------------------------------------------------
// Offline queue — when a POST fails with a network/server error we stash the
// payload and retry on a periodic alarm (and on startup, and after any
// successful submit). 4xx validation errors are NOT queued — those need user
// fixes, not patience.
// ---------------------------------------------------------------------------

function __qtiIsRetryableError(err) {
  // TypeError from fetch ("Failed to fetch") + network DNS/timeout. Also
  // status-bearing errors with 5xx or 408/429 are retryable.
  if (!err) return false;
  if (err.name === "TypeError") return true;
  const s = Number(err.status);
  if (!Number.isFinite(s)) return /network|failed to fetch|offline|abort|timeout/i.test(String(err.message || ""));
  return s >= 500 || s === 408 || s === 429;
}

function __qtiNormalizeQueue(list) {
  if (!Array.isArray(list)) return [];
  const out = [];
  for (const raw of list) {
    if (!raw || typeof raw !== "object") continue;
    const p = raw.payload || raw;
    const repo = String(p.repo || "").trim();
    const title = String(p.title || "").trim();
    if (!REPO_RE.test(repo) || !title) continue;
    const labels = Array.isArray(p.labels) ? p.labels.map((s) => String(s).trim()).filter(Boolean).slice(0, 24) : [];
    const assignees = Array.isArray(p.assignees) ? p.assignees.map((s) => String(s).trim().replace(/^@+/, "")).filter(Boolean).slice(0, 10) : [];
    const milestone = Number.isFinite(Number(p.milestone)) && Number(p.milestone) > 0 ? Math.floor(Number(p.milestone)) : null;
    const id = String(raw.id || "") || `q_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    const body = String(p.body || "");
    const attempts = Math.max(0, Math.min(MAX_QUEUE_ATTEMPTS + 1, Number(raw.attempts) || 0));
    const queuedAt = typeof raw.queuedAt === "string" ? raw.queuedAt : new Date().toISOString();
    const lastError = typeof raw.lastError === "string" ? raw.lastError.slice(0, 400) : "";
    const lastTriedAt = typeof raw.lastTriedAt === "string" ? raw.lastTriedAt : "";
    out.push({ id, payload: { repo, title, body, labels, assignees, ...(milestone ? { milestone } : {}) }, attempts, queuedAt, lastTriedAt, lastError });
  }
  // Dedupe by id, sort newest queuedAt first, cap.
  const seen = new Set();
  out.sort((a, b) => (Date.parse(b.queuedAt) || 0) - (Date.parse(a.queuedAt) || 0));
  const deduped = [];
  for (const it of out) {
    if (seen.has(it.id)) continue;
    seen.add(it.id);
    deduped.push(it);
    if (deduped.length >= MAX_OFFLINE_QUEUE) break;
  }
  return deduped;
}

async function __qtiLoadQueue() {
  const out = await chrome.storage.local.get(STORAGE_KEYS.offlineQueue);
  return __qtiNormalizeQueue(out[STORAGE_KEYS.offlineQueue]);
}

async function __qtiSaveQueue(list) {
  const next = __qtiNormalizeQueue(list);
  await chrome.storage.local.set({ [STORAGE_KEYS.offlineQueue]: next });
  __qtiReflectQueueBadge(next.length).catch(() => {});
  return next;
}

async function __qtiEnqueue(payload, lastError) {
  const cur = await __qtiLoadQueue();
  const id = `q_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const entry = {
    id,
    payload,
    attempts: 0,
    queuedAt: new Date().toISOString(),
    lastTriedAt: "",
    lastError: String(lastError || "").slice(0, 400),
  };
  const next = await __qtiSaveQueue([entry, ...cur]);
  return { id, size: next.length };
}

async function __qtiReflectQueueBadge(count) {
  if (!chrome.action?.setBadgeText) return;
  // Don't clobber bulk-batch badge; bulk badge handler also runs on changes.
  // Use a distinctive amber color when queue dominates; otherwise leave as-is.
  try {
    if (count > 0) {
      await chrome.action.setBadgeText({ text: `↺${count}` });
      chrome.action.setBadgeBackgroundColor?.({ color: "#F5A623" });
    }
  } catch { /* ignore */ }
}

async function __qtiPostIssue(payload) {
  const { repo, title, body, labels, assignees, milestone } = payload;
  const token = await getToken();
  if (!token) {
    const err = new Error("No GitHub token saved — open settings to add one.");
    err.status = 401;
    throw err;
  }
  const res = await fetch(`${GITHUB_API}/repos/${repo}/issues`, {
    method: "POST",
    headers: {
      "Accept": "application/vnd.github+json",
      "Authorization": `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      title,
      body,
      labels,
      ...(assignees && assignees.length ? { assignees } : {}),
      ...(milestone ? { milestone } : {}),
    }),
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
}

async function flushOfflineQueue() {
  const items = await __qtiLoadQueue();
  if (!items.length) return { processed: 0, succeeded: 0, failed: 0, dropped: 0, remaining: 0 };
  // If browser reports offline, skip work — alarm will fire again.
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    return { processed: 0, succeeded: 0, failed: 0, dropped: 0, remaining: items.length, offline: true };
  }
  let succeeded = 0, failed = 0, dropped = 0;
  const survivors = [];
  const filed = [];
  for (const item of items) {
    try {
      const result = await __qtiPostIssue(item.payload);
      succeeded++;
      filed.push({ ...result, title: item.payload.title });
    } catch (err) {
      const retryable = __qtiIsRetryableError(err);
      const attempts = item.attempts + 1;
      if (!retryable || attempts >= MAX_QUEUE_ATTEMPTS) {
        dropped++;
        continue;
      }
      failed++;
      survivors.push({
        ...item,
        attempts,
        lastTriedAt: new Date().toISOString(),
        lastError: String(err?.message || err).slice(0, 400),
      });
    }
  }
  await __qtiSaveQueue(survivors);
  return { processed: items.length, succeeded, failed, dropped, remaining: survivors.length, filed };
}

on("getOfflineQueue", async () => __qtiLoadQueue());

on("clearOfflineQueue", async () => {
  await chrome.storage.local.remove(STORAGE_KEYS.offlineQueue);
  __qtiReflectQueueBadge(0).catch(() => {});
  return { cleared: true };
});

on("removeOfflineItem", async (msg) => {
  const id = String(msg?.id || "");
  if (!id) return { removed: false };
  const cur = await __qtiLoadQueue();
  const next = cur.filter((q) => q.id !== id);
  await __qtiSaveQueue(next);
  return { removed: next.length !== cur.length, remaining: next.length };
});

on("flushOfflineQueue", async () => flushOfflineQueue());

// ---------------------------------------------------------------------------
// Duplicate detector — search a repo for similar open issues before filing.
// Uses the GitHub Search API; works unauthenticated (low rate limit) and is
// transparently boosted when the user's PAT is present.
// ---------------------------------------------------------------------------

const DUP_STOPWORDS = new Set([
  "a","an","and","are","as","at","be","but","by","for","from","has","have",
  "in","into","is","it","its","of","on","or","so","that","the","their",
  "this","to","was","were","will","with","you","your","i","we","they",
  "quote","issue","bug","can","could","would","should","if","not","no",
  "do","does","did","about","there","here","just","like","some","any",
]);

function __qtiDupTokens(title, selection) {
  const seen = new Set();
  const out = [];
  const src = `${String(title || "")} ${String(selection || "").slice(0, 400)}`;
  for (const raw of src.toLowerCase().split(/[^a-z0-9_]+/)) {
    if (!raw || raw.length < 3 || raw.length > 30) continue;
    if (DUP_STOPWORDS.has(raw)) continue;
    if (/^\d+$/.test(raw)) continue;
    if (seen.has(raw)) continue;
    seen.add(raw);
    out.push(raw);
    if (out.length >= 6) break;
  }
  return out;
}

function __qtiBuildDupQuery({ repo, title, selectionText, state }) {
  const tokens = __qtiDupTokens(title, selectionText);
  if (tokens.length === 0) return "";
  const quoted = tokens.map((t) => `"${t}"`).join(" ");
  const stateQ = state === "all" ? "" : ` is:${state === "closed" ? "closed" : "open"}`;
  return `${quoted} repo:${repo} is:issue${stateQ} in:title,body`;
}

async function __qtiSearchIssues(qStr) {
  const url = `${GITHUB_API}/search/issues?q=${encodeURIComponent(qStr)}&per_page=10&sort=updated&order=desc`;
  const headers = {
    "Accept": "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  const token = await getToken().catch(() => null);
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const res = await fetch(url, { headers });
  if (res.status === 403 || res.status === 429) {
    const reset = Number(res.headers.get("x-ratelimit-reset")) || 0;
    const err = new Error("GitHub rate limit reached — try again shortly.");
    err.status = res.status;
    err.resetAt = reset ? reset * 1000 : null;
    throw err;
  }
  if (!res.ok) {
    let data = null;
    try { data = await res.json(); } catch { /* ignore */ }
    const detail = data?.message || `${res.status} ${res.statusText}`;
    const err = new Error(`GitHub: ${detail}`);
    err.status = res.status;
    throw err;
  }
  const data = await res.json();
  const items = Array.isArray(data?.items) ? data.items : [];
  return items.slice(0, 8).map((it) => ({
    number: it.number,
    title: String(it.title || "").slice(0, 240),
    htmlUrl: it.html_url,
    state: it.state,
    updatedAt: it.updated_at,
    comments: typeof it.comments === "number" ? it.comments : 0,
    labels: Array.isArray(it.labels) ? it.labels.map((l) => String(l?.name || "").trim()).filter(Boolean).slice(0, 6) : [],
    user: it.user?.login || "",
  }));
}

on("searchSimilarIssues", async (msg) => {
  const repo = String(msg?.repo || "").trim();
  const title = String(msg?.title || "").trim();
  const selectionText = String(msg?.selectionText || "");
  const state = msg?.state === "closed" || msg?.state === "all" ? msg.state : "open";
  if (!REPO_RE.test(repo)) return { items: [], reason: "invalid-repo", query: "" };
  const q = __qtiBuildDupQuery({ repo, title, selectionText, state });
  if (!q) return { items: [], reason: "no-tokens", query: "" };
  const items = await __qtiSearchIssues(q);
  return { items, query: q };
});

// ---------------------------------------------------------------------------
// Milestone picker — list open/closed milestones for a repo.
// Best-effort: works unauthenticated for public repos (low rate limit) and
// is boosted by the stored PAT.
// ---------------------------------------------------------------------------

async function __qtiFetchMilestones(repo, state) {
  const url = `${GITHUB_API}/repos/${repo}/milestones?state=${encodeURIComponent(state)}&per_page=100&sort=due_on&direction=asc`;
  const headers = {
    "Accept": "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  const token = await getToken().catch(() => null);
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const res = await fetch(url, { headers });
  if (res.status === 403 || res.status === 429) {
    const reset = Number(res.headers.get("x-ratelimit-reset")) || 0;
    const err = new Error("GitHub rate limit reached — try again shortly.");
    err.status = res.status;
    err.resetAt = reset ? reset * 1000 : null;
    throw err;
  }
  if (res.status === 404) {
    const err = new Error("Repository not found, or token lacks access.");
    err.status = 404;
    throw err;
  }
  if (!res.ok) {
    let data = null;
    try { data = await res.json(); } catch { /* ignore */ }
    const detail = data?.message || `${res.status} ${res.statusText}`;
    const err = new Error(`GitHub: ${detail}`);
    err.status = res.status;
    throw err;
  }
  const data = await res.json();
  const items = Array.isArray(data) ? data : [];
  return items.map((m) => ({
    number: Number(m?.number) || 0,
    title: String(m?.title || "").slice(0, 200),
    description: String(m?.description || "").slice(0, 400),
    state: m?.state === "closed" ? "closed" : "open",
    htmlUrl: typeof m?.html_url === "string" ? m.html_url : "",
    dueOn: typeof m?.due_on === "string" ? m.due_on : "",
    openIssues: Number(m?.open_issues) || 0,
    closedIssues: Number(m?.closed_issues) || 0,
    updatedAt: typeof m?.updated_at === "string" ? m.updated_at : "",
  })).filter((m) => m.number > 0 && m.title);
}

on("listMilestones", async (msg) => {
  const repo = String(msg?.repo || "").trim();
  const state = msg?.state === "closed" || msg?.state === "all" ? msg.state : "open";
  if (!REPO_RE.test(repo)) return { items: [], reason: "invalid-repo" };
  const items = await __qtiFetchMilestones(repo, state);
  // Sort: ones with dueOn first (soonest), then by updatedAt newest, then title.
  items.sort((a, b) => {
    const da = a.dueOn ? Date.parse(a.dueOn) : Infinity;
    const db = b.dueOn ? Date.parse(b.dueOn) : Infinity;
    if (da !== db) return da - db;
    const ua = a.updatedAt ? Date.parse(a.updatedAt) : 0;
    const ub = b.updatedAt ? Date.parse(b.updatedAt) : 0;
    if (ua !== ub) return ub - ua;
    return a.title.localeCompare(b.title);
  });
  return { items, repo, state };
});

// ---------------------------------------------------------------------------
// CODEOWNERS auto-mention — fetch and parse a repo's CODEOWNERS file, extract
// the top-level (catch-all `*`) reviewers, and surface them so the popup can
// auto-@-mention them in new issues.
// ---------------------------------------------------------------------------

const CODEOWNERS_PATHS = ["CODEOWNERS", ".github/CODEOWNERS", "docs/CODEOWNERS"];
const CODEOWNERS_CACHE_KEY = "qti.codeownersCache";
const CODEOWNERS_CACHE_TTL_MS = 30 * 60 * 1000;

function __qtiParseCodeowners(text) {
  const out = { catchAll: [], rules: [], owners: new Set() };
  if (!text || typeof text !== "string") return out;
  const lines = text.split(/\r?\n/);
  for (const raw of lines) {
    const line = raw.replace(/#.*$/, "").trim();
    if (!line) continue;
    const parts = line.split(/\s+/);
    if (parts.length < 2) continue;
    const pattern = parts[0];
    const owners = parts.slice(1)
      .map((o) => o.trim())
      .filter((o) => /^@[A-Za-z0-9][A-Za-z0-9._\-\/]*$/.test(o))
      .map((o) => o.replace(/^@+/, ""))
      .filter(Boolean);
    if (owners.length === 0) continue;
    for (const o of owners) out.owners.add(o);
    const rule = { pattern, owners };
    if (pattern === "*" || pattern === "**" || pattern === "/*" || pattern === "/**") {
      out.catchAll = owners;
    }
    out.rules.push(rule);
  }
  out.owners = Array.from(out.owners);
  return out;
}

async function __qtiFetchCodeownersFromRepo(repo) {
  const token = await getToken().catch(() => null);
  const headers = {
    "Accept": "application/vnd.github.raw",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  let lastStatus = 0;
  for (const path of CODEOWNERS_PATHS) {
    const url = `${GITHUB_API}/repos/${repo}/contents/${encodeURIComponent(path)}`;
    let res;
    try { res = await fetch(url, { headers }); } catch (err) {
      const e = new Error(err?.message || "Network error");
      e.networkError = true;
      throw e;
    }
    if (res.status === 404) { lastStatus = 404; continue; }
    if (res.status === 403 || res.status === 429) {
      const reset = Number(res.headers.get("x-ratelimit-reset")) || 0;
      const err = new Error("GitHub rate limit reached — try again shortly.");
      err.status = res.status;
      err.resetAt = reset ? reset * 1000 : null;
      throw err;
    }
    if (!res.ok) {
      let data = null;
      try { data = await res.json(); } catch { /* ignore */ }
      const detail = data?.message || `${res.status} ${res.statusText}`;
      const err = new Error(`GitHub: ${detail}`);
      err.status = res.status;
      throw err;
    }
    // .raw accept yields the file body directly; if the API returned JSON
    // (e.g. when the path is a dir), fall through to next candidate.
    const ctype = res.headers.get("content-type") || "";
    let text;
    if (ctype.includes("application/json")) {
      const data = await res.json().catch(() => null);
      if (data && typeof data.content === "string" && data.encoding === "base64") {
        try { text = atob(data.content.replace(/\s+/g, "")); } catch { text = ""; }
      } else if (Array.isArray(data)) {
        continue;
      } else {
        text = "";
      }
    } else {
      text = await res.text();
    }
    if (!text) continue;
    return { path, text };
  }
  if (lastStatus === 404) {
    return { path: "", text: "", missing: true };
  }
  return { path: "", text: "", missing: true };
}

async function __qtiReadCodeownersCache() {
  try {
    const o = await chrome.storage.local.get(CODEOWNERS_CACHE_KEY);
    const c = o[CODEOWNERS_CACHE_KEY];
    return c && typeof c === "object" ? c : {};
  } catch { return {}; }
}

async function __qtiWriteCodeownersCache(cache) {
  // Cap the cache to the 10 most recently used repos.
  const entries = Object.entries(cache)
    .filter(([, v]) => v && typeof v === "object")
    .sort((a, b) => (b[1].fetchedAt || 0) - (a[1].fetchedAt || 0))
    .slice(0, 10);
  const trimmed = Object.fromEntries(entries);
  try { await chrome.storage.local.set({ [CODEOWNERS_CACHE_KEY]: trimmed }); } catch { /* ignore */ }
}

on("getCodeowners", async (msg) => {
  const repo = String(msg?.repo || "").trim();
  const force = msg?.force === true;
  if (!REPO_RE.test(repo)) return { ok: false, reason: "invalid-repo", owners: [], catchAll: [] };
  const cache = await __qtiReadCodeownersCache();
  const key = repo.toLowerCase();
  const cached = cache[key];
  const now = Date.now();
  if (!force && cached && (now - (cached.fetchedAt || 0)) < CODEOWNERS_CACHE_TTL_MS) {
    return { ok: true, cached: true, ...cached, repo };
  }
  let fetched;
  try {
    fetched = await __qtiFetchCodeownersFromRepo(repo);
  } catch (err) {
    // Fall back to stale cache if we have one — better than nothing.
    if (cached) return { ok: true, stale: true, error: String(err?.message || err), ...cached, repo };
    throw err;
  }
  const parsed = __qtiParseCodeowners(fetched.text || "");
  const record = {
    fetchedAt: now,
    path: fetched.path || "",
    missing: !!fetched.missing,
    catchAll: parsed.catchAll,
    owners: parsed.owners,
    rules: parsed.rules.slice(0, 50),
  };
  cache[key] = record;
  await __qtiWriteCodeownersCache(cache);
  return { ok: true, cached: false, ...record, repo };
});

// payload: { repo: "owner/name", title, body, labels?: string[], milestone?: number }
// submitIssue — POST a GitHub issue using the stored PAT.
on("submitIssue", async (msg) => {
  const repo = String(msg?.repo || "").trim();
  const title = String(msg?.title || "").trim();
  const body = String(msg?.body || "");
  const labels = Array.isArray(msg?.labels)
    ? msg.labels.map((s) => String(s).trim()).filter(Boolean).slice(0, 24)
    : [];
  const assignees = Array.isArray(msg?.assignees)
    ? msg.assignees.map((s) => String(s).trim().replace(/^@+/, "")).filter(Boolean).slice(0, 10)
    : [];
  const milestoneNum = Number(msg?.milestone);
  const milestone = Number.isFinite(milestoneNum) && milestoneNum > 0 ? Math.floor(milestoneNum) : null;
  if (!REPO_RE.test(repo)) throw new Error("Invalid repo (use owner/name)");
  if (!title) throw new Error("Issue title is required");
  const payload = { repo, title, body, labels, assignees, ...(milestone ? { milestone } : {}) };
  const allowQueue = msg?.allowQueue !== false;
  try {
    const result = await __qtiPostIssue(payload);
    // Opportunistically drain the queue after every success — the network
    // is clearly fine right now and any stale items have been waiting.
    flushOfflineQueue().catch(() => {});
    return result;
  } catch (err) {
    if (allowQueue && __qtiIsRetryableError(err)) {
      const { id, size } = await __qtiEnqueue(payload, err?.message || String(err));
      __qtiScheduleRetry();
      return { queued: true, queueId: id, queueSize: size, reason: String(err?.message || err) };
    }
    throw err;
  }
});

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

function __qtiScheduleRetry() {
  if (!chrome.alarms?.create) return;
  try {
    chrome.alarms.create(OFFLINE_ALARM, {
      delayInMinutes: 1,
      periodInMinutes: OFFLINE_ALARM_MIN,
    });
  } catch (err) {
    console.warn(LOG_PREFIX, "alarm create failed", err);
  }
}

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
  __qtiScheduleRetry();
  console.log(LOG_PREFIX, "onInstalled", details.reason, manifest.version);
});

chrome.alarms?.onAlarm.addListener((alarm) => {
  if (alarm?.name !== OFFLINE_ALARM) return;
  flushOfflineQueue()
    .then((r) => {
      if (r?.remaining === 0) {
        try { chrome.alarms.clear(OFFLINE_ALARM); } catch { /* ignore */ }
      }
      if (r && (r.succeeded || r.dropped)) console.log(LOG_PREFIX, "offline retry", r);
    })
    .catch((err) => console.warn(LOG_PREFIX, "offline retry failed", err));
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
function __qtiCaptureSelection(opts) {
  const radius = Math.max(0, Math.min(600, Number(opts?.contextRadius ?? 240) || 0));
  // Scrape byline + publish date from the host page. Best-effort, never
  // throws — fields are empty strings when nothing matches. Order of
  // precedence: JSON-LD → OpenGraph/meta → visible DOM hints.
  function scrapeByline() {
    let author = "";
    let publishedAt = "";
    const pickMeta = (names) => {
      for (const n of names) {
        const sel = `meta[name="${n}" i], meta[property="${n}" i]`;
        let el;
        try { el = document.querySelector(sel); } catch { el = null; }
        const v = el?.getAttribute("content");
        if (v && v.trim()) return v.trim();
      }
      return "";
    };
    const authorFromLd = (obj) => {
      const a = obj && obj.author;
      if (!a) return "";
      if (typeof a === "string") return a;
      if (Array.isArray(a)) {
        return a.map((x) => (typeof x === "string" ? x : (x && x.name) || "")).filter(Boolean).join(", ");
      }
      if (typeof a === "object" && a.name) return String(a.name);
      return "";
    };
    try {
      const scripts = document.querySelectorAll('script[type="application/ld+json"]');
      for (const s of scripts) {
        let data;
        try { data = JSON.parse(s.textContent || "null"); } catch { continue; }
        if (!data) continue;
        const nodes = Array.isArray(data)
          ? data
          : (data["@graph"] && Array.isArray(data["@graph"]) ? data["@graph"] : [data]);
        for (const obj of nodes) {
          if (!obj || typeof obj !== "object") continue;
          if (!author) {
            const cand = authorFromLd(obj);
            if (cand) author = cand;
          }
          if (!publishedAt) {
            publishedAt = String(obj.datePublished || obj.dateCreated || obj.dateModified || "");
          }
          if (author && publishedAt) break;
        }
        if (author && publishedAt) break;
      }
    } catch { /* ignore JSON-LD failures */ }
    if (!author) author = pickMeta(["author", "article:author", "parsely-author", "sailthru.author", "twitter:creator", "byl", "DC.creator"]);
    if (!publishedAt) publishedAt = pickMeta(["article:published_time", "article:published", "datePublished", "date", "pubdate", "publication_date", "parsely-pub-date", "sailthru.date", "DC.date.issued"]);
    if (!publishedAt) {
      let t;
      try { t = document.querySelector("time[datetime], time[pubdate]"); } catch { t = null; }
      if (t) publishedAt = t.getAttribute("datetime") || (t.textContent || "").trim();
    }
    if (!author) {
      let el;
      try {
        el = document.querySelector(
          '[rel="author"], [itemprop="author"] [itemprop="name"], [itemprop="author"], .byline-name, .byline a, .author-name, .author a, .c-byline__author, .Byline a, [data-testid="byline-name"]',
        );
      } catch { el = null; }
      if (el) author = (el.textContent || "").trim();
    }
    // If author still missing, try a .byline / .author block's full text.
    if (!author) {
      let el;
      try { el = document.querySelector(".byline, .author, [class*='byline' i]"); } catch { el = null; }
      if (el) {
        let raw = (el.textContent || "").replace(/\s+/g, " ").trim();
        raw = raw.replace(/^\s*(by|written by|posted by)\s+/i, "");
        author = raw;
      }
    }
    author = String(author || "").replace(/^\s*by\s+/i, "").replace(/\s+/g, " ").trim().slice(0, 200);
    publishedAt = String(publishedAt || "").trim().slice(0, 64);
    return { author, publishedAt };
  }
  const byline = (() => { try { return scrapeByline(); } catch { return { author: "", publishedAt: "" }; } })();
  try {
    const sel = window.getSelection && window.getSelection();
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed) {
      return { selectionText: "", selectionHtml: "", contextBefore: "", contextAfter: "", nearestHeading: "", author: byline.author, publishedAt: byline.publishedAt };
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
    // Code detection — walk up to find an enclosing <pre>/<code>, sniff the
    // language from common class hints (language-*, lang-*, highlight-*) or
    // data-language / data-lang attributes used by Prism / highlight.js / Rouge.
    let isCode = false;
    let codeLanguage = "";
    {
      let c = (node.nodeType === 1) ? node : node.parentNode;
      const langFromClass = (cls) => {
        const s = String(cls || "");
        const m1 = s.match(/(?:language|lang|highlight|brush)[-:]([A-Za-z0-9+#._-]+)/i);
        if (m1) return m1[1];
        const tokens = s.split(/\s+/);
        for (const tk of tokens) {
          if (/^(hljs|prettyprint|prism|code|pre|highlight)$/i.test(tk)) continue;
          if (/^[A-Za-z][A-Za-z0-9+#._-]{0,30}$/.test(tk) && /^(js|ts|jsx|tsx|py|python|rb|ruby|go|rs|rust|java|kotlin|swift|c|cpp|cs|csharp|php|html|css|scss|sass|less|json|yaml|yml|toml|xml|sh|bash|zsh|fish|sql|md|markdown|dockerfile|makefile|lua|perl|r|scala|dart|elixir|ex|erl|hs|haskell|clj|clojure|fs|nim|zig|vim|tex|graphql|proto)$/i.test(tk)) return tk;
        }
        return "";
      };
      while (c && c !== document.body) {
        const tag = c.tagName;
        if (tag === "PRE" || tag === "CODE") {
          isCode = true;
          if (!codeLanguage) {
            codeLanguage = langFromClass(c.className)
              || c.getAttribute?.("data-language")
              || c.getAttribute?.("data-lang")
              || "";
          }
          // Inspect descendant <code> for language when sitting on a <pre>.
          if (!codeLanguage && tag === "PRE") {
            const inner = c.querySelector?.("code");
            if (inner) codeLanguage = langFromClass(inner.className) || inner.getAttribute?.("data-language") || inner.getAttribute?.("data-lang") || "";
          }
        }
        c = c.parentNode;
      }
      codeLanguage = String(codeLanguage || "").trim().toLowerCase().slice(0, 32);
    }
    const BLOCK = /^(P|DIV|LI|BLOCKQUOTE|ARTICLE|SECTION|TD|PRE|FIGCAPTION|DD|DT)$/;
    let block = node;
    while (block && block !== document.body && !(block.tagName && BLOCK.test(block.tagName))) {
      block = block.parentNode;
    }
    let contextBefore = "", contextAfter = "";
    if (radius > 0 && block && block.textContent) {
      const full = block.textContent.replace(/\s+/g, " ").trim();
      const idx = full.indexOf(selectionText.replace(/\s+/g, " ").trim());
      if (idx >= 0) {
        contextBefore = full.slice(Math.max(0, idx - radius), idx).trim();
        contextAfter = full.slice(idx + selectionText.length, idx + selectionText.length + radius).trim();
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
    // Bounding rects of the selection (CSS pixel coords, viewport-relative).
    // Used by the SW to composite a spotlight mask on the screenshot.
    const selectionRects = (() => {
      try {
        const list = range.getClientRects ? range.getClientRects() : [];
        const out = [];
        for (const r of list) {
          if (!r || r.width < 1 || r.height < 1) continue;
          out.push({ x: r.left, y: r.top, w: r.width, h: r.height });
          if (out.length >= 64) break;
        }
        return out;
      } catch { return []; }
    })();
    return { selectionText, selectionHtml, contextBefore, contextAfter, nearestHeading, isCode, codeLanguage, author: byline.author, publishedAt: byline.publishedAt, selectionRects, devicePixelRatio: Number(window.devicePixelRatio) || 1, viewportWidth: window.innerWidth || 0, viewportHeight: window.innerHeight || 0 };
  } catch (err) {
    return { selectionText: "", selectionHtml: "", contextBefore: "", contextAfter: "", nearestHeading: "", isCode: false, codeLanguage: "", author: byline.author || "", publishedAt: byline.publishedAt || "", selectionRects: [], devicePixelRatio: 1, error: String(err && err.message || err) };
  }
}

// Pull the (possibly multi-line) bounding rectangles of the current selection
// so the service worker can composite a spotlight mask over the screenshot.
// Coordinates are CSS pixels relative to the viewport — the SW multiplies by
// devicePixelRatio to align with the captureVisibleTab bitmap.
function __qtiCollectSelectionRects(range) {
  try {
    const list = range.getClientRects ? range.getClientRects() : [];
    const out = [];
    for (const r of list) {
      if (!r || r.width < 1 || r.height < 1) continue;
      out.push({ x: r.left, y: r.top, w: r.width, h: r.height });
      if (out.length >= 64) break;
    }
    return out;
  } catch { return []; }
}

async function captureSelectionFromTab(tabId, frameId) {
  if (!chrome.scripting?.executeScript || tabId == null) return null;
  let radius = 240;
  try {
    const out = await chrome.storage.local.get(STORAGE_KEYS.captureSettings);
    const s = out[STORAGE_KEYS.captureSettings];
    if (s && typeof s === "object") {
      const enabled = s.contextEnabled !== false;
      const r = Number(s.contextRadius);
      radius = enabled ? (Number.isFinite(r) ? Math.max(0, Math.min(600, Math.round(r))) : 240) : 0;
    }
  } catch { /* defaults */ }
  try {
    const results = await chrome.scripting.executeScript({
      target: frameId != null ? { tabId, frameIds: [frameId] } : { tabId },
      func: __qtiCaptureSelection,
      args: [{ contextRadius: radius }],
    });
    return results?.[0]?.result ?? null;
  } catch (err) {
    console.warn(LOG_PREFIX, "executeScript failed", err);
    return null;
  }
}

// Compose a "spotlight" PNG over the raw captureVisibleTab bitmap: dim the
// rest of the page and frame each selection rect with a crisp accent stroke.
// Returns a new screenshot record or the input shot on failure.
async function applySpotlightHighlight(shot, rects, dpr) {
  if (!shot?.dataUrl || !Array.isArray(rects) || rects.length === 0) return shot;
  if (typeof OffscreenCanvas !== "function" || typeof createImageBitmap !== "function") return shot;
  try {
    const blob = await (await fetch(shot.dataUrl)).blob();
    const bmp = await createImageBitmap(blob);
    const W = bmp.width, H = bmp.height;
    const canvas = new OffscreenCanvas(W, H);
    const ctx = canvas.getContext("2d");
    if (!ctx) { bmp.close?.(); return shot; }
    ctx.drawImage(bmp, 0, 0);
    bmp.close?.();
    const scale = Number(dpr) > 0 ? Number(dpr) : 1;
    const pad = Math.max(4, Math.round(6 * scale));
    const boxes = [];
    for (const r of rects) {
      const x = Math.max(0, Math.round(r.x * scale) - pad);
      const y = Math.max(0, Math.round(r.y * scale) - pad);
      const w = Math.min(W - x, Math.round(r.w * scale) + pad * 2);
      const h = Math.min(H - y, Math.round(r.h * scale) + pad * 2);
      if (w > 0 && h > 0) boxes.push({ x, y, w, h });
    }
    if (boxes.length === 0) return shot;
    // Dim the entire frame, then punch out the selection rects with a
    // rounded clear so the underlying pixels stay sharp.
    ctx.save();
    ctx.fillStyle = "rgba(8, 8, 11, 0.62)";
    ctx.fillRect(0, 0, W, H);
    ctx.globalCompositeOperation = "destination-out";
    const radius = Math.max(2, Math.round(3 * scale));
    ctx.beginPath();
    for (const b of boxes) roundedRectPath(ctx, b.x, b.y, b.w, b.h, radius);
    ctx.fill();
    ctx.restore();
    // Crisp accent stroke around each spotlighted region.
    ctx.save();
    ctx.lineWidth = Math.max(2, Math.round(2 * scale));
    ctx.strokeStyle = "rgba(124, 92, 255, 0.95)";
    ctx.shadowColor = "rgba(124, 92, 255, 0.55)";
    ctx.shadowBlur = Math.max(6, Math.round(8 * scale));
    for (const b of boxes) {
      ctx.beginPath();
      roundedRectPath(ctx, b.x + 0.5, b.y + 0.5, b.w - 1, b.h - 1, radius);
      ctx.stroke();
    }
    ctx.restore();
    const outBlob = await canvas.convertToBlob({ type: "image/png" });
    const buf = await outBlob.arrayBuffer();
    const bytes = new Uint8Array(buf);
    let bin = "";
    const CHUNK = 0x8000;
    for (let i = 0; i < bytes.length; i += CHUNK) {
      bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
    }
    const b64 = (globalThis.btoa || ((s) => Buffer.from(s, "binary").toString("base64")))(bin);
    return {
      ...shot,
      dataUrl: `data:image/png;base64,${b64}`,
      bytes: buf.byteLength,
      highlighted: true,
      highlightedAt: new Date().toISOString(),
    };
  } catch (err) {
    console.warn(LOG_PREFIX, "applySpotlightHighlight failed", err);
    return shot;
  }
}

// Apply spotlight to a freshly-captured screenshot if the user has the
// highlight mode toggle on. Reads capture settings + selection rects from the
// content-script result; returns the original shot unchanged when off or when
// rects are unavailable (e.g. PDF viewer, cross-origin iframe).
async function __qtiMaybeSpotlight(shot, enriched) {
  if (!shot) return shot;
  let on = false;
  try {
    const out = await chrome.storage.local.get(STORAGE_KEYS.captureSettings);
    const s = out[STORAGE_KEYS.captureSettings];
    on = !!(s && typeof s === "object" && s.highlightMode === true);
  } catch { /* default off */ }
  if (!on) return shot;
  const rects = Array.isArray(enriched?.selectionRects) ? enriched.selectionRects : [];
  const dpr = Number(enriched?.devicePixelRatio) || 1;
  return await applySpotlightHighlight(shot, rects, dpr);
}

function roundedRectPath(ctx, x, y, w, h, r) {
  const rr = Math.max(0, Math.min(r, Math.min(w, h) / 2));
  if (typeof ctx.roundRect === "function") { ctx.roundRect(x, y, w, h, rr); return; }
  ctx.moveTo(x + rr, y);
  ctx.lineTo(x + w - rr, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + rr);
  ctx.lineTo(x + w, y + h - rr);
  ctx.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
  ctx.lineTo(x + rr, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - rr);
  ctx.lineTo(x, y + rr);
  ctx.quadraticCurveTo(x, y, x + rr, y);
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
  const [enriched, rawShot] = await Promise.all([
    captureSelectionFromTab(tab?.id, info.frameId),
    captureVisibleTabScreenshot(tab?.windowId),
  ]);
  const screenshot = await __qtiMaybeSpotlight(rawShot, enriched);
  const selectionText = (enriched?.selectionText || info.selectionText || "").trim();
  const privacyOn = await __qtiPrivacyModeEnabled();
  const quote = __qtiApplyPrivacyToQuote({
    selectionText,
    selectionHtml: enriched?.selectionHtml ?? "",
    contextBefore: enriched?.contextBefore ?? "",
    contextAfter: enriched?.contextAfter ?? "",
    nearestHeading: enriched?.nearestHeading ?? "",
    isCode: !!enriched?.isCode,
    codeLanguage: enriched?.codeLanguage ?? "",
    author: enriched?.author ?? "",
    publishedAt: enriched?.publishedAt ?? "",
    pageUrl: info.pageUrl ?? tab?.url ?? "",
    pageTitle: tab?.title ?? "",
    frameUrl: info.frameUrl ?? "",
    screenshot: screenshot || null,
    capturedAt: new Date().toISOString(),
  }, privacyOn);
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
  __qtiScheduleRetry();
  // Best-effort: drain any items queued during the previous session.
  flushOfflineQueue().catch((err) => console.warn(LOG_PREFIX, "startup flush failed", err));
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
  const [enriched, rawShot] = await Promise.all([
    captureSelectionFromTab(tab.id),
    captureVisibleTabScreenshot(tab.windowId),
  ]);
  const screenshot = await __qtiMaybeSpotlight(rawShot, enriched);
  const selectionText = String(enriched?.selectionText || "").trim();
  if (!selectionText) return { error: "no selection — highlight text first" };
  const privacyOn = await __qtiPrivacyModeEnabled();
  return {
    quote: __qtiApplyPrivacyToQuote({
      selectionText,
      selectionHtml: enriched?.selectionHtml ?? "",
      contextBefore: enriched?.contextBefore ?? "",
      contextAfter: enriched?.contextAfter ?? "",
      nearestHeading: enriched?.nearestHeading ?? "",
      isCode: !!enriched?.isCode,
      codeLanguage: enriched?.codeLanguage ?? "",
      author: enriched?.author ?? "",
      publishedAt: enriched?.publishedAt ?? "",
      pageUrl: tab.url ?? "",
      pageTitle: tab.title ?? "",
      frameUrl: "",
      screenshot: screenshot || null,
      capturedAt: new Date().toISOString(),
    }, privacyOn),
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
    if (result?.queued) {
      __qtiFlashBadge("↺", "#F5A623");
      console.log(LOG_PREFIX, "shortcut queued (offline)", result?.queueId);
      return;
    }
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
export const __test__ = {
  handlers, STORAGE_KEYS,
  CONTEXT_MENU_ID, CONTEXT_MENU_TITLE, CONTEXT_MENU_BULK_ID, CONTEXT_MENU_BULK_TITLE,
  MAX_BULK_QUOTES, MAX_OFFLINE_QUEUE, MAX_QUEUE_ATTEMPTS,
  isRetryableError: __qtiIsRetryableError,
  normalizeOfflineQueue: __qtiNormalizeQueue,
};
