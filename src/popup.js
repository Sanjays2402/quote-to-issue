// Quote to Issue — popup entry point
import {
  looksLikeGithubToken,
  previewToken,
  setToken,
  hasToken,
  clearToken,
  getTokenInfo,
} from "./token.js";

const LOG = "[quote-to-issue]";

const STORAGE_KEYS = Object.freeze({
  pendingQuote: "qti.pendingQuote",
  formState: "qti.formState",
  recentRepos: "qti.recentRepos",
  repoTemplates: "qti.repoTemplates",
  drafts: "qti.drafts",
  bulkQuotes: "qti.bulkQuotes",
  bulkState: "qti.bulkState",
});

const MAX_BULK_QUOTES = 20;

const MAX_DRAFTS = 25;
const MAX_DRAFT_BODY_LEN = 32_000;

const MAX_TEMPLATE_LEN = 8000;
const DEFAULT_TEMPLATE = `## Summary\n\n\n## Quote\n\n{{quote_blockquote}}\n\n## Source\n\n- **Page:** [{{source_title}}]({{source_url_anchor}})\n- **Section:** {{section}}\n- **Captured:** {{captured}}\n\n{{screenshot_note}}\n`;

const MAX_RECENT_REPOS = 8;

const root = document.getElementById("root");
const tplEmpty = document.getElementById("tpl-empty");
const tplQuote = document.getElementById("tpl-quote");
const tplForm = document.getElementById("tpl-form");
const tplSettings = document.getElementById("tpl-settings");
const tplSuccess = document.getElementById("tpl-success");
const tplDrafts = document.getElementById("tpl-drafts");
const tplDraftRow = document.getElementById("tpl-draft-row");
const tplBulk = document.getElementById("tpl-bulk");
const tplBulkRow = document.getElementById("tpl-bulk-row");

let settingsOpen = false;

// --- Theme toggle (dark/light/system) ----------------------------------
const THEME_MODES = ["system", "light", "dark"];
const THEME_LABELS = { system: "follow system", light: "light", dark: "dark" };
const THEME_STORAGE_KEY = "qti.themeMode";
let themeMode = "system";
let themeMediaQuery = null;

function resolveTheme(mode) {
  if (mode === "light" || mode === "dark") return mode;
  try {
    if (typeof window !== "undefined" && window.matchMedia) {
      return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
    }
  } catch {}
  return "dark";
}

function applyTheme(mode) {
  const resolved = resolveTheme(mode);
  if (document?.body) document.body.dataset.theme = resolved;
  const btn = document.getElementById("theme-btn");
  if (btn) {
    btn.dataset.themeMode = mode;
    const label = `Theme: ${THEME_LABELS[mode] || mode}`;
    btn.setAttribute("title", label);
    btn.setAttribute("aria-label", label);
  }
}

async function initTheme() {
  try {
    const out = await chrome?.storage?.local?.get?.(THEME_STORAGE_KEY);
    const stored = out?.[THEME_STORAGE_KEY];
    if (THEME_MODES.includes(stored)) themeMode = stored;
  } catch {}
  applyTheme(themeMode);
  try {
    if (typeof window !== "undefined" && window.matchMedia) {
      themeMediaQuery = window.matchMedia("(prefers-color-scheme: light)");
      const onChange = () => { if (themeMode === "system") applyTheme("system"); };
      themeMediaQuery.addEventListener?.("change", onChange);
    }
  } catch {}
  document.getElementById("theme-btn")?.addEventListener("click", async () => {
    const i = THEME_MODES.indexOf(themeMode);
    themeMode = THEME_MODES[(i + 1) % THEME_MODES.length];
    applyTheme(themeMode);
    try { await chrome?.storage?.local?.set?.({ [THEME_STORAGE_KEY]: themeMode }); } catch {}
  });
}

if (typeof document !== "undefined" && document.getElementById?.("theme-btn")) {
  initTheme();
}

document.getElementById("settings-btn")?.addEventListener("click", () => {
  settingsOpen = !settingsOpen;
  if (settingsOpen) renderSettings();
  else loadPending();
});

// ---------------------------------------------------------------------------
// Pure helpers (exported on window for smoke tests in non-extension envs)
// ---------------------------------------------------------------------------

function fmtTime(iso) {
  if (!iso) return "";
  try {
    const d = new Date(iso);
    return d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
  } catch { return iso; }
}

function hostnameOf(url) {
  try { return new URL(url).hostname; } catch { return url || ""; }
}

/** owner/name — GitHub naming rules, both segments required. */
const REPO_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}\/[A-Za-z0-9._-]{1,100}$/;

function parseRepo(input) {
  const v = String(input || "").trim().replace(/^https?:\/\/github\.com\//i, "").replace(/\.git$/i, "").replace(/\/+$/, "");
  if (!v) return { ok: false, value: "", error: "" };
  if (!REPO_RE.test(v)) return { ok: false, value: v, error: "Use the form owner/name" };
  const [owner, name] = v.split("/");
  return { ok: true, value: `${owner}/${name}`, owner, name };
}

function parseLabels(input) {
  return String(input || "")
    .split(/[,\n]/)
    .map((s) => s.trim())
    .filter(Boolean)
    .filter((v, i, a) => a.indexOf(v) === i)
    .slice(0, 12);
}

function deriveTitle(q) {
  const t = (q?.selectionText || "").trim().replace(/\s+/g, " ");
  if (!t) return q?.pageTitle ? `Quote from: ${q.pageTitle}` : "";
  const max = 72;
  const trimmed = t.length > max ? t.slice(0, max - 1).replace(/\s+\S*$/, "") + "…" : t;
  return `Quote: ${trimmed}`;
}

/**
 * Build a Scroll-To-Text-Fragment deep link for the captured quote. Modern
 * browsers honour `#:~:text=...` and will scroll + highlight the exact
 * passage on load — the issue link goes from "open the page" to "open the
 * page exactly where I selected this". Long selections collapse to a
 * `start,end` anchor pair so the URL stays a reasonable length.
 *
 * Returns the original URL untouched if it already has a fragment, or if
 * there is no selection to anchor to. URLs without a `pageUrl` return "".
 */
function buildSourceUrlWithAnchor(q) {
  const url = String(q?.pageUrl || "").trim();
  if (!url) return "";
  const text = String(q?.selectionText || "").replace(/\s+/g, " ").trim();
  if (!text) return url;
  // Don't clobber an existing fragment — the source page already pointed at
  // a specific anchor and we shouldn't second-guess that.
  if (url.includes("#")) return url;
  // RFC 3986 reserves these, but the text-fragment grammar additionally
  // requires `-`, `,`, `&` to be percent-encoded so they don't collide with
  // the prefix/suffix/end syntax.
  const enc = (s) => encodeURIComponent(s)
    .replace(/-/g, "%2D")
    .replace(/,/g, "%2C")
    .replace(/&/g, "%26");
  const MAX = 300;
  if (text.length <= MAX) {
    return `${url}#:~:text=${enc(text)}`;
  }
  // For long selections, use the textStart,textEnd form. Take enough words
  // on each side that the browser can disambiguate, but not so many that the
  // URL becomes unwieldy.
  const words = text.split(" ").filter(Boolean);
  const startWords = words.slice(0, 6).join(" ");
  const endWords = words.slice(-6).join(" ");
  if (!startWords || !endWords || startWords === endWords) {
    return `${url}#:~:text=${enc(text.slice(0, MAX))}`;
  }
  return `${url}#:~:text=${enc(startWords)},${enc(endWords)}`;
}

function buildMarkdownBody(q) {
  if (!q) return "";
  const lines = [];
  const quoted = (q.selectionText || "").trim();
  if (quoted) {
    for (const ln of quoted.split(/\r?\n/)) lines.push("> " + ln);
    lines.push("");
  }
  const before = (q.contextBefore || "").trim();
  const after = (q.contextAfter || "").trim();
  if (before || after) {
    lines.push("**Context:** " + (before ? `…${before} ` : "") + (quoted ? `**${quoted.slice(0, 200)}${quoted.length > 200 ? "…" : ""}**` : "") + (after ? ` ${after}…` : ""));
    lines.push("");
  }
  lines.push("---");
  if (q.pageTitle || q.pageUrl) {
    const title = q.pageTitle ? q.pageTitle.replace(/[\[\]]/g, "") : (hostnameOf(q.pageUrl) || q.pageUrl);
    const anchored = buildSourceUrlWithAnchor(q) || q.pageUrl || "#";
    lines.push(`**Source:** [${title}](${anchored})`);
    if (anchored && anchored !== (q.pageUrl || "") && q.pageUrl) {
      lines.push(`<sub>Plain URL: <${q.pageUrl}></sub>`);
    }
  }
  if (q.nearestHeading) lines.push(`**Section:** ${q.nearestHeading}`);
  if (q.screenshot && q.screenshot.dataUrl) {
    const dim = (q.screenshot.width && q.screenshot.height)
      ? `${q.screenshot.width}×${q.screenshot.height}`
      : "PNG";
    lines.push(`**Screenshot:** captured (${dim}) — paste from clipboard or attach the downloaded PNG when filing.`);
  }
  if (q.capturedAt) lines.push(`**Captured:** ${q.capturedAt}`);
  return lines.join("\n").trim();
}

function formatBytes(n) {
  if (!Number.isFinite(n) || n <= 0) return "";
  const units = ["B", "KB", "MB"];
  let i = 0; let v = n;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i += 1; }
  const fixed = (v >= 10 || i === 0) ? v.toFixed(0) : v.toFixed(1).replace(/\.0$/, "");
  return `${fixed} ${units[i]}`;
}

function deriveScreenshotFilename(q) {
  const host = (hostnameOf(q?.pageUrl) || "page").replace(/[^a-z0-9.-]+/gi, "-").replace(/^-+|-+$/g, "").toLowerCase() || "page";
  const stamp = (q?.capturedAt || new Date().toISOString()).replace(/[:.]/g, "-").replace(/Z$/, "");
  return `quote-${host}-${stamp}.png`;
}

/**
 * Normalize an arbitrary stored list of recent repos into the canonical shape
 * — `{ value: "owner/name", lastUsed: ISO }`, sorted newest-first, deduped on
 * value (case-insensitive), trimmed to MAX_RECENT_REPOS.
 */
function normalizeRecentRepos(list) {
  if (!Array.isArray(list)) return [];
  const entries = [];
  for (const raw of list) {
    if (!raw) continue;
    const value = String(raw.value || raw.repo || "").trim();
    const parsed = parseRepo(value);
    if (!parsed.ok) continue;
    const lastUsed = typeof raw.lastUsed === "string" ? raw.lastUsed : (raw.lastUsed ? new Date(raw.lastUsed).toISOString() : "");
    entries.push({ value: parsed.value, lastUsed });
  }
  entries.sort((a, b) => (Date.parse(b.lastUsed) || 0) - (Date.parse(a.lastUsed) || 0));
  const seen = new Set();
  const out = [];
  for (const e of entries) {
    const key = e.value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(e);
  }
  return out.slice(0, MAX_RECENT_REPOS);
}

// ---------------------------------------------------------------------------
// Per-repo issue templates
// ---------------------------------------------------------------------------

function repoKey(repo) {
  const parsed = parseRepo(repo);
  return parsed.ok ? parsed.value.toLowerCase() : "";
}

function normalizeRepoTemplates(raw) {
  if (!raw || typeof raw !== "object") return {};
  const out = {};
  for (const [k, v] of Object.entries(raw)) {
    const key = repoKey(k);
    if (!key) continue;
    if (!v || typeof v !== "object") continue;
    const body = typeof v.body === "string" ? v.body.slice(0, MAX_TEMPLATE_LEN) : "";
    if (!body.trim()) continue;
    const updatedAt = typeof v.updatedAt === "string" ? v.updatedAt : new Date().toISOString();
    out[key] = { body, updatedAt };
  }
  return out;
}

async function getAllRepoTemplates() {
  if (!chrome?.storage?.local) return {};
  const out = await chrome.storage.local.get(STORAGE_KEYS.repoTemplates);
  return normalizeRepoTemplates(out[STORAGE_KEYS.repoTemplates]);
}

async function getRepoTemplate(repo) {
  const key = repoKey(repo);
  if (!key) return null;
  const all = await getAllRepoTemplates();
  return all[key] || null;
}

async function setRepoTemplate(repo, body) {
  const key = repoKey(repo);
  if (!key) throw new Error("Invalid repo");
  const text = String(body || "").trim();
  if (!text) throw new Error("Template body required");
  const all = await getAllRepoTemplates();
  all[key] = { body: text.slice(0, MAX_TEMPLATE_LEN), updatedAt: new Date().toISOString() };
  await chrome.storage.local.set({ [STORAGE_KEYS.repoTemplates]: all });
  return all[key];
}

async function clearRepoTemplate(repo) {
  const key = repoKey(repo);
  if (!key) return;
  const all = await getAllRepoTemplates();
  if (!all[key]) return;
  delete all[key];
  await chrome.storage.local.set({ [STORAGE_KEYS.repoTemplates]: all });
}

/**
 * Substitute `{{var}}` placeholders in a template with values derived from the
 * captured quote. Unknown placeholders are left intact so the user notices.
 */
function renderTemplate(tmpl, q) {
  const t = String(tmpl || "");
  if (!t) return "";
  const quoted = (q?.selectionText || "").trim();
  const quoteBlock = quoted ? quoted.split(/\r?\n/).map((ln) => "> " + ln).join("\n") : "";
  const sourceTitle = q?.pageTitle || hostnameOf(q?.pageUrl) || q?.pageUrl || "";
  const sourceUrl = q?.pageUrl || "";
  const sourceUrlAnchor = buildSourceUrlWithAnchor(q);
  const section = q?.nearestHeading || "";
  const captured = q?.capturedAt || "";
  const ctxBefore = (q?.contextBefore || "").trim();
  const ctxAfter = (q?.contextAfter || "").trim();
  let screenshotNote = "";
  if (q?.screenshot?.dataUrl) {
    const dim = (q.screenshot.width && q.screenshot.height) ? `${q.screenshot.width}\u00d7${q.screenshot.height}` : "PNG";
    screenshotNote = `**Screenshot:** captured (${dim}) — paste from clipboard or attach the downloaded PNG when filing.`;
  }
  const vars = {
    quote: quoted,
    quote_blockquote: quoteBlock,
    source_title: sourceTitle,
    source_url: sourceUrl,
    source_url_anchor: sourceUrlAnchor,
    section,
    captured,
    context_before: ctxBefore,
    context_after: ctxAfter,
    screenshot_note: screenshotNote,
    host: hostnameOf(q?.pageUrl),
  };
  return t.replace(/\{\{\s*([a-z_][a-z0-9_]*)\s*\}\}/gi, (m, name) => {
    const v = vars[String(name).toLowerCase()];
    return v == null ? m : String(v);
  });
}

// ---------------------------------------------------------------------------
// Markdown → HTML preview (minimal, safe, no external deps)
// Handles: fenced code, ATX headings, blockquotes, lists (- / 1.), hr,
// inline code, bold/italic, links, autolinks, paragraphs. HTML in source is
// escaped first so user content never injects markup.
// ---------------------------------------------------------------------------
function escapeHtml(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
function renderInline(s) {
  // s is already HTML-escaped. Apply inline tokens.
  let out = s;
  // Inline code first to protect against further substitutions inside.
  const codes = [];
  out = out.replace(/`([^`\n]+)`/g, (_, c) => {
    codes.push(c);
    return `\u0000C${codes.length - 1}\u0000`;
  });
  // Links: [text](url) — only allow http(s)/mailto/# urls.
  out = out.replace(/\[([^\]]+)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)/g, (m, text, href, title) => {
    const safe = /^(https?:|mailto:|#)/i.test(href) ? href : "#";
    const t = title ? ` title="${escapeHtml(title)}"` : "";
    return `<a href="${safe}" target="_blank" rel="noopener noreferrer"${t}>${text}</a>`;
  });
  // Autolinks <url>
  out = out.replace(/&lt;(https?:\/\/[^\s&]+)&gt;/g, (m, url) => `<a href="${url}" target="_blank" rel="noopener noreferrer">${url}</a>`);
  // Bold + italic. Order matters: ***x*** > **x** > *x*.
  out = out.replace(/\*\*\*([^*\n]+)\*\*\*/g, "<strong><em>$1</em></strong>");
  out = out.replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>");
  out = out.replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, "$1<em>$2</em>");
  // Restore inline code with escape.
  out = out.replace(/\u0000C(\d+)\u0000/g, (_, i) => `<code>${escapeHtml(codes[Number(i)])}</code>`);
  return out;
}

function renderMarkdownPreview(src) {
  const text = String(src == null ? "" : src);
  if (!text.trim()) return "";
  const escaped = escapeHtml(text);
  const lines = escaped.split(/\r?\n/);
  const html = [];
  let i = 0;
  let inList = false;
  let listTag = "";
  let inQuote = false;
  let para = [];
  const flushPara = () => {
    if (para.length === 0) return;
    html.push(`<p>${renderInline(para.join(" "))}</p>`);
    para = [];
  };
  const closeList = () => { if (inList) { html.push(`</${listTag}>`); inList = false; listTag = ""; } };
  const closeQuote = () => { if (inQuote) { html.push("</blockquote>"); inQuote = false; } };
  while (i < lines.length) {
    const line = lines[i];
    // Fenced code block.
    const fence = /^```\s*([\w-]*)\s*$/.exec(line);
    if (fence) {
      flushPara(); closeList(); closeQuote();
      const lang = fence[1] || "";
      const buf = [];
      i += 1;
      while (i < lines.length && !/^```\s*$/.test(lines[i])) { buf.push(lines[i]); i += 1; }
      i += 1; // consume closing fence (or EOF)
      const cls = lang ? ` class="lang-${escapeHtml(lang)}"` : "";
      html.push(`<pre><code${cls}>${buf.join("\n")}</code></pre>`);
      continue;
    }
    // Horizontal rule.
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) {
      flushPara(); closeList(); closeQuote();
      html.push("<hr>");
      i += 1; continue;
    }
    // ATX heading.
    const h = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
    if (h) {
      flushPara(); closeList(); closeQuote();
      const lvl = h[1].length;
      html.push(`<h${lvl}>${renderInline(h[2])}</h${lvl}>`);
      i += 1; continue;
    }
    // Blockquote.
    const bq = /^&gt;\s?(.*)$/.exec(line);
    if (bq) {
      flushPara(); closeList();
      if (!inQuote) { html.push("<blockquote>"); inQuote = true; }
      html.push(`<p>${renderInline(bq[1])}</p>`);
      i += 1; continue;
    } else if (inQuote && line.trim() === "") {
      closeQuote(); i += 1; continue;
    } else if (inQuote) {
      closeQuote();
    }
    // Lists.
    const ul = /^\s*[-*]\s+(.+)$/.exec(line);
    const ol = /^\s*\d+\.\s+(.+)$/.exec(line);
    if (ul || ol) {
      flushPara();
      const want = ul ? "ul" : "ol";
      if (inList && listTag !== want) closeList();
      if (!inList) { html.push(`<${want}>`); inList = true; listTag = want; }
      html.push(`<li>${renderInline((ul || ol)[1])}</li>`);
      i += 1; continue;
    } else if (inList && line.trim() === "") {
      closeList(); i += 1; continue;
    } else if (inList) {
      closeList();
    }
    // Blank line ends paragraph.
    if (line.trim() === "") { flushPara(); i += 1; continue; }
    para.push(line.trim());
    i += 1;
  }
  flushPara(); closeList(); closeQuote();
  return html.join("\n");
}

function filterRecentRepos(recents, query) {
  const q = String(query || "").trim().toLowerCase();
  if (!q) return recents.slice();
  return recents.filter((r) => r.value.toLowerCase().includes(q));
}

// ---------------------------------------------------------------------------
// Drafts — save in-progress issues locally before posting
// ---------------------------------------------------------------------------

function makeDraftId() {
  const r = (globalThis.crypto?.randomUUID && crypto.randomUUID()) || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  return `d_${r}`;
}

function normalizeDrafts(list) {
  if (!Array.isArray(list)) return [];
  const out = [];
  const seen = new Set();
  for (const raw of list) {
    if (!raw || typeof raw !== "object") continue;
    const id = typeof raw.id === "string" && raw.id ? raw.id : makeDraftId();
    if (seen.has(id)) continue;
    seen.add(id);
    const title = String(raw.title || "").slice(0, 256);
    const repo = String(raw.repo || "").slice(0, 220);
    const labels = String(raw.labels || "").slice(0, 512);
    const body = String(raw.body || "").slice(0, MAX_DRAFT_BODY_LEN);
    const quote = raw.quote && typeof raw.quote === "object" ? raw.quote : null;
    const createdAt = typeof raw.createdAt === "string" ? raw.createdAt : new Date().toISOString();
    const updatedAt = typeof raw.updatedAt === "string" ? raw.updatedAt : createdAt;
    if (!title.trim() && !body.trim() && !(quote && quote.selectionText)) continue;
    out.push({ id, title, repo, labels, body, quote, createdAt, updatedAt });
  }
  out.sort((a, b) => (Date.parse(b.updatedAt) || 0) - (Date.parse(a.updatedAt) || 0));
  return out.slice(0, MAX_DRAFTS);
}

async function getDrafts() {
  if (!chrome?.storage?.local) return [];
  const out = await chrome.storage.local.get(STORAGE_KEYS.drafts);
  return normalizeDrafts(out[STORAGE_KEYS.drafts]);
}

async function saveDraft(draft) {
  if (!chrome?.storage?.local) throw new Error("storage unavailable");
  const cur = await getDrafts();
  const now = new Date().toISOString();
  const id = draft?.id || makeDraftId();
  const without = cur.filter((d) => d.id !== id);
  const merged = normalizeDrafts([
    { ...draft, id, createdAt: draft?.createdAt || now, updatedAt: now },
    ...without,
  ]);
  await chrome.storage.local.set({ [STORAGE_KEYS.drafts]: merged });
  return merged.find((d) => d.id === id) || merged[0];
}

async function deleteDraft(id) {
  if (!id || !chrome?.storage?.local) return;
  const cur = await getDrafts();
  await chrome.storage.local.set({ [STORAGE_KEYS.drafts]: cur.filter((d) => d.id !== id) });
}

// ---------------------------------------------------------------------------
// Bulk batch — file many selections against one repo in a single popup pass
// ---------------------------------------------------------------------------

function normalizeBulkQuotes(list) {
  if (!Array.isArray(list)) return [];
  const out = [];
  const seen = new Set();
  for (const raw of list) {
    if (!raw || typeof raw !== "object") continue;
    const selectionText = String(raw.selectionText || "").slice(0, 16_000);
    if (!selectionText.trim()) continue;
    const pageUrl = String(raw.pageUrl || "").slice(0, 2048);
    const fp = `${pageUrl}::${selectionText.replace(/\s+/g, " ").trim().slice(0, 200)}`;
    if (seen.has(fp)) continue;
    seen.add(fp);
    const id = typeof raw.id === "string" && raw.id ? raw.id : `b_${Date.now().toString(36)}_${out.length}`;
    out.push({
      id,
      selectionText,
      contextBefore: String(raw.contextBefore || "").slice(0, 4000),
      contextAfter: String(raw.contextAfter || "").slice(0, 4000),
      nearestHeading: String(raw.nearestHeading || "").slice(0, 256),
      pageUrl,
      pageTitle: String(raw.pageTitle || "").slice(0, 512),
      screenshot: raw.screenshot && typeof raw.screenshot === "object" ? raw.screenshot : null,
      capturedAt: typeof raw.capturedAt === "string" ? raw.capturedAt : new Date().toISOString(),
    });
    if (out.length >= MAX_BULK_QUOTES) break;
  }
  return out;
}

async function getBulkQuotes() {
  if (!chrome?.storage?.local) return [];
  const out = await chrome.storage.local.get(STORAGE_KEYS.bulkQuotes);
  return normalizeBulkQuotes(out[STORAGE_KEYS.bulkQuotes]);
}

async function setBulkQuotes(list) {
  if (!chrome?.storage?.local) return;
  await chrome.storage.local.set({ [STORAGE_KEYS.bulkQuotes]: normalizeBulkQuotes(list) });
}

async function removeBulkQuote(id) {
  if (!id) return;
  const cur = await getBulkQuotes();
  await setBulkQuotes(cur.filter((q) => q.id !== id));
}

async function clearBulkQuotes() {
  if (!chrome?.storage?.local) return;
  await chrome.storage.local.remove(STORAGE_KEYS.bulkQuotes);
}

async function loadBulkState() {
  if (!chrome?.storage?.local) return {};
  const out = await chrome.storage.local.get(STORAGE_KEYS.bulkState);
  return out[STORAGE_KEYS.bulkState] || {};
}

async function saveBulkState(patch) {
  if (!chrome?.storage?.local) return;
  const prev = await loadBulkState();
  await chrome.storage.local.set({ [STORAGE_KEYS.bulkState]: { ...prev, ...patch } });
}

async function getRecentRepos() {
  if (!chrome?.storage?.local) return [];
  const out = await chrome.storage.local.get(STORAGE_KEYS.recentRepos);
  return normalizeRecentRepos(out[STORAGE_KEYS.recentRepos]);
}

async function setRecentRepos(list) {
  if (!chrome?.storage?.local) return;
  await chrome.storage.local.set({ [STORAGE_KEYS.recentRepos]: normalizeRecentRepos(list) });
}

async function addRecentRepo(value) {
  const parsed = parseRepo(value);
  if (!parsed.ok) return null;
  const now = new Date().toISOString();
  const current = await getRecentRepos();
  const next = [{ value: parsed.value, lastUsed: now }, ...current.filter((r) => r.value.toLowerCase() !== parsed.value.toLowerCase())].slice(0, MAX_RECENT_REPOS);
  await setRecentRepos(next);
  return parsed.value;
}

async function removeRecentRepo(value) {
  const v = String(value || "").toLowerCase();
  if (!v) return;
  const current = await getRecentRepos();
  await setRecentRepos(current.filter((r) => r.value.toLowerCase() !== v));
}

async function dataUrlToBlob(dataUrl) {
  if (typeof fetch === "function") {
    const r = await fetch(dataUrl);
    return await r.blob();
  }
  const [head, body] = String(dataUrl).split(",");
  const mime = (head.match(/data:([^;]+)/) || [, "image/png"])[1];
  const bin = atob(body);
  const buf = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
  return new Blob([buf], { type: mime });
}

// expose for tests
if (typeof globalThis !== "undefined") {
  globalThis.__qti = {
    parseRepo, parseLabels, deriveTitle, buildMarkdownBody, buildSourceUrlWithAnchor, deriveScreenshotFilename,
    formatBytes, normalizeRecentRepos, filterRecentRepos,
    normalizeRepoTemplates, renderTemplate, DEFAULT_TEMPLATE, MAX_TEMPLATE_LEN,
    normalizeDrafts, MAX_DRAFTS,
    normalizeBulkQuotes, MAX_BULK_QUOTES,
    renderMarkdownPreview, escapeHtml,
  };
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function renderEmpty() {
  const frag = document.createDocumentFragment();
  frag.appendChild(tplEmpty.content.cloneNode(true));
  root.replaceChildren(frag);
  // Append drafts list if any exist.
  getDrafts().then((drafts) => {
    if (!drafts.length) return;
    if (!tplDrafts || !tplDraftRow) return;
    const section = tplDrafts.content.cloneNode(true);
    const list = section.querySelector("[data-drafts-list]");
    const count = section.querySelector('[data-field="drafts-count"]');
    if (count) count.textContent = `${drafts.length} · newest first`;
    for (const d of drafts) {
      const row = tplDraftRow.content.cloneNode(true);
      const titleEl = row.querySelector('[data-field="draft-title"]');
      const repoEl = row.querySelector('[data-field="draft-repo"]');
      const timeEl = row.querySelector('[data-field="draft-time"]');
      const snipEl = row.querySelector('[data-field="draft-snippet"]');
      titleEl.textContent = d.title || "(untitled draft)";
      repoEl.textContent = d.repo || "no repo";
      timeEl.textContent = fmtRelative(d.updatedAt);
      const snippet = (d.quote?.selectionText || d.body || "").replace(/\s+/g, " ").trim().slice(0, 120);
      snipEl.textContent = snippet;
      row.querySelector('[data-action="load-draft"]').addEventListener("click", () => loadDraft(d));
      row.querySelector('[data-action="delete-draft"]').addEventListener("click", async (e) => {
        e.preventDefault(); e.stopPropagation();
        await deleteDraft(d.id);
        renderEmpty();
      });
      list.appendChild(row);
    }
    root.appendChild(section);
  }).catch(() => {});
}

async function loadDraft(draft) {
  if (!draft) return;
  const q = draft.quote && draft.quote.selectionText ? draft.quote : {
    selectionText: "",
    pageUrl: "",
    pageTitle: "",
    capturedAt: draft.createdAt || new Date().toISOString(),
  };
  if (chrome?.storage?.local && draft.quote?.selectionText) {
    await chrome.storage.local.set({ [STORAGE_KEYS.pendingQuote]: draft.quote });
  }
  await saveFormState({
    repo: draft.repo || "",
    title: draft.title || "",
    labels: draft.labels || "",
    draftId: draft.id,
  });
  const frag = document.createDocumentFragment();
  if (draft.quote?.selectionText) frag.appendChild(renderQuoteCard(draft.quote));
  frag.appendChild(buildFormNode(q, {
    repo: draft.repo, title: draft.title, labels: draft.labels, draftId: draft.id,
  }));
  root.replaceChildren(frag);
}

function renderQuoteCard(q) {
  const node = tplQuote.content.cloneNode(true);
  const setText = (field, text) => {
    const el = node.querySelector(`[data-field="${field}"]`);
    if (el) el.textContent = text ?? "";
    return el;
  };

  setText("selectionText", q.selectionText || "");

  const ctx = node.querySelector("[data-context]");
  if (q.contextBefore || q.contextAfter) {
    setText("contextBefore", q.contextBefore ? `…${q.contextBefore} ` : "");
    setText("hi", q.selectionText ? `\u201C${q.selectionText.slice(0, 120)}${q.selectionText.length > 120 ? "\u2026" : ""}\u201D` : "");
    setText("contextAfter", q.contextAfter ? ` ${q.contextAfter}\u2026` : "");
    ctx.hidden = false;
  }

  const link = node.querySelector('[data-field="pageLink"]');
  if (link) {
    // Prefer the Scroll-To-Text-Fragment anchor so clicking the source link
    // jumps the user back to the exact passage they captured.
    link.href = buildSourceUrlWithAnchor(q) || q.pageUrl || "#";
    link.textContent = q.pageTitle || hostnameOf(q.pageUrl) || q.pageUrl || "(unknown source)";
    link.title = q.pageUrl || "";
  }

  if (q.nearestHeading) {
    node.querySelector("[data-heading-row]").hidden = false;
    setText("nearestHeading", q.nearestHeading);
  }

  setText("capturedAtPretty", fmtTime(q.capturedAt));

  const shot = q.screenshot;
  const shotFig = node.querySelector("[data-shot]");
  if (shot?.dataUrl && shotFig) {
    const img = node.querySelector('[data-field="shotImg"]');
    if (img) img.src = shot.dataUrl;
    const cap = node.querySelector('[data-field="shotCaption"]');
    if (cap) {
      const parts = [];
      if (shot.width && shot.height) parts.push(`${shot.width}×${shot.height}`);
      const sz = formatBytes(shot.bytes);
      if (sz) parts.push(sz);
      parts.push("PNG");
      cap.textContent = parts.join(" · ");
    }
    shotFig.hidden = false;

    const copyBtn = node.querySelector('[data-action="copy-shot"]');
    const dlBtn = node.querySelector('[data-action="download-shot"]');
    copyBtn?.addEventListener("click", async () => {
      const orig = copyBtn.querySelector("span")?.textContent;
      try {
        const blob = await dataUrlToBlob(shot.dataUrl);
        if (!navigator.clipboard?.write || typeof ClipboardItem === "undefined") {
          throw new Error("Clipboard image write not supported");
        }
        await navigator.clipboard.write([new ClipboardItem({ [blob.type || "image/png"]: blob })]);
        copyBtn.classList.add("ok");
        if (copyBtn.querySelector("span")) copyBtn.querySelector("span").textContent = "Copied";
        setTimeout(() => {
          copyBtn.classList.remove("ok");
          if (copyBtn.querySelector("span") && orig) copyBtn.querySelector("span").textContent = orig;
        }, 1400);
      } catch (err) {
        copyBtn.classList.add("err");
        if (copyBtn.querySelector("span")) copyBtn.querySelector("span").textContent = "Failed";
        setTimeout(() => {
          copyBtn.classList.remove("err");
          if (copyBtn.querySelector("span") && orig) copyBtn.querySelector("span").textContent = orig;
        }, 1600);
        console.warn(LOG, "copy screenshot failed", err);
      }
    });
    dlBtn?.addEventListener("click", () => {
      const a = document.createElement("a");
      a.href = shot.dataUrl;
      a.download = deriveScreenshotFilename(q);
      a.rel = "noopener";
      document.body.appendChild(a);
      a.click();
      a.remove();
    });
  }

  node.querySelector('[data-action="clear"]')?.addEventListener("click", async () => {
    await chrome.storage?.local?.remove?.(STORAGE_KEYS.pendingQuote);
    renderEmpty();
  });

  return node;
}

async function loadFormState() {
  if (!chrome?.storage?.local) return {};
  const out = await chrome.storage.local.get(STORAGE_KEYS.formState);
  return out[STORAGE_KEYS.formState] || {};
}

async function saveFormState(patch) {
  if (!chrome?.storage?.local) return;
  const prev = await loadFormState();
  const next = { ...prev, ...patch };
  await chrome.storage.local.set({ [STORAGE_KEYS.formState]: next });
}

function renderLabelChips(container, labels) {
  container.replaceChildren();
  for (const label of labels) {
    const chip = document.createElement("span");
    chip.className = "chip";
    chip.textContent = label;
    container.appendChild(chip);
  }
}

function buildFormNode(q, state) {
  const node = tplForm.content.cloneNode(true);
  const repoInput = node.querySelector('[data-field="repo"]');
  const titleInput = node.querySelector('[data-field="title"]');
  const labelsInput = node.querySelector('[data-field="labels"]');
  const repoHint = node.querySelector('[data-field="repo-hint"]');
  const chipRow = node.querySelector('[data-field="label-chips"]');
  const previewBox = node.querySelector("[data-preview]");
  const previewBody = node.querySelector('[data-field="preview-body"]');
  const previewRendered = node.querySelector('[data-field="preview-rendered"]');
  const previewTabs = node.querySelectorAll('[data-action="preview-mode"]');
  const toggleBtn = node.querySelector('[data-action="toggle-preview"]');
  let previewMode = "rendered";
  const submitBtn = node.querySelector('[data-action="submit"]');
  const saveDraftBtn = node.querySelector('[data-action="save-draft"]');
  const draftStatus = node.querySelector('[data-field="draft-status"]');
  let activeDraftId = state.draftId || null;
  const recentsBtn = node.querySelector('[data-action="toggle-recents"]');
  const recentsPanel = node.querySelector('[data-field="repo-recents"]');
  const tmplBlock = node.querySelector("[data-template-block]");
  const tmplToggle = node.querySelector('[data-action="toggle-template"]');
  const tmplBody = node.querySelector('[data-field="template-body"]');
  const tmplHint = node.querySelector('[data-field="template-hint"]');
  const tmplSave = node.querySelector('[data-action="save-template"]');
  const tmplClear = node.querySelector('[data-action="clear-template"]');
  const tmplDefault = node.querySelector('[data-action="insert-default-template"]');
  const tmplStatus = node.querySelector('[data-field="template-status"]');

  // Per-repo template state, refreshed whenever the repo field changes.
  let activeTemplate = null;
  let tmplOpen = false;
  let tmplDirty = false;

  // Recent repos dropdown state (cached and re-rendered on demand).
  let recents = [];
  let recentsOpen = false;
  let activeRecentIndex = -1;

  function renderRecentsList() {
    if (!recentsPanel) return;
    recentsPanel.replaceChildren();
    const filtered = filterRecentRepos(recents, repoInput.value);
    if (filtered.length === 0) {
      const empty = document.createElement("div");
      empty.className = "repo-recents-empty";
      empty.textContent = recents.length === 0 ? "No recent repositories yet." : "No matches.";
      recentsPanel.appendChild(empty);
      activeRecentIndex = -1;
      return;
    }
    const label = document.createElement("div");
    label.className = "recents-label";
    label.textContent = "Recent";
    recentsPanel.appendChild(label);
    filtered.forEach((entry, idx) => {
      const row = document.createElement("button");
      row.type = "button";
      row.className = "repo-recent";
      row.setAttribute("role", "option");
      row.setAttribute("data-value", entry.value);
      if (idx === activeRecentIndex) row.setAttribute("aria-selected", "true");
      row.innerHTML = `
        <svg class="repo-recent-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <circle cx="12" cy="12" r="9"></circle>
          <path d="M12 7v5l3 2"></path>
        </svg>
        <span class="repo-recent-value"></span>
        <span class="repo-recent-time"></span>
        <span class="repo-recent-remove" role="button" tabindex="0" aria-label="Remove" title="Remove">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M6 6l12 12"></path><path d="M18 6L6 18"></path>
          </svg>
        </span>`;
      row.querySelector(".repo-recent-value").textContent = entry.value;
      row.querySelector(".repo-recent-time").textContent = entry.lastUsed ? fmtRelative(entry.lastUsed) : "";
      row.addEventListener("mousedown", (e) => {
        // Avoid mousedown stealing focus before we react to click.
        if (e.target.closest(".repo-recent-remove")) return;
        e.preventDefault();
      });
      row.addEventListener("click", (e) => {
        if (e.target.closest(".repo-recent-remove")) {
          e.stopPropagation();
          e.preventDefault();
          removeRecentRepo(entry.value).then(refreshRecents);
          return;
        }
        chooseRecent(entry.value);
      });
      const removeEl = row.querySelector(".repo-recent-remove");
      removeEl.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault(); e.stopPropagation();
          removeRecentRepo(entry.value).then(refreshRecents);
        }
      });
      recentsPanel.appendChild(row);
    });
  }

  function openRecents() {
    if (!recentsPanel) return;
    if (recents.length === 0) return;
    recentsOpen = true;
    recentsPanel.hidden = false;
    repoInput.setAttribute("aria-expanded", "true");
    recentsBtn?.setAttribute("aria-pressed", "true");
    renderRecentsList();
  }

  function closeRecents() {
    if (!recentsPanel) return;
    recentsOpen = false;
    recentsPanel.hidden = true;
    repoInput.setAttribute("aria-expanded", "false");
    recentsBtn?.setAttribute("aria-pressed", "false");
    activeRecentIndex = -1;
  }

  function chooseRecent(value) {
    repoInput.value = value;
    saveFormState({ repo: value });
    validateRepo();
    closeRecents();
    refreshSubmitState();
    titleInput.focus();
  }

  async function refreshRecents() {
    recents = await getRecentRepos().catch(() => []);
    if (recentsBtn) recentsBtn.hidden = recents.length === 0;
    if (recents.length === 0) closeRecents();
    else if (recentsOpen) renderRecentsList();
  }

  repoInput.value = state.repo || "";
  titleInput.value = state.title || deriveTitle(q);
  labelsInput.value = state.labels || "";
  renderLabelChips(chipRow, parseLabels(labelsInput.value));
  previewBody.textContent = buildMarkdownBody(q);
  if (previewRendered) previewRendered.innerHTML = renderMarkdownPreview(buildMarkdownBody(q));

  function effectiveBody() {
    return activeTemplate && activeTemplate.body
      ? renderTemplate(activeTemplate.body, q)
      : buildMarkdownBody(q);
  }

  function refreshPreviewIfOpen() {
    if (previewBox.hidden) return;
    const body = effectiveBody();
    previewBody.textContent = body;
    if (previewRendered) previewRendered.innerHTML = renderMarkdownPreview(body);
  }

  function setPreviewMode(mode) {
    previewMode = mode === "source" ? "source" : "rendered";
    if (previewRendered) previewRendered.hidden = previewMode !== "rendered";
    if (previewBody) previewBody.hidden = previewMode !== "source";
    for (const t of previewTabs) {
      t.setAttribute("aria-selected", String(t.dataset.mode === previewMode));
    }
  }
  setPreviewMode(previewMode);
  for (const t of previewTabs) {
    t.addEventListener("click", (e) => {
      e.preventDefault();
      setPreviewMode(t.dataset.mode);
      refreshPreviewIfOpen();
    });
  }

  function refreshTemplateStatus() {
    if (!tmplStatus) return;
    const repoParsed = parseRepo(repoInput.value);
    if (!repoParsed.ok) {
      tmplStatus.textContent = "Enter a repo to manage its template.";
      tmplStatus.dataset.state = "empty";
      if (tmplSave) tmplSave.disabled = true;
      if (tmplClear) tmplClear.disabled = true;
      return;
    }
    if (activeTemplate) {
      tmplStatus.dataset.state = "saved";
      tmplStatus.textContent = `Using template for ${repoParsed.value} \u00b7 saved ${fmtRelative(activeTemplate.updatedAt)}`;
      if (tmplClear) tmplClear.disabled = false;
    } else {
      tmplStatus.dataset.state = "empty";
      tmplStatus.textContent = `No template for ${repoParsed.value}. Default body in use.`;
      if (tmplClear) tmplClear.disabled = true;
    }
    if (tmplSave) tmplSave.disabled = !tmplDirty || !tmplBody?.value.trim();
  }

  async function loadTemplateForRepo() {
    const repoParsed = parseRepo(repoInput.value);
    if (!repoParsed.ok) {
      activeTemplate = null;
      if (tmplBody) tmplBody.value = "";
      tmplDirty = false;
      refreshTemplateStatus();
      refreshPreviewIfOpen();
      return;
    }
    activeTemplate = await getRepoTemplate(repoParsed.value).catch(() => null);
    if (tmplBody) {
      tmplBody.value = activeTemplate?.body || "";
      tmplDirty = false;
    }
    refreshTemplateStatus();
    refreshPreviewIfOpen();
  }

  tmplToggle?.addEventListener("click", (e) => {
    e.preventDefault();
    tmplOpen = !tmplOpen;
    if (tmplBlock) tmplBlock.hidden = !tmplOpen;
    tmplToggle.setAttribute("aria-expanded", String(tmplOpen));
  });
  tmplBody?.addEventListener("input", () => {
    tmplDirty = (tmplBody.value || "") !== (activeTemplate?.body || "");
    if (tmplHint) {
      const remaining = MAX_TEMPLATE_LEN - tmplBody.value.length;
      tmplHint.textContent = remaining < 500
        ? `${remaining} characters left`
        : "Placeholders: {{quote}}, {{quote_blockquote}}, {{source_title}}, {{source_url}}, {{section}}, {{captured}}, {{screenshot_note}}.";
      tmplHint.classList.remove("error");
    }
    refreshTemplateStatus();
  });
  tmplDefault?.addEventListener("click", (e) => {
    e.preventDefault();
    if (!tmplBody) return;
    tmplBody.value = DEFAULT_TEMPLATE;
    tmplBody.dispatchEvent(new Event("input", { bubbles: true }));
    tmplBody.focus();
  });
  tmplSave?.addEventListener("click", async (e) => {
    e.preventDefault();
    const repoParsed = parseRepo(repoInput.value);
    if (!repoParsed.ok || !tmplBody) return;
    tmplSave.disabled = true;
    try {
      activeTemplate = await setRepoTemplate(repoParsed.value, tmplBody.value);
      tmplDirty = false;
      if (tmplHint) {
        tmplHint.textContent = "Template saved.";
        tmplHint.classList.remove("error");
      }
      refreshTemplateStatus();
      refreshPreviewIfOpen();
    } catch (err) {
      if (tmplHint) {
        tmplHint.textContent = `Save failed: ${err?.message || err}`;
        tmplHint.classList.add("error");
      }
      tmplSave.disabled = false;
    }
  });
  tmplClear?.addEventListener("click", async (e) => {
    e.preventDefault();
    const repoParsed = parseRepo(repoInput.value);
    if (!repoParsed.ok) return;
    await clearRepoTemplate(repoParsed.value).catch(() => {});
    activeTemplate = null;
    if (tmplBody) tmplBody.value = "";
    tmplDirty = false;
    if (tmplHint) {
      tmplHint.textContent = "Template cleared. Default body restored.";
      tmplHint.classList.remove("error");
    }
    refreshTemplateStatus();
    refreshPreviewIfOpen();
  });

  const validateRepo = () => {
    const r = parseRepo(repoInput.value);
    repoInput.setAttribute("aria-invalid", r.value && !r.ok ? "true" : "false");
    if (repoInput.value.trim() === "") {
      repoHint.textContent = "e.g. vercel/next.js";
      repoHint.classList.remove("error");
    } else if (!r.ok) {
      repoHint.textContent = r.error || "Use the form owner/name";
      repoHint.classList.add("error");
    } else {
      repoHint.textContent = `Will file at github.com/${r.value}`;
      repoHint.classList.remove("error");
    }
    return r.ok;
  };

  validateRepo();
  loadTemplateForRepo();

  repoInput.addEventListener("input", () => {
    validateRepo();
    saveFormState({ repo: repoInput.value });
    activeRecentIndex = -1;
    if (recentsOpen) renderRecentsList();
    else if (recents.length > 0 && document.activeElement === repoInput) openRecents();
    loadTemplateForRepo();
  });
  repoInput.addEventListener("focus", () => {
    if (recents.length > 0) openRecents();
  });
  repoInput.addEventListener("blur", () => {
    // Delay so click handlers on recents can fire.
    setTimeout(() => {
      if (document.activeElement !== repoInput && !recentsPanel?.contains(document.activeElement)) {
        closeRecents();
      }
    }, 120);
  });
  repoInput.addEventListener("keydown", (e) => {
    if (!recentsOpen && (e.key === "ArrowDown" || e.key === "Down")) {
      if (recents.length > 0) { e.preventDefault(); openRecents(); activeRecentIndex = 0; renderRecentsList(); }
      return;
    }
    if (!recentsOpen) return;
    const rows = recentsPanel?.querySelectorAll(".repo-recent") || [];
    if (e.key === "ArrowDown" || e.key === "Down") {
      e.preventDefault();
      activeRecentIndex = rows.length === 0 ? -1 : (activeRecentIndex + 1) % rows.length;
      renderRecentsList();
    } else if (e.key === "ArrowUp" || e.key === "Up") {
      e.preventDefault();
      activeRecentIndex = rows.length === 0 ? -1 : (activeRecentIndex - 1 + rows.length) % rows.length;
      renderRecentsList();
    } else if (e.key === "Enter") {
      if (activeRecentIndex >= 0 && rows[activeRecentIndex]) {
        e.preventDefault();
        const v = rows[activeRecentIndex].getAttribute("data-value");
        if (v) chooseRecent(v);
      }
    } else if (e.key === "Escape") {
      e.preventDefault();
      closeRecents();
    }
  });
  recentsBtn?.addEventListener("click", (e) => {
    e.preventDefault();
    if (recentsOpen) closeRecents();
    else { repoInput.focus(); openRecents(); }
  });
  titleInput.addEventListener("input", () => saveFormState({ title: titleInput.value }));
  labelsInput.addEventListener("input", () => {
    renderLabelChips(chipRow, parseLabels(labelsInput.value));
    saveFormState({ labels: labelsInput.value });
  });

  // --- Draft save ----------------------------------------------------------
  function showDraftStatus(msg, kind) {
    if (!draftStatus) return;
    draftStatus.textContent = msg;
    draftStatus.dataset.kind = kind || "ok";
    draftStatus.hidden = !msg;
    if (msg) {
      clearTimeout(showDraftStatus._t);
      showDraftStatus._t = setTimeout(() => { draftStatus.hidden = true; }, 2400);
    }
  }
  function refreshDraftBtn() {
    if (!saveDraftBtn) return;
    const hasContent = (titleInput.value.trim() || labelsInput.value.trim() || (q?.selectionText || "").trim());
    saveDraftBtn.disabled = !hasContent;
  }
  refreshDraftBtn();
  titleInput.addEventListener("input", refreshDraftBtn);
  labelsInput.addEventListener("input", refreshDraftBtn);
  repoInput.addEventListener("input", refreshDraftBtn);

  saveDraftBtn?.addEventListener("click", async (e) => {
    e.preventDefault();
    if (saveDraftBtn.disabled) return;
    saveDraftBtn.disabled = true;
    try {
      const saved = await saveDraft({
        id: activeDraftId,
        title: titleInput.value.trim(),
        repo: repoInput.value.trim(),
        labels: labelsInput.value,
        body: effectiveBody(),
        quote: q || null,
      });
      activeDraftId = saved?.id || activeDraftId;
      await saveFormState({ draftId: activeDraftId });
      showDraftStatus("Draft saved locally.", "ok");
    } catch (err) {
      showDraftStatus(`Save failed: ${err?.message || err}`, "err");
    } finally {
      refreshDraftBtn();
    }
  });

  toggleBtn.addEventListener("click", () => {
    const shown = !previewBox.hidden;
    previewBox.hidden = shown;
    toggleBtn.setAttribute("aria-pressed", String(!shown));
    if (!shown) refreshPreviewIfOpen();
  });

  submitBtn.title = "Create a GitHub issue with the captured quote";

  let submitting = false;
  const errorEl = document.createElement("p");
  errorEl.className = "field-hint error submit-error";
  errorEl.hidden = true;
  submitBtn.parentElement?.parentElement?.insertBefore(errorEl, submitBtn.parentElement);

  async function doSubmit() {
    if (submitting) return;
    const repo = parseRepo(repoInput.value);
    const title = titleInput.value.trim();
    if (!repo.ok || !title) {
      validateRepo();
      if (!title) titleInput.focus();
      return;
    }
    if (!(await hasToken())) {
      errorEl.hidden = false;
      errorEl.textContent = "Add a GitHub token in settings first.";
      return;
    }
    submitting = true;
    submitBtn.disabled = true;
    submitBtn.classList.add("loading");
    errorEl.hidden = true;
    try {
      const reply = await chrome.runtime.sendMessage({
        type: "submitIssue",
        repo: repo.value,
        title,
        body: effectiveBody(),
        labels: parseLabels(labelsInput.value),
      });
      if (!reply?.ok) throw new Error(reply?.error || "Unknown error");
      const created = reply.result || {};
      await addRecentRepo(repo.value).catch(() => {});
      if (activeDraftId) await deleteDraft(activeDraftId).catch(() => {});
      await chrome.storage?.local?.remove?.(STORAGE_KEYS.pendingQuote);
      await saveFormState({ title: "", draftId: null });
      renderSuccess({ repo: repo.value, ...created });
    } catch (err) {
      errorEl.hidden = false;
      errorEl.textContent = String(err?.message || err);
      submitBtn.disabled = false;
      submitBtn.classList.remove("loading");
    } finally {
      submitting = false;
    }
  }

  submitBtn.addEventListener("click", doSubmit);

  // Reflect token presence on submit hint and enable submission when ready.
  hasToken().then((has) => {
    const hint = node.querySelector('[data-field="submit-hint"]');
    if (hint) {
      hint.textContent = has
        ? "Ready to file. Submission posts to the GitHub Issues API."
        : "Add a GitHub token in settings to enable submission.";
    }
    const repoOk = parseRepo(repoInput.value).ok;
    submitBtn.disabled = !(has && repoOk && titleInput.value.trim());
  }).catch(() => {});

  const refreshSubmitState = async () => {
    const has = await hasToken().catch(() => false);
    const repoOk = parseRepo(repoInput.value).ok;
    submitBtn.disabled = !(has && repoOk && titleInput.value.trim());
  };
  repoInput.addEventListener("input", refreshSubmitState);
  titleInput.addEventListener("input", refreshSubmitState);

  // Kick off the recents fetch — reveals the toggle and primes the dropdown.
  refreshRecents();

  return node;
}

// ---------------------------------------------------------------------------
// Settings panel — encrypted GitHub PAT storage
// ---------------------------------------------------------------------------

function fmtRelative(iso) {
  if (!iso) return "";
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return iso;
  const diff = Math.max(0, Date.now() - t);
  const min = Math.round(diff / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const hrs = Math.round(min / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  return `${days}d ago`;
}

async function renderSettings() {
  if (!tplSettings) return;
  const node = tplSettings.content.cloneNode(true);
  const panel = node.querySelector("[data-settings]");
  const tokenInput = node.querySelector('[data-field="token"]');
  const tokenHint = node.querySelector('[data-field="token-hint"]');
  const statusEl = node.querySelector('[data-field="token-status"]');
  const statusText = node.querySelector('[data-field="token-status-text"]');
  const saveBtn = node.querySelector('[data-action="save-token"]');
  const clearBtn = node.querySelector('[data-action="clear-token"]');
  const revealBtn = node.querySelector('[data-action="reveal-token"]');
  const closeBtn = node.querySelector('[data-action="close-settings"]');

  async function refreshStatus() {
    const info = await getTokenInfo().catch(() => null);
    if (info) {
      statusEl.dataset.state = "saved";
      const tail = info.tail ? `\u2022\u2022\u2022\u2022${info.tail}` : "\u2022\u2022\u2022\u2022";
      const when = info.createdAt ? ` \u00b7 saved ${fmtRelative(info.createdAt)}` : "";
      statusText.textContent = `Token saved (${tail})${when}`;
      clearBtn.disabled = false;
    } else {
      statusEl.dataset.state = "empty";
      statusText.textContent = "No token saved";
      clearBtn.disabled = true;
    }
  }

  function validate() {
    const v = tokenInput.value.trim();
    if (!v) {
      tokenHint.textContent = "Token never leaves this machine.";
      tokenHint.classList.remove("error");
      saveBtn.disabled = true;
      return false;
    }
    if (!looksLikeGithubToken(v)) {
      tokenHint.textContent = "That doesn't look like a GitHub token.";
      tokenHint.classList.add("error");
      saveBtn.disabled = true;
      return false;
    }
    tokenHint.textContent = `Will save ${previewToken(v)} encrypted.`;
    tokenHint.classList.remove("error");
    saveBtn.disabled = false;
    return true;
  }

  tokenInput.addEventListener("input", validate);
  tokenInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !saveBtn.disabled) {
      e.preventDefault();
      saveBtn.click();
    }
  });

  revealBtn.addEventListener("click", () => {
    const showing = tokenInput.type === "text";
    tokenInput.type = showing ? "password" : "text";
    revealBtn.setAttribute("aria-pressed", String(!showing));
  });

  saveBtn.addEventListener("click", async () => {
    if (!validate()) return;
    saveBtn.disabled = true;
    try {
      await setToken(tokenInput.value.trim());
      tokenInput.value = "";
      tokenInput.type = "password";
      revealBtn.setAttribute("aria-pressed", "false");
      tokenHint.textContent = "Token saved.";
      tokenHint.classList.remove("error");
      await refreshStatus();
    } catch (err) {
      tokenHint.textContent = `Save failed: ${err?.message || err}`;
      tokenHint.classList.add("error");
      saveBtn.disabled = false;
    }
  });

  clearBtn.addEventListener("click", async () => {
    await clearToken().catch(() => {});
    tokenInput.value = "";
    tokenHint.textContent = "Token cleared.";
    tokenHint.classList.remove("error");
    await refreshStatus();
  });

  closeBtn.addEventListener("click", () => {
    settingsOpen = false;
    loadPending();
  });

  await refreshStatus();
  root.replaceChildren(panel);
  tokenInput.focus?.();
}

function renderSuccess(info) {
  if (!tplSuccess) return;
  const node = tplSuccess.content.cloneNode(true);
  const sub = node.querySelector('[data-field="success-sub"]');
  const link = node.querySelector('[data-field="success-link"]');
  const repo = info?.repo || "";
  const num = info?.number;
  sub.textContent = num != null && repo
    ? `${repo} #${num} created on GitHub.`
    : `Issue created${repo ? " on " + repo : ""}.`;
  if (info?.htmlUrl) link.href = info.htmlUrl;
  else { link.removeAttribute("href"); link.classList.add("disabled"); }
  node.querySelector('[data-action="file-another"]').addEventListener("click", () => {
    loadPending();
  });
  root.replaceChildren(node);
}

function renderQuote(q) {
  const frag = document.createDocumentFragment();
  frag.appendChild(renderQuoteCard(q));
  loadFormState().then((state) => {
    frag.appendChild(buildFormNode(q, state));
    root.replaceChildren(frag);
  }).catch(() => {
    frag.appendChild(buildFormNode(q, {}));
    root.replaceChildren(frag);
  });
}

async function loadPending() {
  if (settingsOpen) return;
  if (!chrome?.storage?.local) return renderEmpty();
  const out = await chrome.storage.local.get(STORAGE_KEYS.pendingQuote);
  const q = out[STORAGE_KEYS.pendingQuote];
  if (q && q.selectionText) renderQuote(q);
  else renderEmpty();
  await appendBulkSection();
}

async function appendBulkSection() {
  if (!tplBulk || !tplBulkRow) return;
  // Remove any prior bulk section before appending fresh.
  for (const existing of root.querySelectorAll("[data-bulk]")) existing.remove();
  const quotes = await getBulkQuotes().catch(() => []);
  if (quotes.length === 0) return;
  const state = await loadBulkState().catch(() => ({}));
  const node = tplBulk.content.cloneNode(true);
  const section = node.querySelector("[data-bulk]");
  const list = node.querySelector("[data-bulk-list]");
  const countEl = node.querySelector('[data-field="bulk-count"]');
  const repoInput = node.querySelector('[data-field="bulk-repo"]');
  const repoHint = node.querySelector('[data-field="bulk-repo-hint"]');
  const labelsInput = node.querySelector('[data-field="bulk-labels"]');
  const fileBtn = node.querySelector('[data-action="file-bulk"]');
  const fileLabel = node.querySelector('[data-field="bulk-submit-label"]');
  const clearBtn = node.querySelector('[data-action="clear-bulk"]');
  const progressBox = node.querySelector('[data-field="bulk-progress"]');
  const progressFill = node.querySelector('[data-field="bulk-progress-fill"]');
  const progressLabel = node.querySelector('[data-field="bulk-progress-label"]');
  const errorEl = node.querySelector('[data-field="bulk-error"]');
  const hintEl = node.querySelector('[data-field="bulk-hint"]');

  countEl.textContent = `${quotes.length} queued`;
  repoInput.value = state.repo || "";
  labelsInput.value = state.labels || "";
  fileLabel.textContent = quotes.length === 1 ? "File 1 issue" : `File ${quotes.length} issues`;

  const rowEls = new Map();
  for (const q of quotes) {
    const rowFrag = tplBulkRow.content.cloneNode(true);
    const li = rowFrag.querySelector(".bulk-row");
    li.dataset.id = q.id;
    const hostEl = rowFrag.querySelector('[data-field="bulk-row-host"]');
    const sectionEl = rowFrag.querySelector('[data-field="bulk-row-section"]');
    const snipEl = rowFrag.querySelector('[data-field="bulk-row-snippet"]');
    hostEl.textContent = hostnameOf(q.pageUrl) || "(unknown)";
    sectionEl.textContent = q.nearestHeading ? `· ${q.nearestHeading}` : "";
    snipEl.textContent = (q.selectionText || "").replace(/\s+/g, " ").trim().slice(0, 200);
    rowFrag.querySelector('[data-action="remove-bulk"]').addEventListener("click", async (e) => {
      e.preventDefault();
      await removeBulkQuote(q.id);
      loadPending();
    });
    list.appendChild(rowFrag);
    rowEls.set(q.id, li);
  }

  function validate() {
    const r = parseRepo(repoInput.value);
    if (!repoInput.value.trim()) {
      repoHint.textContent = "All selected quotes will be filed against this repo.";
      repoHint.classList.remove("error");
    } else if (!r.ok) {
      repoHint.textContent = r.error || "Use the form owner/name";
      repoHint.classList.add("error");
    } else {
      repoHint.textContent = `Will file ${quotes.length} issues at github.com/${r.value}`;
      repoHint.classList.remove("error");
    }
    return r.ok;
  }

  async function refreshFileBtn() {
    const has = await hasToken().catch(() => false);
    fileBtn.disabled = !(has && validate());
    if (!has) hintEl.textContent = "Add a GitHub token in settings first.";
    else hintEl.innerHTML = 'Right-click selections and choose <em>Add to issue batch</em> to queue more.';
  }

  validate();
  refreshFileBtn();

  repoInput.addEventListener("input", () => {
    saveBulkState({ repo: repoInput.value });
    refreshFileBtn();
  });
  labelsInput.addEventListener("input", () => saveBulkState({ labels: labelsInput.value }));

  clearBtn.addEventListener("click", async () => {
    await clearBulkQuotes();
    loadPending();
  });

  function setRowState(id, state, detail) {
    const li = rowEls.get(id);
    if (!li) return;
    const wrap = li.querySelector('[data-field="bulk-row-status"]');
    wrap.dataset.state = state;
    const link = li.querySelector('[data-field="bulk-row-link"]');
    let icon = '';
    if (state === "in-progress") {
      icon = '<svg class="bulk-row-icon spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9" opacity="0.25"></circle><path d="M21 12a9 9 0 0 0-9-9"></path></svg>';
    } else if (state === "done") {
      icon = '<svg class="bulk-row-icon ok" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"></circle><path d="M8 12.5l2.5 2.5L16 9.5"></path></svg>';
    } else if (state === "failed") {
      icon = '<svg class="bulk-row-icon err" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"></circle><path d="M9 9l6 6"></path><path d="M15 9l-6 6"></path></svg>';
    } else {
      icon = '<svg class="bulk-row-icon pending" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"></circle></svg>';
    }
    wrap.innerHTML = icon;
    if (state === "done" && detail?.htmlUrl) {
      link.hidden = false;
      link.href = detail.htmlUrl;
      link.textContent = `#${detail.number ?? "open"}`;
    } else if (state === "failed" && detail?.error) {
      link.hidden = false;
      link.removeAttribute("href");
      link.classList.add("err");
      link.textContent = detail.error;
    }
  }

  fileBtn.addEventListener("click", async () => {
    if (fileBtn.disabled) return;
    const repo = parseRepo(repoInput.value);
    if (!repo.ok) return;
    fileBtn.disabled = true;
    fileBtn.classList.add("loading");
    clearBtn.disabled = true;
    repoInput.disabled = true;
    labelsInput.disabled = true;
    errorEl.hidden = true;
    progressBox.hidden = false;
    const labels = parseLabels(labelsInput.value);
    const total = quotes.length;
    let done = 0;
    let failed = 0;
    const tmpl = await getRepoTemplate(repo.value).catch(() => null);
    progressLabel.textContent = `0 / ${total}`;
    progressFill.style.width = "0%";
    for (const q of quotes) {
      setRowState(q.id, "in-progress");
      const title = deriveTitle(q) || `Quote from: ${hostnameOf(q.pageUrl) || "page"}`;
      const body = tmpl?.body ? renderTemplate(tmpl.body, q) : buildMarkdownBody(q);
      try {
        const reply = await chrome.runtime.sendMessage({
          type: "submitIssue",
          repo: repo.value,
          title,
          body,
          labels,
        });
        if (!reply?.ok) throw new Error(reply?.error || "Unknown error");
        const created = reply.result || {};
        setRowState(q.id, "done", created);
        // Remove the successfully filed quote from storage so partial failure
        // leaves only the unfiled ones for retry.
        await removeBulkQuote(q.id).catch(() => {});
        done += 1;
      } catch (err) {
        setRowState(q.id, "failed", { error: String(err?.message || err) });
        failed += 1;
      }
      const pct = Math.round(((done + failed) / total) * 100);
      progressFill.style.width = `${pct}%`;
      progressLabel.textContent = `${done + failed} / ${total}${failed ? ` · ${failed} failed` : ""}`;
    }
    await addRecentRepo(repo.value).catch(() => {});
    fileBtn.classList.remove("loading");
    clearBtn.disabled = false;
    repoInput.disabled = false;
    labelsInput.disabled = false;
    if (failed === 0) {
      // All filed — reset the queue and the badge.
      await clearBulkQuotes();
      hintEl.textContent = `All ${total} issues filed.`;
      setTimeout(() => loadPending(), 1400);
    } else {
      errorEl.hidden = false;
      errorEl.textContent = `${failed} issue${failed === 1 ? "" : "s"} failed. Filed quotes were removed from the batch; retry to refile the rest.`;
      fileBtn.disabled = false;
    }
  });

  root.appendChild(section);
}

chrome?.storage?.onChanged?.addListener((changes, area) => {
  if (area === "local" && (changes[STORAGE_KEYS.pendingQuote] || changes[STORAGE_KEYS.bulkQuotes])) loadPending();
});
if (root) loadPending();

