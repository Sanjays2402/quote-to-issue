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
  repoDefaults: "qti.repoDefaults",
  repoMilestonePref: "qti.repoMilestonePref",
  repoMilestoneCache: "qti.repoMilestoneCache",

  drafts: "qti.drafts",
  repoIssueTypes: "qti.repoIssueTypes",
  bulkQuotes: "qti.bulkQuotes",
  bulkState: "qti.bulkState",
  captureSettings: "qti.captureSettings",
  recentIssues: "qti.recentIssues",
  offlineQueue: "qti.offlineQueue",
  quoteHistory: "qti.quoteHistory",
});

const MAX_QUOTE_HISTORY = 200;
const QUOTE_HISTORY_SNIPPET_MAX = 600;

const MAX_RECENT_ISSUES = 10;

const DUP_STOPWORDS = new Set([
  "a","an","and","are","as","at","be","but","by","for","from","has","have",
  "in","into","is","it","its","of","on","or","so","that","the","their",
  "this","to","was","were","will","with","you","your","i","we","they",
  "quote","issue","bug","can","could","would","should","if","not","no",
  "do","does","did","about","there","here","just","like","some","any",
]);

function extractDupTokens(title, selection) {
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

function scoreDuplicateMatch(item, tokens) {
  if (!item || !tokens || tokens.length === 0) return 0;
  const hay = `${String(item.title || "").toLowerCase()}`;
  let hits = 0;
  for (const t of tokens) if (hay.includes(t)) hits++;
  return tokens.length ? hits / tokens.length : 0;
}

function rankDuplicates(items, tokens) {
  if (!Array.isArray(items)) return [];
  const ranked = items.map((it) => ({ ...it, _score: scoreDuplicateMatch(it, tokens) }));
  ranked.sort((a, b) => {
    if (b._score !== a._score) return b._score - a._score;
    const at = Date.parse(a.updatedAt || "") || 0;
    const bt = Date.parse(b.updatedAt || "") || 0;
    return bt - at;
  });
  return ranked;
}

// ---------------------------------------------------------------------------
// Capture settings — toggle + radius for surrounding-context scraping
// ---------------------------------------------------------------------------
const CONTEXT_RADIUS_MIN = 0;
const CONTEXT_RADIUS_MAX = 600;
const DEFAULT_CAPTURE_SETTINGS = Object.freeze({ contextEnabled: true, contextRadius: 240, highlightMode: false, privacyMode: false, languageLabelEnabled: true });

function normalizeCaptureSettings(raw) {
  const out = { ...DEFAULT_CAPTURE_SETTINGS };
  if (!raw || typeof raw !== "object") return out;
  if (typeof raw.contextEnabled === "boolean") out.contextEnabled = raw.contextEnabled;
  const r = Number(raw.contextRadius);
  if (Number.isFinite(r)) {
    out.contextRadius = Math.max(CONTEXT_RADIUS_MIN, Math.min(CONTEXT_RADIUS_MAX, Math.round(r)));
  }
  if (!out.contextEnabled) out.contextRadius = 0;
  if (typeof raw.highlightMode === "boolean") out.highlightMode = raw.highlightMode;
  if (typeof raw.privacyMode === "boolean") out.privacyMode = raw.privacyMode;
  if (typeof raw.languageLabelEnabled === "boolean") out.languageLabelEnabled = raw.languageLabelEnabled;
  return out;
}

// ---------------------------------------------------------------------------
// Selection language detection — script-based for non-Latin, common-word
// frequency for Latin. Returns ISO 639-1 code or null. Used to auto-tag the
// issue form with a `lang:<code>` label when the toggle is enabled.
// ---------------------------------------------------------------------------
const LANGUAGE_LABEL_PREFIX = "lang:";
const LANG_KNOWN_CODES = Object.freeze([
  "en","es","fr","de","it","pt","nl",
  "ja","zh","ko","ru","ar","he","el","th","hi",
]);
const LATIN_WORD_LISTS = Object.freeze({
  en: ["the","and","of","to","is","in","that","it","you","for","on","with","as","this","be","are","at","or","by","from","but","not","have","was"],
  es: ["el","la","los","las","de","que","y","en","un","una","es","por","para","con","del","se","al","como","pero","más","este","esta"],
  fr: ["le","la","les","de","du","des","et","est","un","une","pour","que","dans","avec","sur","par","ne","pas","qui","vous","nous","ce"],
  de: ["der","die","das","und","ist","ein","eine","den","von","mit","nicht","auf","auch","zu","sich","im","für","dem","als","sind","oder"],
  it: ["il","lo","la","di","che","un","una","per","con","del","non","da","in","sono","ma","si","al","come","questo","anche"],
  pt: ["o","a","de","que","e","do","da","em","um","uma","para","com","não","os","as","por","mais","como","mas","foi"],
  nl: ["de","het","een","en","van","is","in","op","te","dat","niet","met","zijn","voor","aan","door","maar","ook","als"],
});

function detectSelectionLanguage(text) {
  const s = String(text || "").trim();
  if (s.length < 8) return null;
  const sample = s.slice(0, 600);
  // Script-based shortcuts (kana > hangul > arabic > devanagari/hebrew/thai/greek/cyrillic > han).
  if (/[\u3040-\u309f\u30a0-\u30ff]/.test(sample)) return "ja";
  if (/[\uac00-\ud7af]/.test(sample)) return "ko";
  if (/[\u0600-\u06ff]/.test(sample)) return "ar";
  if (/[\u0590-\u05ff]/.test(sample)) return "he";
  if (/[\u0900-\u097f]/.test(sample)) return "hi";
  if (/[\u0e00-\u0e7f]/.test(sample)) return "th";
  if (/[\u0370-\u03ff]/.test(sample)) return "el";
  if (/[\u0400-\u04ff]/.test(sample)) return "ru";
  if (/[\u4e00-\u9fff]/.test(sample)) return "zh";
  // Latin script: common-word frequency vote.
  const lc = sample.toLowerCase();
  if (!/[a-z]/i.test(lc)) return null;
  const words = lc.match(/[a-zà-ÿœæß']+/g) || [];
  if (words.length < 3) return null;
  let best = null;
  let bestScore = 0;
  for (const [code, list] of Object.entries(LATIN_WORD_LISTS)) {
    const set = new Set(list);
    let score = 0;
    for (const w of words) if (set.has(w)) score++;
    if (score > bestScore) { bestScore = score; best = code; }
  }
  // Need at least two function-word hits to claim a Latin language.
  if (bestScore < 2) return null;
  return best;
}

function languageLabelFor(code) {
  if (!code || typeof code !== "string") return "";
  const norm = code.trim().toLowerCase();
  if (!LANG_KNOWN_CODES.includes(norm)) return "";
  return `${LANGUAGE_LABEL_PREFIX}${norm}`;
}

function mergeLanguageLabel(existingLabels, code) {
  const label = languageLabelFor(code);
  if (!label) return existingLabels.slice();
  const out = existingLabels.slice();
  const lowered = out.map((l) => l.toLowerCase());
  // Drop any pre-existing lang:* labels so we never stack en + es on a single issue.
  for (let i = lowered.length - 1; i >= 0; i--) {
    if (lowered[i].startsWith(LANGUAGE_LABEL_PREFIX)) out.splice(i, 1);
  }
  out.push(label);
  return out;
}

// ---------------------------------------------------------------------------
// Privacy mode: scrub query params + auth tokens from captured URLs.
// Goal — keep source attribution useful (origin + path + scroll-to-text
// fragment) while stripping anything that could leak credentials, session
// state, or analytics identifiers into a public issue tracker.
// ---------------------------------------------------------------------------
const PRIVACY_AUTH_PARAM_RE = /^(?:token|access[_-]?token|id[_-]?token|refresh[_-]?token|auth(?:[_-]?token)?|bearer|api[_-]?key|apikey|key|secret|password|passwd|pwd|session(?:id)?|sid|sig|signature|code|state|nonce|hmac|jwt|otp|csrf|x[_-]?auth.*)$/i;
const PRIVACY_TRACKING_PARAM_RE = /^(?:utm_.*|fbclid|gclid|dclid|msclkid|yclid|mc_eid|mc_cid|ref|ref_(?:src|url)|_hsenc|_hsmi|igshid|trk|trkCampaign|vero_id|piwik_.*|wt_z?mc|hsCtaTracking|share|s)$/i;

function scrubUrlForPrivacy(rawUrl) {
  const s = String(rawUrl || "").trim();
  if (!s) return "";
  let u;
  try { u = new URL(s); } catch { return ""; }
  if (u.protocol !== "http:" && u.protocol !== "https:") return "";
  // Drop userinfo (user:pass@host) — always a credential leak.
  u.username = "";
  u.password = "";
  // Strip the entire query string. The scrubbed URL keeps origin + path so
  // attribution still resolves; scroll-to-text fragments live in the hash and
  // are appended later by the markdown builder.
  u.search = "";
  // Drop the existing fragment too — author-provided fragments occasionally
  // carry session/auth blobs (e.g. SPA implicit-flow callbacks).
  u.hash = "";
  return u.toString();
}

function scrubAuthParamsOnly(rawUrl) {
  const s = String(rawUrl || "").trim();
  if (!s) return s;
  let u;
  try { u = new URL(s); } catch { return s; }
  if (!u.search) return s;
  let mutated = false;
  const drop = [];
  for (const k of u.searchParams.keys()) {
    if (PRIVACY_AUTH_PARAM_RE.test(k) || PRIVACY_TRACKING_PARAM_RE.test(k)) {
      drop.push(k); mutated = true;
    }
  }
  for (const k of drop) u.searchParams.delete(k);
  return mutated ? u.toString() : s;
}

function applyPrivacyToQuote(q, settings) {
  if (!q) return q;
  const on = !!settings?.privacyMode;
  if (!on) return q;
  const next = { ...q };
  if (next.pageUrl) next.pageUrl = scrubUrlForPrivacy(next.pageUrl);
  if (next.frameUrl) next.frameUrl = scrubUrlForPrivacy(next.frameUrl);
  return next;
}

async function getCaptureSettings() {
  if (!chrome?.storage?.local) return { ...DEFAULT_CAPTURE_SETTINGS };
  const out = await chrome.storage.local.get(STORAGE_KEYS.captureSettings);
  return normalizeCaptureSettings(out[STORAGE_KEYS.captureSettings]);
}

async function setCaptureSettings(patch) {
  const cur = await getCaptureSettings();
  const next = normalizeCaptureSettings({ ...cur, ...patch });
  await chrome.storage.local.set({ [STORAGE_KEYS.captureSettings]: next });
  return next;
}

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
const tplToast = document.getElementById("tpl-toast");
const toastHost = document.getElementById("toast-host");
let activeToastTimer = null;

function showSuccessToast({ htmlUrl, repo, number, durationMs = 6500 } = {}) {
  if (!tplToast || !toastHost) return null;
  // Dismiss any existing toast before showing a new one.
  for (const el of toastHost.querySelectorAll("[data-toast]")) el.remove();
  if (activeToastTimer) { clearTimeout(activeToastTimer); activeToastTimer = null; }
  const frag = tplToast.content.cloneNode(true);
  const node = frag.querySelector("[data-toast]");
  if (!node) return null;
  const sub = node.querySelector('[data-field="toast-sub"]');
  if (sub) {
    sub.textContent = (repo && number != null) ? `${repo} #${number}` : (htmlUrl || "");
    if (htmlUrl) sub.title = htmlUrl;
  }
  const copyBtn = node.querySelector('[data-action="toast-copy"]');
  const copyLabel = node.querySelector('[data-field="toast-copy-label"]');
  const openBtn = node.querySelector('[data-action="toast-open"]');
  const closeBtn = node.querySelector('[data-action="toast-close"]');
  const progress = node.querySelector('[data-field="toast-progress"]');

  const dismiss = () => {
    if (!node.isConnected) return;
    node.classList.remove("in");
    node.classList.add("out");
    if (activeToastTimer) { clearTimeout(activeToastTimer); activeToastTimer = null; }
    setTimeout(() => { try { node.remove(); } catch {} }, 240);
  };

  if (!htmlUrl) {
    copyBtn?.setAttribute("disabled", "true");
    if (openBtn) { openBtn.setAttribute("disabled", "true"); openBtn.style.opacity = "0.5"; openBtn.style.pointerEvents = "none"; }
  }

  copyBtn?.addEventListener("click", async () => {
    if (!htmlUrl) return;
    let copied = false;
    try {
      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(htmlUrl);
        copied = true;
      }
    } catch {}
    if (!copied) {
      try {
        const ta = document.createElement("textarea");
        ta.value = htmlUrl; ta.style.position = "fixed"; ta.style.opacity = "0";
        document.body.appendChild(ta); ta.select();
        copied = document.execCommand("copy");
        ta.remove();
      } catch {}
    }
    if (copied) {
      copyBtn.classList.add("copied");
      if (copyLabel) copyLabel.textContent = "Copied";
      // Pin the toast a bit longer after a copy so the user can confirm.
      if (activeToastTimer) { clearTimeout(activeToastTimer); }
      activeToastTimer = setTimeout(dismiss, 2200);
    }
  });

  openBtn?.addEventListener("click", () => {
    if (!htmlUrl) return;
    try {
      if (chrome?.tabs?.create) chrome.tabs.create({ url: htmlUrl, active: true });
      else window.open(htmlUrl, "_blank", "noopener,noreferrer");
    } catch {
      try { window.open(htmlUrl, "_blank", "noopener,noreferrer"); } catch {}
    }
    dismiss();
  });

  closeBtn?.addEventListener("click", dismiss);
  node.addEventListener("mouseenter", () => {
    if (activeToastTimer) { clearTimeout(activeToastTimer); activeToastTimer = null; }
    if (progress) progress.style.transition = "none";
  });
  node.addEventListener("mouseleave", () => {
    if (progress) {
      progress.style.transition = `transform ${Math.max(800, durationMs / 2)}ms linear`;
      progress.style.transform = "scaleX(0)";
    }
    activeToastTimer = setTimeout(dismiss, Math.max(1200, durationMs / 2));
  });

  toastHost.appendChild(node);
  // Force layout, then animate in.
  requestAnimationFrame(() => {
    node.classList.add("in");
    if (progress) {
      progress.style.transition = `transform ${durationMs}ms linear`;
      progress.style.transform = "scaleX(0)";
    }
  });
  activeToastTimer = setTimeout(dismiss, durationMs);
  return node;
}
const tplDrafts = document.getElementById("tpl-drafts");
const tplDraftRow = document.getElementById("tpl-draft-row");
const tplBulk = document.getElementById("tpl-bulk");
const tplBulkRow = document.getElementById("tpl-bulk-row");
const tplRecentIssues = document.getElementById("tpl-recent-issues");
const tplRecentIssueRow = document.getElementById("tpl-recent-issue-row");
const tplQuoteHistory = document.getElementById("tpl-quote-history");
const tplQuoteHistoryRow = document.getElementById("tpl-quote-history-row");
const tplPalette = document.getElementById("tpl-palette");

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

// GitHub username: 1-39 chars, alphanumeric/hyphen, no leading/trailing hyphen,
// no consecutive hyphens. We're lenient on '@' prefix because humans paste it.
const GH_USERNAME_RE = /^[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38}$/;
function parseAssignees(input) {
  return String(input || "")
    .split(/[\s,\n]+/)
    .map((s) => s.trim().replace(/^@+/, ""))
    .filter(Boolean)
    .filter((s) => GH_USERNAME_RE.test(s))
    .filter((v, i, a) => a.findIndex((x) => x.toLowerCase() === v.toLowerCase()) === i)
    .slice(0, 10);
}

// Common abbreviations that end in '.' but do NOT end a sentence. Used to
// avoid false splits when extracting the first sentence from a selection.
const SENTENCE_ABBREVIATIONS = new Set([
  "mr", "mrs", "ms", "dr", "prof", "sr", "jr", "st", "mt",
  "vs", "etc", "eg", "ie", "approx", "inc", "ltd", "co", "corp",
  "e.g", "i.e", "u.s", "u.k", "e.u", "a.m", "p.m",
  "no", "vol", "fig", "figs", "ch", "sec", "pp",
]);

/**
 * Extract the first sentence from a block of selection text. Walks the
 * string char-by-char so we can distinguish real sentence terminators from
 * abbreviation dots ("Mr.", "e.g.", "U.S.") and decimal points ("3.14").
 * Returns the trimmed first sentence WITHOUT trailing terminator punctuation,
 * or the whole input if no boundary was found.
 */
function firstSentence(text) {
  const s = String(text || "").trim();
  if (!s) return "";
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch !== "." && ch !== "!" && ch !== "?") continue;
    const next = s[i + 1];
    // Need whitespace or end-of-string after the terminator. (Quotes/parens
    // that follow are folded into the sentence — common for blockquotes.)
    const isBoundary = !next || /\s/.test(next);
    if (!isBoundary) continue;
    // Decimal: digit.digit (3.14) — not a sentence end.
    if (ch === "." && /\d/.test(s[i - 1] || "") && /\d/.test(next || "")) continue;
    if (ch === ".") {
      // Pull the preceding token to check against the abbreviation list.
      let j = i - 1;
      while (j >= 0 && /[A-Za-z.]/.test(s[j])) j--;
      const token = s.slice(j + 1, i).toLowerCase().replace(/\.$/, "");
      if (token && SENTENCE_ABBREVIATIONS.has(token)) continue;
      // Single-letter capital initials: "J. R. R. Tolkien" — skip.
      if (token.length === 1 && /[a-z]/.test(token) && /[A-Z]/.test(s[i - 1] || "")) continue;
    }
    return s.slice(0, i).trim();
  }
  return s;
}

/**
 * Smart-truncate to the last whole word before `max` chars, appending an
 * ellipsis when truncation occurred. Returns the input unchanged when it
 * already fits. Single-word overflow falls back to a hard slice.
 */
function smartTruncate(text, max) {
  const s = String(text || "");
  if (s.length <= max) return s;
  const head = s.slice(0, max - 1);
  const cut = head.replace(/\s+\S*$/, "");
  return (cut || head) + "\u2026";
}

function deriveTitle(q) {
  const t = String(q?.selectionText || "").replace(/\s+/g, " ").trim();
  if (!t) return q?.pageTitle ? `Quote from: ${q.pageTitle}` : "";
  const max = 72;
  const sentence = firstSentence(t) || t;
  const trimmed = smartTruncate(sentence, max);
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

function buildCodeFence(q) {
  const raw = String(q?.selectionText || "");
  if (!raw) return "";
  let maxRun = 0;
  const re = /`+/g;
  let m;
  while ((m = re.exec(raw))) { if (m[0].length > maxRun) maxRun = m[0].length; }
  const fence = "`".repeat(Math.max(3, maxRun + 1));
  const lang = String(q?.codeLanguage || "").trim().toLowerCase().replace(/[^a-z0-9+#._-]/g, "").slice(0, 32);
  return `${fence}${lang}\n${raw.replace(/\r\n?/g, "\n")}\n${fence}`;
}

function buildMarkdownBody(q) {
  if (!q) return "";
  const lines = [];
  const quoted = (q.selectionText || "").trim();
  if (quoted && q.isCode) {
    lines.push(buildCodeFence(q));
    lines.push("");
  } else if (quoted) {
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
  if (q.author) lines.push(`**Author:** ${q.author}`);
  if (q.publishedAt) lines.push(`**Published:** ${formatPublishDate(q.publishedAt)}`);
  if (q.screenshot && q.screenshot.dataUrl) {
    const dim = (q.screenshot.width && q.screenshot.height)
      ? `${q.screenshot.width}×${q.screenshot.height}`
      : "PNG";
    lines.push(`**Screenshot:** captured (${dim}) — paste from clipboard or attach the downloaded PNG when filing.`);
  }
  if (q.capturedAt) lines.push(`**Captured:** ${q.capturedAt}`);
  return lines.join("\n").trim();
}

function formatPublishDate(raw) {
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

// ---------------------------------------------------------------------------
// Per-repo default labels + assignees
// ---------------------------------------------------------------------------

function normalizeRepoDefaults(raw) {
  if (!raw || typeof raw !== "object") return {};
  const out = {};
  for (const [k, v] of Object.entries(raw)) {
    const key = repoKey(k);
    if (!key) continue;
    if (!v || typeof v !== "object") continue;
    const labelsIn = Array.isArray(v.labels) ? v.labels.join(",") : v.labels;
    const assigneesIn = Array.isArray(v.assignees) ? v.assignees.join(",") : v.assignees;
    const labels = parseLabels(labelsIn);
    const assignees = parseAssignees(assigneesIn);
    if (labels.length === 0 && assignees.length === 0) continue;
    const updatedAt = typeof v.updatedAt === "string" ? v.updatedAt : new Date().toISOString();
    out[key] = { labels, assignees, updatedAt };
  }
  return out;
}

async function getAllRepoDefaults() {
  if (!chrome?.storage?.local) return {};
  const out = await chrome.storage.local.get(STORAGE_KEYS.repoDefaults);
  return normalizeRepoDefaults(out[STORAGE_KEYS.repoDefaults]);
}

async function getRepoDefaults(repo) {
  const key = repoKey(repo);
  if (!key) return null;
  const all = await getAllRepoDefaults();
  return all[key] || null;
}

async function setRepoDefaults(repo, { labels, assignees }) {
  const key = repoKey(repo);
  if (!key) throw new Error("Invalid repo");
  const labs = parseLabels(Array.isArray(labels) ? labels.join(",") : labels);
  const asgs = parseAssignees(Array.isArray(assignees) ? assignees.join(",") : assignees);
  const all = await getAllRepoDefaults();
  if (labs.length === 0 && asgs.length === 0) {
    if (all[key]) {
      delete all[key];
      await chrome.storage.local.set({ [STORAGE_KEYS.repoDefaults]: all });
    }
    return null;
  }
  all[key] = { labels: labs, assignees: asgs, updatedAt: new Date().toISOString() };
  await chrome.storage.local.set({ [STORAGE_KEYS.repoDefaults]: all });
  return all[key];
}

async function clearRepoDefaults(repo) {
  const key = repoKey(repo);
  if (!key) return;
  const all = await getAllRepoDefaults();
  if (!all[key]) return;
  delete all[key];
  await chrome.storage.local.set({ [STORAGE_KEYS.repoDefaults]: all });
}

// ---------------------------------------------------------------------------
// Per-repo milestone picker
// ---------------------------------------------------------------------------

const MILESTONE_CACHE_TTL_MS = 5 * 60 * 1000;
const MILESTONE_CACHE_MAX_REPOS = 12;

function normalizeMilestoneList(items) {
  if (!Array.isArray(items)) return [];
  const out = [];
  for (const raw of items) {
    if (!raw || typeof raw !== "object") continue;
    const number = Number(raw.number);
    const title = String(raw.title || "").trim();
    if (!Number.isFinite(number) || number <= 0 || !title) continue;
    out.push({
      number: Math.floor(number),
      title: title.slice(0, 200),
      state: raw.state === "closed" ? "closed" : "open",
      dueOn: typeof raw.dueOn === "string" ? raw.dueOn : "",
      htmlUrl: typeof raw.htmlUrl === "string" ? raw.htmlUrl : "",
      description: String(raw.description || "").slice(0, 400),
      openIssues: Number(raw.openIssues) || 0,
      closedIssues: Number(raw.closedIssues) || 0,
    });
  }
  // Cap at 50 for sanity.
  return out.slice(0, 50);
}

async function getRepoMilestonePrefAll() {
  if (!chrome?.storage?.local) return {};
  const out = await chrome.storage.local.get(STORAGE_KEYS.repoMilestonePref);
  const raw = out[STORAGE_KEYS.repoMilestonePref];
  if (!raw || typeof raw !== "object") return {};
  return raw;
}

async function getRepoMilestonePref(repo) {
  const key = repoKey(repo);
  if (!key) return null;
  const all = await getRepoMilestonePrefAll();
  const v = all[key];
  if (!v || !Number.isFinite(Number(v.number))) return null;
  return { number: Number(v.number), title: String(v.title || "") };
}

async function setRepoMilestonePref(repo, milestone) {
  const key = repoKey(repo);
  if (!key) return;
  const all = await getRepoMilestonePrefAll();
  if (!milestone) {
    if (all[key]) {
      delete all[key];
      await chrome.storage.local.set({ [STORAGE_KEYS.repoMilestonePref]: all });
    }
    return;
  }
  all[key] = { number: Number(milestone.number) || 0, title: String(milestone.title || "").slice(0, 200), updatedAt: new Date().toISOString() };
  await chrome.storage.local.set({ [STORAGE_KEYS.repoMilestonePref]: all });
}

async function getMilestoneCacheAll() {
  if (!chrome?.storage?.local) return {};
  const out = await chrome.storage.local.get(STORAGE_KEYS.repoMilestoneCache);
  const raw = out[STORAGE_KEYS.repoMilestoneCache];
  if (!raw || typeof raw !== "object") return {};
  return raw;
}

async function getCachedMilestones(repo) {
  const key = repoKey(repo);
  if (!key) return null;
  const all = await getMilestoneCacheAll();
  const entry = all[key];
  if (!entry || !Array.isArray(entry.items)) return null;
  const age = Date.now() - (Date.parse(entry.fetchedAt) || 0);
  if (age > MILESTONE_CACHE_TTL_MS) return { items: normalizeMilestoneList(entry.items), stale: true };
  return { items: normalizeMilestoneList(entry.items), stale: false };
}

async function setCachedMilestones(repo, items) {
  const key = repoKey(repo);
  if (!key) return;
  const all = await getMilestoneCacheAll();
  all[key] = { items: normalizeMilestoneList(items), fetchedAt: new Date().toISOString() };
  // Trim oldest entries beyond max.
  const keys = Object.keys(all);
  if (keys.length > MILESTONE_CACHE_MAX_REPOS) {
    keys.sort((a, b) => (Date.parse(all[a].fetchedAt) || 0) - (Date.parse(all[b].fetchedAt) || 0));
    while (keys.length > MILESTONE_CACHE_MAX_REPOS) {
      const k = keys.shift();
      delete all[k];
    }
  }
  await chrome.storage.local.set({ [STORAGE_KEYS.repoMilestoneCache]: all });
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
  const author = q?.author || "";
  const publishedAt = formatPublishDate(q?.publishedAt);
  const ctxBefore = (q?.contextBefore || "").trim();
  const ctxAfter = (q?.contextAfter || "").trim();
  let screenshotNote = "";
  if (q?.screenshot?.dataUrl) {
    const dim = (q.screenshot.width && q.screenshot.height) ? `${q.screenshot.width}\u00d7${q.screenshot.height}` : "PNG";
    screenshotNote = `**Screenshot:** captured (${dim}) — paste from clipboard or attach the downloaded PNG when filing.`;
  }
  const quoteCode = q?.isCode ? buildCodeFence(q) : (quoted ? "```\n" + quoted + "\n```" : "");
  const vars = {
    quote: quoted,
    quote_blockquote: quoteBlock,
    quote_code: quoteCode,
    code_language: q?.codeLanguage || "",
    source_title: sourceTitle,
    source_url: sourceUrl,
    source_url_anchor: sourceUrlAnchor,
    section,
    captured,
    context_before: ctxBefore,
    context_after: ctxAfter,
    author,
    published_at: publishedAt,
    screenshot_note: screenshotNote,
    host: hostnameOf(q?.pageUrl),
    // Short aliases — match the public placeholder vocabulary from the roadmap.
    // {{url}} resolves to the scroll-to-text anchored URL (richest by default),
    // {{selection}} to the raw selection text, {{title}} to the page title,
    // {{date}} to the YYYY-MM-DD captured date for human-friendly templates.
    url: sourceUrlAnchor || sourceUrl,
    selection: quoted,
    title: sourceTitle,
    date: formatPublishDate(captured) || captured,
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

/**
 * Fuzzy subsequence match.
 * Every char in `query` must appear in `text` in order (case-insensitive).
 * Returns { score, indices } with bonuses for contiguous runs, word
 * boundaries (start, /, -, _, .), and the matched positions for highlighting.
 * Returns null when the query is not a subsequence of the text.
 */
function fuzzyMatch(text, query) {
  const t = String(text || "");
  const q = String(query || "");
  if (!q) return { score: 0, indices: [] };
  const tl = t.toLowerCase();
  const ql = q.toLowerCase();
  const indices = [];
  let qi = 0;
  let score = 0;
  let prev = -2;
  for (let i = 0; i < tl.length && qi < ql.length; i++) {
    if (tl[i] !== ql[qi]) continue;
    indices.push(i);
    // Contiguous-run bonus.
    if (i === prev + 1) score += 5;
    else score += 1;
    // Word-boundary bonus.
    if (i === 0 || /[\/\-_.\s]/.test(tl[i - 1])) score += 3;
    // Exact-case bonus.
    if (t[i] === q[qi]) score += 0.5;
    prev = i;
    qi += 1;
  }
  if (qi < ql.length) return null;
  // Slight penalty for longer haystacks so shorter, more specific repos rank up.
  score -= Math.max(0, t.length - q.length) * 0.01;
  return { score, indices };
}

function renderRepoValue(el, value, indices) {
  if (!el) return;
  el.replaceChildren();
  const v = String(value || "");
  const set = new Set(Array.isArray(indices) ? indices : []);
  if (set.size === 0) { el.textContent = v; return; }
  for (let i = 0; i < v.length; i++) {
    if (set.has(i)) {
      const mark = document.createElement("span");
      mark.className = "repo-recent-match";
      mark.textContent = v[i];
      el.appendChild(mark);
    } else {
      el.appendChild(document.createTextNode(v[i]));
    }
  }
}

function filterRecentRepos(recents, query) {
  if (!Array.isArray(recents)) return [];
  const q = String(query || "").trim();
  if (!q) return recents.slice();
  const ranked = [];
  for (let i = 0; i < recents.length; i++) {
    const r = recents[i];
    const m = fuzzyMatch(r.value, q);
    if (!m) continue;
    ranked.push({ entry: r, score: m.score, indices: m.indices, idx: i });
  }
  ranked.sort((a, b) => (b.score - a.score) || (a.idx - b.idx));
  return ranked.map((r) => Object.assign({}, r.entry, { _matchIndices: r.indices }));
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
    const assignees = String(raw.assignees || "").slice(0, 256);
    const body = String(raw.body || "").slice(0, MAX_DRAFT_BODY_LEN);
    const quote = raw.quote && typeof raw.quote === "object" ? raw.quote : null;
    const createdAt = typeof raw.createdAt === "string" ? raw.createdAt : new Date().toISOString();
    const updatedAt = typeof raw.updatedAt === "string" ? raw.updatedAt : createdAt;
    if (!title.trim() && !body.trim() && !(quote && quote.selectionText)) continue;
    out.push({ id, title, repo, labels, assignees, body, quote, createdAt, updatedAt });
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
      isCode: !!raw.isCode,
      codeLanguage: String(raw.codeLanguage || "").slice(0, 32),
      author: String(raw.author || "").slice(0, 200),
      publishedAt: String(raw.publishedAt || "").slice(0, 64),
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

// ---------------------------------------------------------------------------
// Recent issues — last N filed, click to reopen on GitHub
// ---------------------------------------------------------------------------
function normalizeRecentIssues(list) {
  if (!Array.isArray(list)) return [];
  const valid = [];
  for (const raw of list) {
    if (!raw || typeof raw !== "object") continue;
    const repo = String(raw.repo || "").trim();
    if (!/^[^\s/]+\/[^\s/]+$/.test(repo)) continue;
    const num = Number(raw.number);
    if (!Number.isFinite(num) || num <= 0) continue;
    const htmlUrl = String(raw.htmlUrl || "").trim();
    if (!/^https?:\/\//.test(htmlUrl)) continue;
    const title = String(raw.title || "").slice(0, 280);
    const filedAt = typeof raw.filedAt === "string" ? raw.filedAt : new Date().toISOString();
    valid.push({ repo, number: num, htmlUrl, title, filedAt });
  }
  valid.sort((a, b) => (Date.parse(b.filedAt) || 0) - (Date.parse(a.filedAt) || 0));
  const out = [];
  const seen = new Set();
  for (const v of valid) {
    const key = `${v.repo.toLowerCase()}#${v.number}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(v);
    if (out.length >= MAX_RECENT_ISSUES) break;
  }
  return out;
}

async function getRecentIssues() {
  if (!chrome?.storage?.local) return [];
  const out = await chrome.storage.local.get(STORAGE_KEYS.recentIssues);
  return normalizeRecentIssues(out[STORAGE_KEYS.recentIssues]);
}

async function addRecentIssue(entry) {
  if (!chrome?.storage?.local) return;
  const cur = await getRecentIssues();
  const merged = normalizeRecentIssues([{ ...entry, filedAt: new Date().toISOString() }, ...cur]);
  await chrome.storage.local.set({ [STORAGE_KEYS.recentIssues]: merged });
}

async function clearRecentIssues() {
  if (!chrome?.storage?.local) return;
  await chrome.storage.local.remove(STORAGE_KEYS.recentIssues);
}

async function removeRecentIssue(repo, number) {
  if (!chrome?.storage?.local) return;
  const cur = await getRecentIssues();
  const next = cur.filter((i) => !(i.repo.toLowerCase() === String(repo).toLowerCase() && i.number === Number(number)));
  await chrome.storage.local.set({ [STORAGE_KEYS.recentIssues]: next });
}

// ---------------------------------------------------------------------------
// Quote history — searchable archive of every filed quote.
// ---------------------------------------------------------------------------
function normalizeQuoteHistory(list) {
  if (!Array.isArray(list)) return [];
  const valid = [];
  for (const raw of list) {
    if (!raw || typeof raw !== "object") continue;
    const selectionText = String(raw.selectionText || "").slice(0, QUOTE_HISTORY_SNIPPET_MAX);
    const title = String(raw.title || "").slice(0, 280);
    if (!selectionText.trim() && !title.trim()) continue;
    const repo = String(raw.repo || "").trim();
    if (repo && !/^[^\s/]+\/[^\s/]+$/.test(repo)) continue;
    const number = Number(raw.number);
    const htmlUrl = String(raw.htmlUrl || "").trim();
    const pageUrl = String(raw.pageUrl || "").slice(0, 800);
    const pageTitle = String(raw.pageTitle || "").slice(0, 280);
    const filedAt = typeof raw.filedAt === "string" ? raw.filedAt : new Date().toISOString();
    const id = String(raw.id || `${repo}#${number}#${filedAt}`);
    valid.push({
      id, repo, number: Number.isFinite(number) && number > 0 ? number : 0,
      htmlUrl: /^https?:\/\//.test(htmlUrl) ? htmlUrl : "",
      title, selectionText, pageTitle, pageUrl, filedAt,
    });
  }
  valid.sort((a, b) => (Date.parse(b.filedAt) || 0) - (Date.parse(a.filedAt) || 0));
  const out = [];
  const seen = new Set();
  for (const v of valid) {
    if (seen.has(v.id)) continue;
    seen.add(v.id);
    out.push(v);
    if (out.length >= MAX_QUOTE_HISTORY) break;
  }
  return out;
}

function searchQuoteHistory(list, query) {
  const items = Array.isArray(list) ? list : [];
  const q = String(query || "").trim().toLowerCase();
  if (!q) return items;
  const terms = q.split(/\s+/).filter(Boolean);
  if (!terms.length) return items;
  const matches = [];
  for (const it of items) {
    const hay = `${it.title || ""}\n${it.selectionText || ""}\n${it.repo || ""}\n${it.pageTitle || ""}\n${it.pageUrl || ""}`.toLowerCase();
    let hits = 0;
    let ok = true;
    for (const t of terms) {
      if (hay.includes(t)) hits += 1;
      else { ok = false; break; }
    }
    if (ok) matches.push({ item: it, score: hits });
  }
  matches.sort((a, b) => b.score - a.score || (Date.parse(b.item.filedAt) || 0) - (Date.parse(a.item.filedAt) || 0));
  return matches.map((m) => m.item);
}

async function getQuoteHistory() {
  if (!chrome?.storage?.local) return [];
  const out = await chrome.storage.local.get(STORAGE_KEYS.quoteHistory);
  return normalizeQuoteHistory(out[STORAGE_KEYS.quoteHistory]);
}

async function addQuoteHistory(entry) {
  if (!chrome?.storage?.local) return;
  const cur = await getQuoteHistory();
  const stamped = { ...entry, filedAt: entry?.filedAt || new Date().toISOString() };
  const merged = normalizeQuoteHistory([stamped, ...cur]);
  await chrome.storage.local.set({ [STORAGE_KEYS.quoteHistory]: merged });
}

async function clearQuoteHistory() {
  if (!chrome?.storage?.local) return;
  await chrome.storage.local.remove(STORAGE_KEYS.quoteHistory);
}

async function removeQuoteHistoryEntry(id) {
  if (!chrome?.storage?.local || !id) return;
  const cur = await getQuoteHistory();
  const next = cur.filter((e) => e.id !== id);
  await chrome.storage.local.set({ [STORAGE_KEYS.quoteHistory]: next });
}

// ---------------------------------------------------------------------------
// Offline queue — mirror of background's normalizer for popup consumers.
// The background service worker owns the truth; popup only reads/clears.
// ---------------------------------------------------------------------------
const MAX_OFFLINE_QUEUE = 25;
const MAX_QUEUE_ATTEMPTS = 8;

function normalizeOfflineQueue(list) {
  if (!Array.isArray(list)) return [];
  const valid = [];
  for (const raw of list) {
    if (!raw || typeof raw !== "object") continue;
    const p = raw.payload || raw;
    const repo = String(p.repo || "").trim();
    if (!/^[^\s/]+\/[^\s/]+$/.test(repo)) continue;
    const title = String(p.title || "").trim();
    if (!title) continue;
    const labels = Array.isArray(p.labels) ? p.labels.map((s) => String(s).trim()).filter(Boolean).slice(0, 24) : [];
    const assignees = Array.isArray(p.assignees) ? p.assignees.map((s) => String(s).trim().replace(/^@+/, "")).filter(Boolean).slice(0, 10) : [];
    const id = String(raw.id || "") || `q_${Math.random().toString(36).slice(2, 10)}`;
    const body = String(p.body || "");
    const attempts = Math.max(0, Math.min(MAX_QUEUE_ATTEMPTS + 1, Number(raw.attempts) || 0));
    const queuedAt = typeof raw.queuedAt === "string" ? raw.queuedAt : new Date().toISOString();
    const lastError = typeof raw.lastError === "string" ? raw.lastError.slice(0, 400) : "";
    const lastTriedAt = typeof raw.lastTriedAt === "string" ? raw.lastTriedAt : "";
    valid.push({ id, payload: { repo, title, body, labels, assignees }, attempts, queuedAt, lastTriedAt, lastError });
  }
  valid.sort((a, b) => (Date.parse(b.queuedAt) || 0) - (Date.parse(a.queuedAt) || 0));
  const seen = new Set();
  const out = [];
  for (const v of valid) {
    if (seen.has(v.id)) continue;
    seen.add(v.id);
    out.push(v);
    if (out.length >= MAX_OFFLINE_QUEUE) break;
  }
  return out;
}

function isRetryableErrorMessage(msg) {
  const s = String(msg || "");
  if (!s) return false;
  if (/network|failed to fetch|offline|abort|timeout|temporarily/i.test(s)) return true;
  if (/\b(5\d{2}|408|429)\b/.test(s)) return true;
  return false;
}

async function getOfflineQueue() {
  try {
    const reply = await chrome.runtime.sendMessage({ type: "getOfflineQueue" });
    return Array.isArray(reply?.result) ? normalizeOfflineQueue(reply.result) : [];
  } catch { return []; }
}

async function flushOfflineQueue() {
  try {
    const reply = await chrome.runtime.sendMessage({ type: "flushOfflineQueue" });
    return reply?.result || null;
  } catch { return null; }
}

async function clearOfflineQueue() {
  try { await chrome.runtime.sendMessage({ type: "clearOfflineQueue" }); } catch { /* ignore */ }
}

async function removeOfflineItem(id) {
  try { await chrome.runtime.sendMessage({ type: "removeOfflineItem", id }); } catch { /* ignore */ }
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

// ---------------------------------------------------------------------------
// Per-repo issue type picker (bug / feature / question)
// ---------------------------------------------------------------------------

const ISSUE_TYPE_PRESETS = Object.freeze({
  bug: Object.freeze(["bug"]),
  feature: Object.freeze(["enhancement"]),
  question: Object.freeze(["question"]),
});
const ISSUE_TYPE_KEYS = Object.freeze(["bug", "feature", "question"]);

function normalizeIssueType(t) {
  if (typeof t !== "string") return null;
  const k = t.trim().toLowerCase();
  return ISSUE_TYPE_KEYS.includes(k) ? k : null;
}

function issueTypeLabels(type) {
  const k = normalizeIssueType(type);
  if (!k) return [];
  return ISSUE_TYPE_PRESETS[k].slice();
}

function normalizeRepoIssueTypes(raw) {
  if (!raw || typeof raw !== "object") return {};
  const out = {};
  for (const [k, v] of Object.entries(raw)) {
    const key = repoKey(k);
    if (!key) continue;
    const t = normalizeIssueType(typeof v === "string" ? v : v?.type);
    if (!t) continue;
    out[key] = t;
  }
  return out;
}

async function getAllRepoIssueTypes() {
  if (!chrome?.storage?.local) return {};
  const out = await chrome.storage.local.get(STORAGE_KEYS.repoIssueTypes);
  return normalizeRepoIssueTypes(out[STORAGE_KEYS.repoIssueTypes]);
}

async function getRepoIssueType(repo) {
  const key = repoKey(repo);
  if (!key) return null;
  const all = await getAllRepoIssueTypes();
  return all[key] || null;
}

async function setRepoIssueType(repo, type) {
  const key = repoKey(repo);
  if (!key || !chrome?.storage?.local) return null;
  const all = await getAllRepoIssueTypes();
  const t = normalizeIssueType(type);
  if (!t) {
    if (all[key]) { delete all[key]; await chrome.storage.local.set({ [STORAGE_KEYS.repoIssueTypes]: all }); }
    return null;
  }
  all[key] = t;
  await chrome.storage.local.set({ [STORAGE_KEYS.repoIssueTypes]: all });
  return t;
}

// expose for tests
if (typeof globalThis !== "undefined") {
  globalThis.__qti = {
    parseRepo, parseLabels, parseAssignees, deriveTitle, firstSentence, smartTruncate, buildMarkdownBody, buildCodeFence, buildSourceUrlWithAnchor, deriveScreenshotFilename,
    formatBytes, formatPublishDate, normalizeRecentRepos, filterRecentRepos, fuzzyMatch,
    normalizeRepoTemplates, renderTemplate, DEFAULT_TEMPLATE, MAX_TEMPLATE_LEN,
    normalizeRepoDefaults,
    normalizeDrafts, MAX_DRAFTS,
    normalizeBulkQuotes, MAX_BULK_QUOTES,
    normalizeRecentIssues, MAX_RECENT_ISSUES,
    normalizeQuoteHistory, searchQuoteHistory, MAX_QUOTE_HISTORY,
    normalizeOfflineQueue, MAX_OFFLINE_QUEUE, isRetryableErrorMessage,
    extractDupTokens, scoreDuplicateMatch, rankDuplicates,
    normalizeRepoIssueTypes, normalizeIssueType, issueTypeLabels, ISSUE_TYPE_PRESETS, ISSUE_TYPE_KEYS,
    renderMarkdownPreview, escapeHtml,
    normalizeCaptureSettings, DEFAULT_CAPTURE_SETTINGS,
    CONTEXT_RADIUS_MIN, CONTEXT_RADIUS_MAX,
    scrubUrlForPrivacy, scrubAuthParamsOnly, applyPrivacyToQuote,
    PRIVACY_AUTH_PARAM_RE, PRIVACY_TRACKING_PARAM_RE,
    detectSelectionLanguage, languageLabelFor, mergeLanguageLabel,
    LANGUAGE_LABEL_PREFIX, LANG_KNOWN_CODES,
  };
}

// ---------------------------------------------------------------------------
// Annotator — draw rectangles/arrows over the captured screenshot
// ---------------------------------------------------------------------------
const ANNOTATOR_PALETTE = ["#ef4444", "#f59e0b", "#10b981", "#3b82f6"];

function drawAnnotatorShape(ctx, shape, scale) {
  if (!shape) return;
  ctx.save();
  ctx.strokeStyle = shape.color || "#ef4444";
  ctx.fillStyle = shape.color || "#ef4444";
  const lw = Math.max(2, Math.round(3 * scale));
  ctx.lineWidth = lw;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  if (shape.type === "rect") {
    const x = Math.min(shape.x1, shape.x2);
    const y = Math.min(shape.y1, shape.y2);
    const w = Math.abs(shape.x2 - shape.x1);
    const h = Math.abs(shape.y2 - shape.y1);
    const r = Math.min(8 * scale, Math.min(w, h) / 4);
    ctx.beginPath();
    if (typeof ctx.roundRect === "function" && r > 0) {
      ctx.roundRect(x, y, w, h, r);
    } else {
      ctx.rect(x, y, w, h);
    }
    ctx.stroke();
  } else if (shape.type === "arrow") {
    const { x1, y1, x2, y2 } = shape;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
    const angle = Math.atan2(y2 - y1, x2 - x1);
    const head = Math.max(10, lw * 4);
    const a1 = angle + Math.PI - Math.PI / 6;
    const a2 = angle + Math.PI + Math.PI / 6;
    ctx.beginPath();
    ctx.moveTo(x2, y2);
    ctx.lineTo(x2 + head * Math.cos(a1), y2 + head * Math.sin(a1));
    ctx.lineTo(x2 + head * Math.cos(a2), y2 + head * Math.sin(a2));
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}

function renderAnnotatorCanvas(ctx, img, shapes, scale) {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  ctx.drawImage(img, 0, 0, ctx.canvas.width, ctx.canvas.height);
  for (const s of shapes) drawAnnotatorShape(ctx, s, scale);
}

async function openAnnotator(quote) {
  const shot = quote?.screenshot;
  if (!shot?.dataUrl) return;
  const tpl = document.getElementById("tpl-annotator");
  if (!tpl) return;

  const frag = tpl.content.cloneNode(true);
  const overlay = frag.querySelector("[data-annotator]");
  document.body.appendChild(overlay);

  // Load image first so we know native size.
  const img = new Image();
  await new Promise((resolve, reject) => {
    img.onload = resolve;
    img.onerror = () => reject(new Error("image load failed"));
    img.src = shot.dataUrl;
  });
  const nativeW = img.naturalWidth || shot.width || 1280;
  const nativeH = img.naturalHeight || shot.height || 720;

  const canvas = overlay.querySelector('[data-field="annotator-canvas"]');
  const wrap = overlay.querySelector('[data-field="annotator-canvas-wrap"]');
  canvas.width = nativeW;
  canvas.height = nativeH;
  // CSS sizing: fit canvas inside wrap maintaining aspect ratio. The wrap has
  // a constrained max-width/max-height in CSS; canvas just stretches to fit.
  canvas.style.width = "100%";
  canvas.style.height = "auto";
  const ctx = canvas.getContext("2d");

  const shapes = [];
  let tool = "rect";
  let color = ANNOTATOR_PALETTE[0];
  let drawing = null;
  let scale = 1;

  const undoBtn = overlay.querySelector('[data-action="annotator-undo"]');
  const clearBtn = overlay.querySelector('[data-action="annotator-clear"]');
  const saveBtn = overlay.querySelector('[data-action="annotator-save"]');

  function refreshButtons() {
    const has = shapes.length > 0;
    if (undoBtn) undoBtn.disabled = !has;
    if (clearBtn) clearBtn.disabled = !has;
  }

  function repaint() {
    const previewShapes = drawing ? shapes.concat([drawing]) : shapes;
    renderAnnotatorCanvas(ctx, img, previewShapes, scale);
  }

  function updateScale() {
    // scale = native-px per CSS-px. Higher scale → thicker strokes so they
    // render visibly when the canvas is shrunk to fit the panel.
    const cssW = canvas.getBoundingClientRect().width || nativeW;
    scale = cssW > 0 ? nativeW / cssW : 1;
  }

  function pointerToNative(ev) {
    const r = canvas.getBoundingClientRect();
    const x = ((ev.clientX - r.left) / r.width) * nativeW;
    const y = ((ev.clientY - r.top) / r.height) * nativeH;
    return {
      x: Math.max(0, Math.min(nativeW, x)),
      y: Math.max(0, Math.min(nativeH, y)),
    };
  }

  function onPointerDown(ev) {
    if (ev.button !== undefined && ev.button !== 0) return;
    ev.preventDefault();
    canvas.setPointerCapture?.(ev.pointerId);
    updateScale();
    const p = pointerToNative(ev);
    drawing = { type: tool, color, x1: p.x, y1: p.y, x2: p.x, y2: p.y };
    repaint();
  }
  function onPointerMove(ev) {
    if (!drawing) return;
    const p = pointerToNative(ev);
    drawing.x2 = p.x;
    drawing.y2 = p.y;
    repaint();
  }
  function onPointerUp(ev) {
    if (!drawing) return;
    try { canvas.releasePointerCapture?.(ev.pointerId); } catch {}
    const dx = Math.abs(drawing.x2 - drawing.x1);
    const dy = Math.abs(drawing.y2 - drawing.y1);
    if (dx + dy > 6) shapes.push(drawing);
    drawing = null;
    refreshButtons();
    repaint();
  }

  canvas.addEventListener("pointerdown", onPointerDown);
  canvas.addEventListener("pointermove", onPointerMove);
  canvas.addEventListener("pointerup", onPointerUp);
  canvas.addEventListener("pointercancel", onPointerUp);

  overlay.querySelectorAll("[data-tool]").forEach((btn) => {
    btn.addEventListener("click", () => {
      tool = btn.dataset.tool === "arrow" ? "arrow" : "rect";
      overlay.querySelectorAll("[data-tool]").forEach((b) => {
        const active = b === btn;
        if (active) b.setAttribute("data-active", "true"); else b.removeAttribute("data-active");
        b.setAttribute("aria-pressed", active ? "true" : "false");
      });
    });
  });
  overlay.querySelectorAll("[data-color]").forEach((btn) => {
    btn.addEventListener("click", () => {
      color = btn.dataset.color || ANNOTATOR_PALETTE[0];
      overlay.querySelectorAll("[data-color]").forEach((b) => {
        const active = b === btn;
        if (active) b.setAttribute("data-active", "true"); else b.removeAttribute("data-active");
        b.setAttribute("aria-pressed", active ? "true" : "false");
      });
    });
  });

  undoBtn?.addEventListener("click", () => { shapes.pop(); refreshButtons(); repaint(); });
  clearBtn?.addEventListener("click", () => { shapes.length = 0; refreshButtons(); repaint(); });

  function close() {
    document.removeEventListener("keydown", onKey);
    window.removeEventListener("resize", onResize);
    overlay.remove();
  }
  function onKey(ev) {
    if (ev.key === "Escape") { ev.preventDefault(); close(); }
  }
  function onResize() { updateScale(); repaint(); }
  document.addEventListener("keydown", onKey);
  window.addEventListener("resize", onResize);

  overlay.querySelectorAll('[data-action="annotator-cancel"]').forEach((b) => {
    b.addEventListener("click", (ev) => { ev.preventDefault(); close(); });
  });

  saveBtn?.addEventListener("click", async () => {
    saveBtn.disabled = true;
    try {
      // Always render final shapes to a clean canvas at native res.
      renderAnnotatorCanvas(ctx, img, shapes, 1);
      const dataUrl = canvas.toDataURL("image/png");
      const bytes = Math.floor((dataUrl.length - "data:image/png;base64,".length) * 3 / 4);
      const next = {
        ...quote,
        screenshot: {
          ...quote.screenshot,
          dataUrl,
          width: nativeW,
          height: nativeH,
          bytes,
          annotated: true,
          annotatedAt: new Date().toISOString(),
        },
      };
      await chrome.storage.local.set({ [STORAGE_KEYS.pendingQuote]: next });
      close();
    } catch (err) {
      console.warn(LOG, "annotator save failed", err);
      saveBtn.disabled = false;
    }
  });

  // First paint after layout.
  requestAnimationFrame(() => { updateScale(); repaint(); refreshButtons(); });
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
    assignees: draft.assignees || "",
    draftId: draft.id,
  });
  const frag = document.createDocumentFragment();
  if (draft.quote?.selectionText) frag.appendChild(renderQuoteCard(draft.quote));
  frag.appendChild(buildFormNode(q, {
    repo: draft.repo, title: draft.title, labels: draft.labels, assignees: draft.assignees, draftId: draft.id,
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

  if (q.author) {
    const r = node.querySelector("[data-byline-row]");
    if (r) r.hidden = false;
    setText("author", q.author);
  }
  if (q.publishedAt) {
    const r = node.querySelector("[data-published-row]");
    if (r) r.hidden = false;
    setText("publishedAt", formatPublishDate(q.publishedAt));
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
    const markBtn = node.querySelector('[data-action="annotate-shot"]');
    markBtn?.addEventListener("click", () => {
      openAnnotator(q).catch((err) => console.warn(LOG, "annotator failed", err));
    });
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
  const issueTypeRow = node.querySelector("[data-issue-type-row]");
  const issueTypeBtns = issueTypeRow ? Array.from(issueTypeRow.querySelectorAll('[data-action="set-issue-type"]')) : [];
  const issueTypeStatus = node.querySelector('[data-field="issue-type-status"]');
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

  // Milestone picker refs
  const milestoneRow = node.querySelector("[data-milestone-row]");
  const milestoneBtn = node.querySelector('[data-action="open-milestones"]');
  const milestoneLabel = node.querySelector('[data-field="milestone-label"]');
  const milestonePanel = node.querySelector("[data-milestone-panel]");
  const milestoneStatus = node.querySelector('[data-field="milestone-status"]');
  const milestoneRefresh = node.querySelector('[data-action="refresh-milestones"]');
  const milestoneClear = node.querySelector('[data-action="clear-milestone"]');
  let activeMilestone = null;       // { number, title }
  let milestoneItems = [];          // cached list for current repo
  let milestonePanelOpen = false;
  let milestoneRepoKey = "";        // repo for which milestoneItems is loaded


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
      renderRepoValue(row.querySelector(".repo-recent-value"), entry.value, entry._matchIndices);
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
  if (assigneesInput) assigneesInput.value = state.assignees || "";
  // Auto-tag with detected selection language (lang:<code>) when enabled.
  // Only fires on fresh form state (no prior saved labels) so user edits stick.
  if (!state.labels) {
    getCaptureSettings()
      .then((s) => {
        if (!s.languageLabelEnabled) return;
        const code = detectSelectionLanguage(q?.selectionText || "");
        if (!code) return;
        const cur = parseLabels(labelsInput.value);
        const merged = mergeLanguageLabel(cur, code);
        if (merged.join(",").toLowerCase() === cur.join(",").toLowerCase()) return;
        labelsInput.value = merged.join(", ");
        renderLabelChips(chipRow, parseLabels(labelsInput.value), (val) => {
          const next = parseLabels(labelsInput.value).filter((x) => x !== val);
          labelsInput.value = next.join(", ");
          labelsInput.dispatchEvent(new Event("input", { bubbles: true }));
        });
        saveFormState({ labels: labelsInput.value });
      })
      .catch(() => {});
  }
  renderLabelChips(chipRow, parseLabels(labelsInput.value), (val) => {
    const next = parseLabels(labelsInput.value).filter((x) => x !== val);
    labelsInput.value = next.join(", ");
    labelsInput.dispatchEvent(new Event("input", { bubbles: true }));
  });
  if (assigneesInput && assigneeChipRow) {
    renderLabelChips(assigneeChipRow, parseAssignees(assigneesInput.value), (val) => {
      const next = parseAssignees(assigneesInput.value).filter((x) => x.toLowerCase() !== val.toLowerCase());
      assigneesInput.value = next.join(", ");
      assigneesInput.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }
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
        : "Placeholders: {{selection}}, {{quote_blockquote}}, {{title}}, {{url}}, {{date}}, {{section}}, {{author}}, {{screenshot_note}}.";
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
  loadDefaultsForRepo();
  loadIssueTypeForRepo();

  repoInput.addEventListener("input", () => {
    validateRepo();
    saveFormState({ repo: repoInput.value });
    activeRecentIndex = -1;
    if (recentsOpen) renderRecentsList();
    else if (recents.length > 0 && document.activeElement === repoInput) openRecents();
    loadTemplateForRepo();
    defaultsAutoApplied = false;
    loadDefaultsForRepo();
    issueTypeAutoApplied = false;
    loadIssueTypeForRepo();
    // Reset milestone state on repo change; loaded lazily.
    activeMilestone = null;
    milestoneItems = [];
    milestoneRepoKey = "";
    updateMilestoneLabel?.();
    if (typeof loadMilestonesForCurrentRepo === "function") loadMilestonesForCurrentRepo().catch(() => {});
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
    renderLabelChips(chipRow, parseLabels(labelsInput.value), (val) => {
      const next = parseLabels(labelsInput.value).filter((x) => x !== val);
      labelsInput.value = next.join(", ");
      labelsInput.dispatchEvent(new Event("input", { bubbles: true }));
    });
    saveFormState({ labels: labelsInput.value });
    refreshDefaultsStatus();
  });
  assigneesInput?.addEventListener("input", () => {
    renderLabelChips(assigneeChipRow, parseAssignees(assigneesInput.value), (val) => {
      const next = parseAssignees(assigneesInput.value).filter((x) => x.toLowerCase() !== val.toLowerCase());
      assigneesInput.value = next.join(", ");
      assigneesInput.dispatchEvent(new Event("input", { bubbles: true }));
    });
    saveFormState({ assignees: assigneesInput.value });
    refreshDefaultsStatus();
  });

  // --- Per-repo issue type picker ----------------------------------------
  let activeIssueType = null;
  let issueTypeAutoApplied = false;
  function setIssueTypeButtons(type) {
    for (const btn of issueTypeBtns) {
      const on = btn.dataset.issueType === type;
      btn.setAttribute("aria-checked", on ? "true" : "false");
    }
  }
  function showIssueTypeStatus(msg, state) {
    if (!issueTypeStatus) return;
    if (!msg) { issueTypeStatus.hidden = true; issueTypeStatus.textContent = ""; return; }
    issueTypeStatus.hidden = false;
    issueTypeStatus.dataset.state = state || "applied";
    issueTypeStatus.textContent = msg;
  }
  function mergeLabels(existing, preset) {
    const seen = new Set();
    const out = [];
    for (const l of [...existing, ...preset]) {
      const k = String(l || "").trim();
      if (!k) continue;
      const key = k.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(k);
    }
    return out;
  }
  function applyIssueType(type, { persist = true, statusMsg } = {}) {
    const t = normalizeIssueType(type);
    activeIssueType = t;
    setIssueTypeButtons(t);
    if (!t) {
      showIssueTypeStatus("", "");
      return;
    }
    const preset = issueTypeLabels(t);
    const existing = parseLabels(labelsInput.value);
    const merged = mergeLabels(existing, preset);
    if (merged.join(",") !== existing.join(",")) {
      labelsInput.value = merged.join(", ");
      labelsInput.dispatchEvent(new Event("input", { bubbles: true }));
    }
    if (statusMsg !== undefined) showIssueTypeStatus(statusMsg, "applied");
    else showIssueTypeStatus(`${t} preset applied`, "applied");
    if (persist) {
      const repoParsed = parseRepo(repoInput.value);
      if (repoParsed.ok) setRepoIssueType(repoParsed.value, t).catch(() => {});
    }
  }
  async function loadIssueTypeForRepo() {
    const repoParsed = parseRepo(repoInput.value);
    if (!repoParsed.ok) {
      activeIssueType = null;
      issueTypeAutoApplied = false;
      setIssueTypeButtons(null);
      showIssueTypeStatus("", "");
      return;
    }
    const saved = await getRepoIssueType(repoParsed.value).catch(() => null);
    if (saved && !issueTypeAutoApplied) {
      issueTypeAutoApplied = true;
      applyIssueType(saved, { persist: false, statusMsg: `${saved} · saved for ${repoParsed.value}` });
    } else if (!saved) {
      activeIssueType = null;
      setIssueTypeButtons(null);
      showIssueTypeStatus("", "");
    }
  }
  for (const btn of issueTypeBtns) {
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      const t = btn.dataset.issueType;
      if (activeIssueType === t) {
        // Toggle off
        activeIssueType = null;
        setIssueTypeButtons(null);
        showIssueTypeStatus("", "");
        const repoParsed = parseRepo(repoInput.value);
        if (repoParsed.ok) setRepoIssueType(repoParsed.value, null).catch(() => {});
        return;
      }
      issueTypeAutoApplied = true;
      applyIssueType(t);
    });
  }

  // --- Per-repo defaults (labels + assignees) -----------------------------
  function applyDefaults(d) {
    if (!d) return;
    if (Array.isArray(d.labels) && d.labels.length) {
      labelsInput.value = d.labels.join(", ");
      labelsInput.dispatchEvent(new Event("input", { bubbles: true }));
    }
    if (assigneesInput && Array.isArray(d.assignees) && d.assignees.length) {
      assigneesInput.value = d.assignees.join(", ");
      assigneesInput.dispatchEvent(new Event("input", { bubbles: true }));
    }
  }
  function refreshDefaultsStatus() {
    if (!defaultsStatus) return;
    const repoParsed = parseRepo(repoInput.value);
    if (!repoParsed.ok) {
      defaultsStatus.dataset.state = "empty";
      defaultsStatus.textContent = "Enter a repo to save defaults.";
      if (defaultsApplyBtn) defaultsApplyBtn.disabled = true;
      if (defaultsClearBtn) defaultsClearBtn.disabled = true;
      if (defaultsSaveBtn) defaultsSaveBtn.disabled = true;
      return;
    }
    const labs = parseLabels(labelsInput.value);
    const asgs = assigneesInput ? parseAssignees(assigneesInput.value) : [];
    const hasAny = labs.length + asgs.length > 0;
    if (activeDefaults) {
      defaultsStatus.dataset.state = "saved";
      const labStr = activeDefaults.labels.length ? `labels: ${activeDefaults.labels.join(", ")}` : "";
      const asgStr = activeDefaults.assignees.length ? `assignees: ${activeDefaults.assignees.map((a) => "@" + a).join(", ")}` : "";
      defaultsStatus.textContent = `Defaults for ${repoParsed.value} \u00b7 ${[labStr, asgStr].filter(Boolean).join(" \u00b7 ")}`;
      if (defaultsApplyBtn) defaultsApplyBtn.disabled = false;
      if (defaultsClearBtn) defaultsClearBtn.disabled = false;
    } else {
      defaultsStatus.dataset.state = "empty";
      defaultsStatus.textContent = `No defaults saved for ${repoParsed.value}.`;
      if (defaultsApplyBtn) defaultsApplyBtn.disabled = true;
      if (defaultsClearBtn) defaultsClearBtn.disabled = true;
    }
    if (defaultsSaveBtn) defaultsSaveBtn.disabled = !hasAny;
  }
  async function loadDefaultsForRepo() {
    const repoParsed = parseRepo(repoInput.value);
    if (!repoParsed.ok) {
      activeDefaults = null;
      defaultsAutoApplied = false;
      refreshDefaultsStatus();
      return;
    }
    activeDefaults = await getRepoDefaults(repoParsed.value).catch(() => null);
    // Auto-apply once per repo when label/assignee fields are empty.
    const labsEmpty = parseLabels(labelsInput.value).length === 0;
    const asgsEmpty = assigneesInput ? parseAssignees(assigneesInput.value).length === 0 : true;
    if (activeDefaults && !defaultsAutoApplied && labsEmpty && asgsEmpty) {
      defaultsAutoApplied = true;
      applyDefaults(activeDefaults);
    }
    refreshDefaultsStatus();
  }
  defaultsApplyBtn?.addEventListener("click", (e) => {
    e.preventDefault();
    if (activeDefaults) applyDefaults(activeDefaults);
  });
  defaultsSaveBtn?.addEventListener("click", async (e) => {
    e.preventDefault();
    const repoParsed = parseRepo(repoInput.value);
    if (!repoParsed.ok) return;
    defaultsSaveBtn.disabled = true;
    try {
      activeDefaults = await setRepoDefaults(repoParsed.value, {
        labels: parseLabels(labelsInput.value),
        assignees: assigneesInput ? parseAssignees(assigneesInput.value) : [],
      });
      defaultsAutoApplied = true;
      refreshDefaultsStatus();
    } catch (err) {
      if (defaultsStatus) {
        defaultsStatus.dataset.state = "err";
        defaultsStatus.textContent = `Save failed: ${err?.message || err}`;
      }
      defaultsSaveBtn.disabled = false;
    }
  });
  defaultsClearBtn?.addEventListener("click", async (e) => {
    e.preventDefault();
    const repoParsed = parseRepo(repoInput.value);
    if (!repoParsed.ok) return;
    await clearRepoDefaults(repoParsed.value).catch(() => {});
    activeDefaults = null;
    refreshDefaultsStatus();
  });

  // --- Milestone picker ---------------------------------------------------
  function fmtMilestoneDue(iso) {
    if (!iso) return "";
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "";
    const now = Date.now();
    const ms = d.getTime() - now;
    const days = Math.round(ms / 86400000);
    if (days < -1) return `overdue ${Math.abs(days)}d`;
    if (days === -1) return "overdue 1d";
    if (days === 0) return "due today";
    if (days === 1) return "due tomorrow";
    if (days < 14) return `in ${days}d`;
    return iso.slice(0, 10);
  }
  function updateMilestoneLabel() {
    if (!milestoneLabel) return;
    if (activeMilestone && activeMilestone.number) {
      milestoneLabel.textContent = activeMilestone.title || `#${activeMilestone.number}`;
      if (milestoneClear) milestoneClear.hidden = false;
    } else {
      milestoneLabel.textContent = "No milestone";
      if (milestoneClear) milestoneClear.hidden = true;
    }
  }
  function setMilestoneStatus(msg, state) {
    if (!milestoneStatus) return;
    milestoneStatus.textContent = msg || "";
    milestoneStatus.dataset.state = state || "idle";
  }
  function closeMilestonePanel() {
    milestonePanelOpen = false;
    if (milestonePanel) milestonePanel.hidden = true;
    if (milestoneBtn) milestoneBtn.setAttribute("aria-expanded", "false");
  }
  function openMilestonePanel() {
    if (!milestonePanel) return;
    milestonePanelOpen = true;
    milestonePanel.hidden = false;
    if (milestoneBtn) milestoneBtn.setAttribute("aria-expanded", "true");
    renderMilestoneOptions();
  }
  function renderMilestoneOptions() {
    if (!milestonePanel) return;
    milestonePanel.replaceChildren();
    if (!milestoneItems.length) {
      const empty = document.createElement("div");
      empty.className = "milestone-panel-empty";
      const repoParsed = parseRepo(repoInput.value);
      empty.textContent = repoParsed.ok ? "No open milestones in this repo." : "Enter a repo first.";
      milestonePanel.appendChild(empty);
      return;
    }
    // None option first
    const none = document.createElement("button");
    none.type = "button";
    none.className = "milestone-option";
    none.setAttribute("role", "option");
    if (!activeMilestone) none.setAttribute("aria-selected", "true");
    none.innerHTML = `
      <span class="milestone-option-dot" style="background:transparent;border:1px solid var(--hairline);"></span>
      <span class="milestone-option-title">No milestone</span>`;
    none.addEventListener("click", () => chooseMilestone(null));
    milestonePanel.appendChild(none);
    for (const m of milestoneItems) {
      const row = document.createElement("button");
      row.type = "button";
      row.className = "milestone-option";
      row.setAttribute("role", "option");
      row.dataset.state = m.state;
      if (activeMilestone && activeMilestone.number === m.number) row.setAttribute("aria-selected", "true");
      const due = fmtMilestoneDue(m.dueOn);
      const dueEl = due ? `<span class="milestone-option-due">${due}</span>` : "";
      const titleText = m.title.replace(/[<>&"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" })[c]);
      row.innerHTML = `
        <span class="milestone-option-dot"></span>
        <span class="milestone-option-title" title="${titleText}">${titleText}</span>
        ${dueEl}`;
      row.addEventListener("click", () => chooseMilestone({ number: m.number, title: m.title }));
      milestonePanel.appendChild(row);
    }
  }
  async function chooseMilestone(m) {
    activeMilestone = m && m.number ? { number: m.number, title: m.title || "" } : null;
    updateMilestoneLabel();
    closeMilestonePanel();
    const repoParsed = parseRepo(repoInput.value);
    if (repoParsed.ok) {
      await setRepoMilestonePref(repoParsed.value, activeMilestone).catch(() => {});
    }
    saveFormState({ milestone: activeMilestone ? activeMilestone.number : 0, milestoneTitle: activeMilestone ? activeMilestone.title : "" });
    if (activeMilestone) setMilestoneStatus(`Will assign to “${activeMilestone.title}”.`, "ok");
    else setMilestoneStatus("No milestone selected.", "idle");
  }
  async function fetchMilestonesForRepo(repo, { force = false } = {}) {
    if (!chrome?.runtime?.sendMessage) return;
    if (!force) {
      const cached = await getCachedMilestones(repo).catch(() => null);
      if (cached && !cached.stale) {
        milestoneItems = cached.items;
        milestoneRepoKey = repoKey(repo);
        renderMilestoneOptions();
        setMilestoneStatus(`${cached.items.length} open milestone${cached.items.length === 1 ? "" : "s"} (cached).`, "idle");
        return;
      }
    }
    if (milestoneRefresh) milestoneRefresh.classList.add("loading");
    setMilestoneStatus("Loading milestones…", "idle");
    try {
      const reply = await chrome.runtime.sendMessage({ type: "listMilestones", repo, state: "open" });
      if (!reply?.ok) throw new Error(reply?.error || "Failed to fetch milestones");
      const items = normalizeMilestoneList(reply.result?.items || []);
      milestoneItems = items;
      milestoneRepoKey = repoKey(repo);
      await setCachedMilestones(repo, items).catch(() => {});
      renderMilestoneOptions();
      setMilestoneStatus(items.length ? `${items.length} open milestone${items.length === 1 ? "" : "s"}.` : "No open milestones.", items.length ? "ok" : "idle");
    } catch (err) {
      setMilestoneStatus(String(err?.message || err).slice(0, 160), "err");
    } finally {
      if (milestoneRefresh) milestoneRefresh.classList.remove("loading");
    }
  }
  async function loadMilestonesForCurrentRepo({ force = false } = {}) {
    const repoParsed = parseRepo(repoInput.value);
    if (!repoParsed.ok) {
      milestoneItems = [];
      milestoneRepoKey = "";
      activeMilestone = null;
      updateMilestoneLabel();
      setMilestoneStatus("Enter a repo to pick a milestone.", "idle");
      renderMilestoneOptions();
      return;
    }
    const key = repoKey(repoParsed.value);
    // Restore saved preference if switching repos.
    if (key !== milestoneRepoKey) {
      activeMilestone = null;
      const pref = await getRepoMilestonePref(repoParsed.value).catch(() => null);
      if (pref && Number.isFinite(pref.number) && pref.number > 0) {
        activeMilestone = { number: pref.number, title: pref.title || "" };
      }
      updateMilestoneLabel();
    }
    await fetchMilestonesForRepo(repoParsed.value, { force });
    // Reconcile activeMilestone with fresh list (title may have changed).
    if (activeMilestone) {
      const found = milestoneItems.find((m) => m.number === activeMilestone.number);
      if (found) {
        activeMilestone = { number: found.number, title: found.title };
        updateMilestoneLabel();
      }
    }
  }
  milestoneBtn?.addEventListener("click", (e) => {
    e.preventDefault();
    if (milestonePanelOpen) { closeMilestonePanel(); return; }
    const repoParsed = parseRepo(repoInput.value);
    if (!repoParsed.ok) {
      setMilestoneStatus("Enter a valid repo first.", "err");
      return;
    }
    openMilestonePanel();
    // If items missing, lazy-load.
    if (!milestoneItems.length) loadMilestonesForCurrentRepo().catch(() => {});
  });
  milestoneRefresh?.addEventListener("click", (e) => {
    e.preventDefault();
    loadMilestonesForCurrentRepo({ force: true }).catch(() => {});
  });
  milestoneClear?.addEventListener("click", (e) => {
    e.preventDefault();
    chooseMilestone(null).catch(() => {});
  });
  document.addEventListener("click", (e) => {
    if (!milestonePanelOpen) return;
    if (!milestoneRow) return;
    if (!milestoneRow.contains(e.target)) closeMilestonePanel();
  });
  // Restore saved milestone from form state on first render.
  if (state.milestone && Number.isFinite(Number(state.milestone))) {
    activeMilestone = { number: Number(state.milestone), title: String(state.milestoneTitle || "") };
    updateMilestoneLabel();
  }
  // Kick off initial load (non-forced, will use cache if fresh).
  loadMilestonesForCurrentRepo().catch(() => {});

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
        assignees: assigneesInput ? assigneesInput.value : "",
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
        assignees: assigneesInput ? parseAssignees(assigneesInput.value) : [],
        milestone: activeMilestone?.number || 0,
      });
      if (!reply?.ok) throw new Error(reply?.error || "Unknown error");
      const created = reply.result || {};
      if (created?.queued) {
        // Offline: stash succeeded only in the queue. Keep the form intact so
        // the user can edit and resubmit if they want, but show a transient
        // confirmation so they know the work isn't lost.
        await addRecentRepo(repo.value).catch(() => {});
        await chrome.storage?.local?.remove?.(STORAGE_KEYS.pendingQuote);
        await saveFormState({ title: "", draftId: null });
        renderQueued({ repo: repo.value, ...created });
        appendOfflineQueueSection().catch(() => {});
        return;
      }
      await addRecentRepo(repo.value);
      if (created?.number && created?.htmlUrl) {
        await addRecentIssue({ repo: repo.value, number: created.number, htmlUrl: created.htmlUrl, title }).catch(() => {});
      }
      await addQuoteHistory({
        id: created?.number ? `${repo.value}#${created.number}` : `${repo.value}#${Date.now()}`,
        repo: repo.value,
        number: created?.number || 0,
        htmlUrl: created?.htmlUrl || "",
        title,
        selectionText: q?.selectionText || "",
        pageTitle: q?.pageTitle || "",
        pageUrl: q?.pageUrl || "",
      }).catch(() => {});
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

  // -------------------------------------------------------------------------
  // Duplicate detector
  // -------------------------------------------------------------------------
  const dupField = node.querySelector("[data-dup-field]");
  const dupStatus = node.querySelector('[data-field="dup-status"]');
  const dupList = node.querySelector("[data-dup-list]");
  const dupCount = node.querySelector('[data-field="dup-count"]');
  const dupRefreshBtn = node.querySelector('[data-action="refresh-dups"]');
  let dupSeq = 0;
  let dupDebounce = null;
  let dupLastKey = "";

  function setDupStatus(text, state) {
    if (!dupStatus) return;
    dupStatus.textContent = text;
    dupStatus.setAttribute("data-state", state || "idle");
  }
  function setDupCount(n) {
    if (!dupCount) return;
    if (n > 0) { dupCount.textContent = String(n); dupCount.hidden = false; }
    else { dupCount.textContent = ""; dupCount.hidden = true; }
  }
  function showDupField(show) {
    if (!dupField) return;
    dupField.hidden = !show;
  }
  function renderDupList(items, tokens) {
    if (!dupList) return;
    dupList.replaceChildren();
    if (!items || items.length === 0) {
      dupList.hidden = true;
      return;
    }
    dupList.hidden = false;
    const ranked = rankDuplicates(items, tokens);
    for (const it of ranked.slice(0, 8)) {
      const li = document.createElement("li");
      li.className = "dup-row";
      const top = document.createElement("div");
      top.className = "dup-row-top";
      const stateEl = document.createElement("span");
      stateEl.className = "dup-row-state";
      stateEl.setAttribute("data-state", it.state || "open");
      stateEl.title = it.state === "closed" ? "closed" : "open";
      stateEl.innerHTML = it.state === "closed"
        ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 12l4 4 8-8"></path></svg>'
        : '<svg viewBox="0 0 24 24" fill="currentColor" stroke="none" aria-hidden="true"><circle cx="12" cy="12" r="5"></circle></svg>';
      const a = document.createElement("a");
      a.className = "dup-row-link";
      a.href = it.htmlUrl;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      a.textContent = it.title || `Issue #${it.number}`;
      const num = document.createElement("span");
      num.className = "dup-row-num";
      num.textContent = `#${it.number}`;
      top.append(stateEl, a, num);
      const meta = document.createElement("div");
      meta.className = "dup-row-meta";
      const pieces = [];
      if (it.updatedAt) pieces.push(fmtRelative(it.updatedAt));
      if (typeof it.comments === "number" && it.comments > 0) pieces.push(`${it.comments} 💬`.replace("💬", "comments"));
      if (it.user) pieces.push(`@${it.user}`);
      meta.textContent = pieces.join(" · ");
      if (Array.isArray(it.labels) && it.labels.length) {
        const labs = document.createElement("span");
        labs.className = "dup-row-labels";
        for (const l of it.labels.slice(0, 4)) {
          const tag = document.createElement("span");
          tag.className = "dup-row-label";
          tag.textContent = l;
          labs.appendChild(tag);
        }
        meta.appendChild(labs);
      }
      li.append(top, meta);
      dupList.appendChild(li);
    }
  }

  async function runDupSearch({ force = false } = {}) {
    if (!dupField) return;
    const repo = parseRepo(repoInput.value);
    const title = titleInput.value.trim();
    if (!repo.ok || title.length < 4) {
      showDupField(false);
      setDupCount(0);
      dupLastKey = "";
      return;
    }
    const selection = (q?.selectionText || "").slice(0, 400);
    const key = `${repo.value}::${title.toLowerCase()}`;
    if (!force && key === dupLastKey) return;
    dupLastKey = key;
    showDupField(true);
    const tokens = extractDupTokens(title, selection);
    if (tokens.length === 0) {
      setDupStatus("Title needs a few descriptive words to search.", "idle");
      if (dupList) { dupList.hidden = true; dupList.replaceChildren(); }
      setDupCount(0);
      return;
    }
    const mySeq = ++dupSeq;
    dupRefreshBtn?.classList.add("loading");
    setDupStatus("Scanning for similar open issues…", "idle");
    try {
      const reply = await chrome.runtime.sendMessage({
        type: "searchSimilarIssues",
        repo: repo.value,
        title,
        selectionText: selection,
        state: "open",
      });
      if (mySeq !== dupSeq) return;
      if (!reply?.ok) throw new Error(reply?.error || "Search failed");
      const items = Array.isArray(reply.result?.items) ? reply.result.items : [];
      renderDupList(items, tokens);
      setDupCount(items.length);
      if (items.length === 0) {
        setDupStatus("No similar open issues found.", "ok");
      } else {
        const label = items.length === 1 ? "1 similar issue" : `${items.length} similar issues`;
        setDupStatus(`${label} — review before filing to avoid duplicates.`, "warn");
      }
    } catch (err) {
      if (mySeq !== dupSeq) return;
      if (dupList) { dupList.hidden = true; dupList.replaceChildren(); }
      setDupCount(0);
      setDupStatus(String(err?.message || err), "err");
    } finally {
      if (mySeq === dupSeq) dupRefreshBtn?.classList.remove("loading");
    }
  }

  function scheduleDupSearch() {
    if (dupDebounce) clearTimeout(dupDebounce);
    dupDebounce = setTimeout(() => runDupSearch().catch(() => {}), 550);
  }
  repoInput.addEventListener("input", scheduleDupSearch);
  titleInput.addEventListener("input", scheduleDupSearch);
  dupRefreshBtn?.addEventListener("click", () => runDupSearch({ force: true }).catch(() => {}));
  // Initial search if the form already has enough info (e.g. loaded draft).
  setTimeout(() => runDupSearch().catch(() => {}), 250);

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
  const contextToggleBtn = node.querySelector('[data-action="toggle-context"]');
  const contextToggleLabel = node.querySelector('[data-field="context-toggle-label"]');
  const contextRangeBox = node.querySelector('[data-context-range]');
  const contextRangeInput = node.querySelector('[data-field="context-radius"]');
  const contextRangeValue = node.querySelector('[data-field="context-radius-value"]');
  const highlightToggleBtn = node.querySelector('[data-action="toggle-highlight"]');
  const highlightToggleLabel = node.querySelector('[data-field="highlight-toggle-label"]');
  const privacyToggleBtn = node.querySelector('[data-action="toggle-privacy"]');
  const privacyToggleLabel = node.querySelector('[data-field="privacy-toggle-label"]');
  const languageToggleBtn = node.querySelector('[data-action="toggle-language"]');
  const languageToggleLabel = node.querySelector('[data-field="language-toggle-label"]');

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

  // Capture-radius wiring — persisted in chrome.storage.local so the
  // service worker can read it for every selection capture.
  if (contextToggleBtn && contextRangeInput) {
    const initial = await getCaptureSettings();
    const applyUi = (s) => {
      const enabled = !!s.contextEnabled;
      contextToggleBtn.setAttribute("aria-pressed", String(enabled));
      if (contextToggleLabel) contextToggleLabel.textContent = enabled ? "On" : "Off";
      if (contextRangeBox) contextRangeBox.dataset.disabled = String(!enabled);
      contextRangeInput.disabled = !enabled;
      contextRangeInput.value = String(enabled ? (s.contextRadius || 0) : 0);
      if (contextRangeValue) contextRangeValue.textContent = String(enabled ? (s.contextRadius || 0) : 0);
    };
    applyUi(initial);
    contextToggleBtn.addEventListener("click", async () => {
      const enabled = contextToggleBtn.getAttribute("aria-pressed") !== "true";
      const radius = enabled ? Math.max(20, Number(contextRangeInput.value) || 240) : 0;
      const next = await setCaptureSettings({ contextEnabled: enabled, contextRadius: radius });
      applyUi(next);
    });
    contextRangeInput.addEventListener("input", () => {
      if (contextRangeValue) contextRangeValue.textContent = String(contextRangeInput.value);
    });
    contextRangeInput.addEventListener("change", async () => {
      const next = await setCaptureSettings({ contextRadius: Number(contextRangeInput.value) || 0, contextEnabled: contextToggleBtn.getAttribute("aria-pressed") === "true" });
      applyUi(next);
    });
  }

  // Highlight-mode wiring — when on, the service worker spotlights the
  // selection rectangles after captureVisibleTab so the screenshot frames
  // exactly what was quoted, with the rest of the page dimmed.
  if (highlightToggleBtn) {
    const cur = await getCaptureSettings();
    const applyHl = (on) => {
      highlightToggleBtn.setAttribute("aria-pressed", String(!!on));
      if (highlightToggleLabel) highlightToggleLabel.textContent = on ? "On" : "Off";
    };
    applyHl(!!cur.highlightMode);
    highlightToggleBtn.addEventListener("click", async () => {
      const next = await setCaptureSettings({ highlightMode: highlightToggleBtn.getAttribute("aria-pressed") !== "true" });
      applyHl(next.highlightMode);
    });
  }

  // Privacy-mode wiring — strips query params + auth tokens from captured
  // URLs (and any frame URL) before they reach storage, the popup form, or
  // the GitHub API submit path. Stored alongside other capture settings.
  if (privacyToggleBtn) {
    const cur = await getCaptureSettings();
    const applyPr = (on) => {
      privacyToggleBtn.setAttribute("aria-pressed", String(!!on));
      if (privacyToggleLabel) privacyToggleLabel.textContent = on ? "On" : "Off";
    };
    applyPr(!!cur.privacyMode);
    privacyToggleBtn.addEventListener("click", async () => {
      const next = await setCaptureSettings({ privacyMode: privacyToggleBtn.getAttribute("aria-pressed") !== "true" });
      applyPr(next.privacyMode);
    });
  }

  // Language-label wiring — when on, the popup auto-tags the issue form with
  // a lang:<code> label inferred from the selection text.
  if (languageToggleBtn) {
    const cur = await getCaptureSettings();
    const applyLang = (on) => {
      languageToggleBtn.setAttribute("aria-pressed", String(!!on));
      if (languageToggleLabel) languageToggleLabel.textContent = on ? "On" : "Off";
    };
    applyLang(!!cur.languageLabelEnabled);
    languageToggleBtn.addEventListener("click", async () => {
      const next = await setCaptureSettings({ languageLabelEnabled: languageToggleBtn.getAttribute("aria-pressed") !== "true" });
      applyLang(next.languageLabelEnabled);
    });
  }

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
  appendRecentIssuesSection().catch(() => {});
  try {
    showSuccessToast({ htmlUrl: info?.htmlUrl, repo: info?.repo, number: info?.number });
  } catch {}
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
  await appendRecentIssuesSection();
  await appendOfflineQueueSection();
  await appendQuoteHistorySection();
}

async function appendRecentIssuesSection() {
  if (!tplRecentIssues || !tplRecentIssueRow) return;
  for (const existing of root.querySelectorAll("[data-recent-issues]")) existing.remove();
  const issues = await getRecentIssues().catch(() => []);
  if (!issues.length) return;
  const frag = tplRecentIssues.content.cloneNode(true);
  const section = frag.querySelector("[data-recent-issues]");
  const list = frag.querySelector("[data-recent-issues-list]");
  const count = frag.querySelector('[data-field="recent-issues-count"]');
  if (count) count.textContent = `${issues.length} · newest first`;
  for (const it of issues) {
    const row = tplRecentIssueRow.content.cloneNode(true);
    const link = row.querySelector('[data-field="recent-issue-link"]');
    const titleEl = row.querySelector('[data-field="recent-issue-title"]');
    const repoEl = row.querySelector('[data-field="recent-issue-repo"]');
    const numEl = row.querySelector('[data-field="recent-issue-number"]');
    const timeEl = row.querySelector('[data-field="recent-issue-time"]');
    const removeBtn = row.querySelector('[data-action="remove-recent-issue"]');
    link.href = it.htmlUrl;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    titleEl.textContent = it.title || `Issue #${it.number}`;
    repoEl.textContent = it.repo;
    numEl.textContent = `#${it.number}`;
    timeEl.textContent = fmtRelative(it.filedAt);
    removeBtn?.addEventListener("click", async (e) => {
      e.preventDefault();
      e.stopPropagation();
      await removeRecentIssue(it.repo, it.number);
      await appendRecentIssuesSection();
    });
    list.appendChild(row);
  }
  const clearBtn = section.querySelector('[data-action="clear-recent-issues"]');
  clearBtn?.addEventListener("click", async () => {
    await clearRecentIssues();
    await appendRecentIssuesSection();
  });
  root.appendChild(section);
  appendOfflineQueueSection().catch(() => {});
  appendQuoteHistorySection().catch(() => {});
}

async function appendQuoteHistorySection(filter) {
  if (!tplQuoteHistory || !tplQuoteHistoryRow) return;
  for (const existing of root.querySelectorAll("[data-quote-history]")) existing.remove();
  const all = await getQuoteHistory().catch(() => []);
  if (!all.length) return;
  const frag = tplQuoteHistory.content.cloneNode(true);
  const section = frag.querySelector("[data-quote-history]");
  const list = frag.querySelector("[data-quote-history-list]");
  const count = frag.querySelector('[data-field="quote-history-count"]');
  const status = frag.querySelector('[data-field="quote-history-status"]');
  const input = frag.querySelector('[data-field="quote-history-query"]');
  let query = String(filter || "");
  if (input) input.value = query;

  function escapeRe(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
  function highlight(text, terms) {
    const safe = escapeHtml(String(text || ""));
    if (!terms.length) return safe;
    const pattern = new RegExp(`(${terms.map(escapeRe).join("|")})`, "gi");
    return safe.replace(pattern, "<mark>$1</mark>");
  }

  function render() {
    list.replaceChildren();
    const q = query.trim().toLowerCase();
    const terms = q ? q.split(/\s+/).filter(Boolean) : [];
    const results = q ? searchQuoteHistory(all, q) : all;
    if (count) count.textContent = q
      ? `${results.length} of ${all.length}`
      : `${all.length} · newest first`;
    if (status) {
      if (q && results.length === 0) {
        status.textContent = "No matching quotes.";
        status.hidden = false;
      } else {
        status.textContent = "";
        status.hidden = true;
      }
    }
    for (const it of results.slice(0, 50)) {
      const row = tplQuoteHistoryRow.content.cloneNode(true);
      const link = row.querySelector('[data-field="quote-history-link"]');
      const titleEl = row.querySelector('[data-field="quote-history-title"]');
      const snipEl = row.querySelector('[data-field="quote-history-snippet"]');
      const repoEl = row.querySelector('[data-field="quote-history-repo"]');
      const numEl = row.querySelector('[data-field="quote-history-number"]');
      const timeEl = row.querySelector('[data-field="quote-history-time"]');
      const removeBtn = row.querySelector('[data-action="remove-quote-history"]');
      const url = it.htmlUrl || it.pageUrl || "";
      if (url) { link.href = url; } else { link.removeAttribute("href"); }
      titleEl.innerHTML = highlight(it.title || `Quote from ${it.repo || "page"}`, terms);
      const snippet = String(it.selectionText || "").replace(/\s+/g, " ").trim().slice(0, 260);
      snipEl.innerHTML = highlight(snippet, terms);
      repoEl.textContent = it.repo || "";
      numEl.textContent = it.number ? `#${it.number}` : "";
      if (!it.number) numEl.hidden = true;
      timeEl.textContent = fmtRelative(it.filedAt);
      removeBtn?.addEventListener("click", async (e) => {
        e.preventDefault(); e.stopPropagation();
        await removeQuoteHistoryEntry(it.id);
        await appendQuoteHistorySection(query);
      });
      list.appendChild(row);
    }
  }

  render();

  if (input) {
    let t = null;
    input.addEventListener("input", () => {
      query = input.value;
      clearTimeout(t);
      t = setTimeout(render, 120);
    });
  }
  section.querySelector('[data-action="clear-quote-history"]')?.addEventListener("click", async () => {
    await clearQuoteHistory();
    await appendQuoteHistorySection();
  });
  root.appendChild(section);
}

async function appendOfflineQueueSection() {
  const tplQ = document.getElementById("tpl-offline-queue");
  const tplR = document.getElementById("tpl-offline-queue-row");
  if (!tplQ || !tplR) return;
  for (const existing of root.querySelectorAll("[data-offline-queue]")) existing.remove();
  const items = await getOfflineQueue().catch(() => []);
  if (!items.length) return;
  const frag = tplQ.content.cloneNode(true);
  const section = frag.querySelector("[data-offline-queue]");
  const list = frag.querySelector("[data-offline-queue-list]");
  const countEl = frag.querySelector('[data-field="offline-queue-count"]');
  const statusEl = frag.querySelector('[data-field="offline-queue-status"]');
  const onlineDot = frag.querySelector('[data-field="offline-online-dot"]');
  const isOnline = typeof navigator === "undefined" || navigator.onLine !== false;
  if (onlineDot) onlineDot.dataset.online = String(isOnline);
  if (countEl) countEl.textContent = `${items.length} pending`;
  if (statusEl) statusEl.textContent = isOnline ? "Auto-retrying every few minutes." : "Offline. Will retry when connectivity returns.";
  for (const it of items) {
    const row = tplR.content.cloneNode(true);
    const titleEl = row.querySelector('[data-field="offline-row-title"]');
    const repoEl = row.querySelector('[data-field="offline-row-repo"]');
    const metaEl = row.querySelector('[data-field="offline-row-meta"]');
    const errorEl = row.querySelector('[data-field="offline-row-error"]');
    const removeBtn = row.querySelector('[data-action="remove-offline-item"]');
    if (titleEl) titleEl.textContent = it.payload.title;
    if (repoEl) repoEl.textContent = it.payload.repo;
    const bits = [`queued ${fmtRelative(it.queuedAt)}`];
    if (it.attempts > 0) bits.push(`${it.attempts} retr${it.attempts === 1 ? "y" : "ies"}`);
    if (metaEl) metaEl.textContent = bits.join(" \u00b7 ");
    if (errorEl) {
      if (it.lastError) { errorEl.hidden = false; errorEl.textContent = it.lastError; }
      else errorEl.hidden = true;
    }
    removeBtn?.addEventListener("click", async (e) => {
      e.preventDefault();
      e.stopPropagation();
      await removeOfflineItem(it.id);
      await appendOfflineQueueSection();
    });
    list.appendChild(row);
  }
  const flushBtn = section.querySelector('[data-action="flush-offline-queue"]');
  flushBtn?.addEventListener("click", async () => {
    flushBtn.disabled = true;
    flushBtn.classList.add("loading");
    if (statusEl) statusEl.textContent = "Retrying now\u2026";
    let r = null;
    try {
      r = await flushOfflineQueue();
      if (r) {
        const parts = [];
        if (r.succeeded) parts.push(`${r.succeeded} filed`);
        if (r.dropped) parts.push(`${r.dropped} dropped`);
        if (r.failed) parts.push(`${r.failed} still failing`);
        if (r.offline) parts.push("still offline");
        if (statusEl) statusEl.textContent = parts.length ? parts.join(" \u00b7 ") : "Nothing to retry.";
      }
    } finally {
      flushBtn.disabled = false;
      flushBtn.classList.remove("loading");
    }
    if (r?.succeeded) await appendRecentIssuesSection();
    await appendOfflineQueueSection();
  });
  const clearBtnQ = section.querySelector('[data-action="clear-offline-queue"]');
  clearBtnQ?.addEventListener("click", async () => {
    if (!confirm("Discard " + items.length + " queued issue" + (items.length === 1 ? "" : "s") + "?")) return;
    await clearOfflineQueue();
    await appendOfflineQueueSection();
  });
  root.appendChild(section);
}

function renderQueued(info) {
  const tplQ = document.getElementById("tpl-queued") || document.getElementById("tpl-success");
  if (!tplQ) return;
  const node = tplQ.content.cloneNode(true);
  const sub = node.querySelector('[data-field="success-sub"]') || node.querySelector('[data-field="queued-sub"]');
  const link = node.querySelector('[data-field="success-link"]');
  const titleEl = node.querySelector(".success-title");
  if (titleEl) titleEl.textContent = "Queued for retry";
  if (sub) sub.textContent = `${info?.repo || ""} \u2014 we couldn't reach GitHub. We'll keep retrying every few minutes.`;
  if (link) { link.removeAttribute("href"); link.classList.add("disabled"); link.style.display = "none"; }
  const fileAnother = node.querySelector('[data-action="file-another"]');
  fileAnother?.addEventListener("click", () => loadPending());
  root.replaceChildren(node);
  appendOfflineQueueSection().catch(() => {});
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
        if (created?.number && created?.htmlUrl) {
          await addRecentIssue({ repo: repo.value, number: created.number, htmlUrl: created.htmlUrl, title }).catch(() => {});
        }
        await addQuoteHistory({
          id: created?.number ? `${repo.value}#${created.number}` : `${repo.value}#${q.id || Date.now()}`,
          repo: repo.value,
          number: created?.number || 0,
          htmlUrl: created?.htmlUrl || "",
          title,
          selectionText: q?.selectionText || "",
          pageTitle: q?.pageTitle || "",
          pageUrl: q?.pageUrl || "",
        }).catch(() => {});
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

// ---------------------------------------------------------------------------
// Cmd+K / Ctrl+K command palette
// ---------------------------------------------------------------------------

let paletteOpen = false;
let paletteNode = null;
let paletteInput = null;
let paletteListEl = null;
let paletteCountEl = null;
let paletteItems = [];
let paletteActive = 0;
let palettePrevFocus = null;

function paletteHighlight(text, indices) {
  const set = new Set(Array.isArray(indices) ? indices : []);
  const frag = document.createDocumentFragment();
  for (let i = 0; i < text.length; i++) {
    if (set.has(i)) {
      const m = document.createElement("span");
      m.className = "palette-row-match";
      m.textContent = text[i];
      frag.appendChild(m);
    } else {
      frag.appendChild(document.createTextNode(text[i]));
    }
  }
  return frag;
}

function paletteIcon(kind) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "1.5");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.classList.add("palette-row-icon");
  svg.setAttribute("aria-hidden", "true");
  const paths = {
    repo: ["M4 4.5A2.5 2.5 0 0 1 6.5 2H20v17H6.5A2.5 2.5 0 0 0 4 21.5v-17z", "M4 19.5A2.5 2.5 0 0 1 6.5 17H20"],
    label: ["M3 12l9-9 9 9-9 9-9-9z"],
    template: ["M4 5h16", "M4 12h16", "M4 19h10"],
    toggle: ["M8 7h8a5 5 0 0 1 0 10H8a5 5 0 0 1 0-10z", "M8 12h.01"],
    draft: ["M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z", "M14 3v6h6"],
    issue: ["M12 7v6", "M12 17h.01", "M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0z"],
    settings: ["M12 8.5v7", "M8.5 12h7", "M19 12a7 7 0 1 1-14 0 7 7 0 0 1 14 0z"],
    quote: ["M7 8h7a4 4 0 0 1 0 8h-2", "M7 8v8"],
  };
  const list = paths[kind] || paths.quote;
  for (const d of list) {
    const p = document.createElementNS("http://www.w3.org/2000/svg", "path");
    p.setAttribute("d", d);
    svg.appendChild(p);
  }
  return svg;
}

async function paletteCommands(query) {
  const cmds = [];
  const form = root.querySelector("[data-form]") || null;
  const repoInput = form?.querySelector('[data-field="repo"]') || null;
  const labelsInput = form?.querySelector('[data-field="labels"]') || null;

  // Recent repos -> switch-to actions
  try {
    const recents = await getRecentRepos();
    for (const r of recents.slice(0, 8)) {
      cmds.push({
        group: "Repository",
        icon: "repo",
        label: `Switch repo → ${r.value}`,
        haystack: `repo switch ${r.value}`,
        run: () => {
          if (!repoInput) return;
          repoInput.value = r.value;
          repoInput.dispatchEvent(new Event("input", { bubbles: true }));
          repoInput.dispatchEvent(new Event("change", { bubbles: true }));
          repoInput.focus();
        },
      });
    }
  } catch {}

  // Insert label suggestions from defaults across all known repos.
  try {
    if (labelsInput) {
      const defaultsAll = await getAllRepoDefaults();
      const seen = new Set();
      for (const v of Object.values(defaultsAll || {})) {
        for (const lab of v?.labels || []) {
          const l = String(lab).trim();
          if (!l || seen.has(l)) continue;
          seen.add(l);
          cmds.push({
            group: "Labels",
            icon: "label",
            label: `Add label "${l}"`,
            haystack: `label add ${l}`,
            run: () => {
              const cur = parseLabels(labelsInput.value || "");
              if (!cur.some((x) => x.toLowerCase() === l.toLowerCase())) cur.push(l);
              labelsInput.value = cur.join(", ");
              labelsInput.dispatchEvent(new Event("input", { bubbles: true }));
              labelsInput.dispatchEvent(new Event("change", { bubbles: true }));
            },
          });
          if (seen.size >= 12) break;
        }
        if (seen.size >= 12) break;
      }
    }
  } catch {}

  // Template actions for the current repo.
  if (form) {
    const tmplToggle = form.querySelector('[data-action="toggle-template"]');
    const tmplDefaultBtn = form.querySelector('[data-action="insert-default-template"]');
    const tmplSaveBtn = form.querySelector('[data-action="save-template"]');
    const tmplClearBtn = form.querySelector('[data-action="clear-template"]');
    if (tmplToggle) {
      cmds.push({
        group: "Template",
        icon: "template",
        label: "Toggle template editor",
        haystack: "template toggle editor",
        run: () => tmplToggle.click(),
      });
    }
    if (tmplDefaultBtn) {
      cmds.push({
        group: "Template",
        icon: "template",
        label: "Insert default template",
        haystack: "template insert default reset",
        run: () => tmplDefaultBtn.click(),
      });
    }
    if (tmplSaveBtn) {
      cmds.push({
        group: "Template",
        icon: "template",
        label: "Save template for current repo",
        haystack: "template save current repo",
        run: () => tmplSaveBtn.click(),
      });
    }
    if (tmplClearBtn) {
      cmds.push({
        group: "Template",
        icon: "template",
        label: "Clear template for current repo",
        haystack: "template clear remove",
        run: () => tmplClearBtn.click(),
      });
    }

    // Toggle commands.
    const togglers = [
      ["toggle-preview", "Toggle body preview", "toggle preview body markdown"],
      ["toggle-privacy", "Toggle privacy mode", "toggle privacy scrub tracking"],
      ["toggle-highlight", "Toggle spotlight selection screenshot", "toggle highlight spotlight screenshot"],
      ["toggle-language", "Toggle language label", "toggle language label auto"],
    ];
    for (const [act, label, hay] of togglers) {
      const btn = form.querySelector(`[data-action="${act}"]`);
      if (btn) cmds.push({ group: "Toggles", icon: "toggle", label, haystack: hay, run: () => btn.click() });
    }

    // Issue type radios.
    for (const t of ["bug", "feature", "question"]) {
      const btn = form.querySelector(`[data-action="set-issue-type"][data-issue-type="${t}"]`);
      if (btn) {
        cmds.push({
          group: "Issue type",
          icon: "issue",
          label: `Set issue type: ${t}`,
          haystack: `issue type ${t}`,
          run: () => btn.click(),
        });
      }
    }

    const saveDraftBtn = form.querySelector('[data-action="save-draft"]');
    if (saveDraftBtn) {
      cmds.push({
        group: "Actions",
        icon: "draft",
        label: "Save as draft",
        haystack: "save draft local",
        run: () => saveDraftBtn.click(),
      });
    }
    const submitBtn = form.querySelector('[data-action="submit"]');
    if (submitBtn) {
      cmds.push({
        group: "Actions",
        icon: "issue",
        label: "File issue now",
        haystack: "file issue submit now post",
        run: () => submitBtn.click(),
      });
    }

    const applyDefBtn = form.querySelector('[data-action="apply-defaults"]');
    if (applyDefBtn) {
      cmds.push({
        group: "Defaults",
        icon: "label",
        label: "Apply repo defaults",
        haystack: "apply defaults labels assignees",
        run: () => applyDefBtn.click(),
      });
    }
    const saveDefBtn = form.querySelector('[data-action="save-defaults"]');
    if (saveDefBtn) {
      cmds.push({
        group: "Defaults",
        icon: "label",
        label: "Save repo defaults",
        haystack: "save defaults labels assignees",
        run: () => saveDefBtn.click(),
      });
    }
  }

  // Global commands always available.
  const settingsBtn = document.getElementById("settings-btn");
  if (settingsBtn) {
    cmds.push({
      group: "Navigation",
      icon: "settings",
      label: "Open settings",
      haystack: "open settings token oauth",
      run: () => settingsBtn.click(),
    });
  }
  const themeBtn = document.getElementById("theme-btn");
  if (themeBtn) {
    cmds.push({
      group: "Navigation",
      icon: "settings",
      label: "Cycle theme (system / light / dark)",
      haystack: "theme dark light system toggle",
      run: () => themeBtn.click(),
    });
  }

  // Filter by query.
  const q = String(query || "").trim();
  if (!q) return cmds;
  const ranked = [];
  for (let i = 0; i < cmds.length; i++) {
    const c = cmds[i];
    const m = fuzzyMatch(c.haystack || c.label, q) || fuzzyMatch(c.label, q);
    if (!m) continue;
    // Compute label indices for highlighting against the label string.
    const labelMatch = fuzzyMatch(c.label, q);
    ranked.push({ cmd: c, score: m.score, idx: i, labelIndices: labelMatch?.indices || [] });
  }
  ranked.sort((a, b) => (b.score - a.score) || (a.idx - b.idx));
  return ranked.map((r) => Object.assign({}, r.cmd, { _labelIndices: r.labelIndices }));
}

function renderPaletteList() {
  if (!paletteListEl) return;
  paletteListEl.replaceChildren();
  if (paletteItems.length === 0) {
    const empty = document.createElement("li");
    empty.className = "palette-empty";
    empty.textContent = "No matching commands.";
    paletteListEl.appendChild(empty);
    if (paletteCountEl) paletteCountEl.textContent = "0 results";
    return;
  }
  let lastGroup = null;
  paletteItems.forEach((cmd, i) => {
    if (cmd.group && cmd.group !== lastGroup) {
      const g = document.createElement("li");
      g.className = "palette-row-group";
      g.setAttribute("role", "presentation");
      g.textContent = cmd.group;
      paletteListEl.appendChild(g);
      lastGroup = cmd.group;
    }
    const li = document.createElement("li");
    li.className = "palette-row";
    li.setAttribute("role", "option");
    li.dataset.idx = String(i);
    if (i === paletteActive) li.setAttribute("data-active", "true");
    li.appendChild(paletteIcon(cmd.icon || "quote"));
    const body = document.createElement("div");
    body.className = "palette-row-body";
    const label = document.createElement("div");
    label.className = "palette-row-label";
    if (cmd._labelIndices && cmd._labelIndices.length) {
      label.appendChild(paletteHighlight(cmd.label, cmd._labelIndices));
    } else {
      label.textContent = cmd.label;
    }
    body.appendChild(label);
    li.appendChild(body);
    li.addEventListener("mousedown", (e) => { e.preventDefault(); });
    li.addEventListener("click", () => paletteRun(i));
    paletteListEl.appendChild(li);
  });
  if (paletteCountEl) paletteCountEl.textContent = `${paletteItems.length} result${paletteItems.length === 1 ? "" : "s"}`;
  const activeEl = paletteListEl.querySelector('[data-active="true"]');
  if (activeEl && typeof activeEl.scrollIntoView === "function") {
    activeEl.scrollIntoView({ block: "nearest" });
  }
}

async function refreshPalette() {
  if (!paletteOpen) return;
  const q = paletteInput?.value || "";
  paletteItems = await paletteCommands(q);
  if (paletteActive >= paletteItems.length) paletteActive = 0;
  renderPaletteList();
}

function paletteRun(idx) {
  const cmd = paletteItems[idx];
  closePalette();
  if (cmd && typeof cmd.run === "function") {
    try { cmd.run(); } catch (err) { console.warn("palette run failed:", err); }
  }
}

function onPaletteKeydown(e) {
  if (!paletteOpen) return;
  if (e.key === "Escape") { e.preventDefault(); closePalette(); return; }
  if (e.key === "ArrowDown" || e.key === "Down") {
    e.preventDefault();
    if (paletteItems.length === 0) return;
    paletteActive = (paletteActive + 1) % paletteItems.length;
    renderPaletteList();
  } else if (e.key === "ArrowUp" || e.key === "Up") {
    e.preventDefault();
    if (paletteItems.length === 0) return;
    paletteActive = (paletteActive - 1 + paletteItems.length) % paletteItems.length;
    renderPaletteList();
  } else if (e.key === "Enter") {
    e.preventDefault();
    if (paletteItems.length > 0) paletteRun(paletteActive);
  }
}

function closePalette() {
  if (!paletteOpen) return;
  paletteOpen = false;
  if (paletteNode && paletteNode.parentNode) paletteNode.parentNode.removeChild(paletteNode);
  paletteNode = null;
  paletteInput = null;
  paletteListEl = null;
  paletteCountEl = null;
  paletteItems = [];
  paletteActive = 0;
  document.removeEventListener("keydown", onPaletteKeydown, true);
  if (palettePrevFocus && typeof palettePrevFocus.focus === "function") {
    try { palettePrevFocus.focus(); } catch {}
  }
  palettePrevFocus = null;
}

function openPalette() {
  if (paletteOpen || !tplPalette) return;
  palettePrevFocus = document.activeElement;
  paletteOpen = true;
  const frag = tplPalette.content.cloneNode(true);
  paletteNode = frag.querySelector("[data-palette]");
  paletteInput = frag.querySelector('[data-field="palette-input"]');
  paletteListEl = frag.querySelector('[data-field="palette-list"]');
  paletteCountEl = frag.querySelector('[data-field="palette-count"]');
  paletteActive = 0;
  paletteNode.querySelector('[data-action="palette-close"]').addEventListener("click", () => closePalette());
  paletteInput.addEventListener("input", () => { paletteActive = 0; refreshPalette(); });
  document.body.appendChild(paletteNode);
  document.addEventListener("keydown", onPaletteKeydown, true);
  setTimeout(() => paletteInput?.focus(), 10);
  refreshPalette();
}

if (typeof document !== "undefined" && typeof document.addEventListener === "function") {
  document.addEventListener("keydown", (e) => {
    const isToggle = (e.key === "k" || e.key === "K") && (e.metaKey || e.ctrlKey) && !e.altKey;
    if (!isToggle) return;
    e.preventDefault();
    if (paletteOpen) closePalette(); else openPalette();
  });
}

if (typeof globalThis.__qti === "object" && globalThis.__qti) {
  globalThis.__qti.openPalette = openPalette;
  globalThis.__qti.closePalette = closePalette;
  globalThis.__qti.paletteCommands = paletteCommands;
}
if (root) loadPending();

