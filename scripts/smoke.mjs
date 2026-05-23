// Smoke test: validates manifest.json shape, required files, and service worker scaffolding.
import fs from "node:fs";

const m = JSON.parse(fs.readFileSync("manifest.json", "utf8"));
const must = ["manifest_version", "name", "version", "description"];
for (const k of must) if (!m[k]) { console.error("missing manifest key:", k); process.exit(1); }
if (m.manifest_version !== 3) { console.error("manifest_version must be 3"); process.exit(1); }
if (!m.background?.service_worker) { console.error("missing background.service_worker"); process.exit(1); }
if (m.background.type !== "module") { console.error("background.type must be 'module'"); process.exit(1); }
if (!m.action?.default_popup) { console.error("missing action.default_popup"); process.exit(1); }

for (const p of ["src/popup.html", "src/popup.js", "src/popup.css", "src/background.js"])
  if (!fs.existsSync(p)) { console.error("missing file:", p); process.exit(1); }
for (const sz of [16, 32, 48, 128])
  if (!fs.existsSync(`icons/icon-${sz}.png`)) { console.error("missing icon:", sz); process.exit(1); }

// Service worker scaffolding shape — listener registration + message router.
const sw = fs.readFileSync("src/background.js", "utf8");
for (const needle of [
  "chrome.runtime.onInstalled",
  "chrome.runtime.onMessage",
  "getManifest",
  "chrome.contextMenus",
  "contexts: [\"selection\"]",
  "File as GitHub issue",
  "Add to issue batch",
  "qti.addToBatch",
  "bulkQuotes",
  "getBulkQuotes",
  "clearBulkQuotes",
  "removeBulkQuote",
  "setBadgeText",
  "chrome.scripting",
  "captureSelectionFromTab",
  "contextBefore",
  "contextAfter",
  "nearestHeading",
  "pageUrl",
  "capturedAt",
  "submitIssue",
  "api.github.com",
  "X-GitHub-Api-Version",
  "Bearer ",
  "captureVisibleTab",
  "format: \"png\"",
  "screenshot",
]) {
  if (!sw.includes(needle)) {
    console.error("background.js missing scaffolding token:", needle);
    process.exit(1);
  }
}

// Popup form scaffolding tokens.
const popupHtml = fs.readFileSync("src/popup.html", "utf8");
for (const needle of [
  "tpl-form",
  'data-field="repo"',
  'data-field="title"',
  'data-field="labels"',
  'data-action="toggle-preview"',
  'data-action="submit"',
  "Body preview",
  "tpl-success",
  'data-field="success-link"',
  'data-shot',
  'data-action="copy-shot"',
  'data-action="download-shot"',
  'data-field="shotImg"',
  'data-action="toggle-recents"',
  'data-field="repo-recents"',
  'role="combobox"',
  'data-action="toggle-template"',
  'data-template-block',
  'data-field="template-body"',
  'data-field="template-status"',
  'data-action="save-template"',
  'data-action="clear-template"',
  'data-action="insert-default-template"',
  'data-action="save-draft"',
  'data-field="draft-status"',
  'tpl-drafts',
  'tpl-draft-row',
  'data-drafts-list',
  'data-action="load-draft"',
  'data-action="delete-draft"',
  'tpl-bulk',
  'tpl-bulk-row',
  'data-bulk-list',
  'data-action="file-bulk"',
  'data-action="clear-bulk"',
  'data-action="remove-bulk"',
  'data-field="bulk-repo"',
  'data-field="bulk-labels"',
  'data-field="bulk-progress"',
]) {
  if (!popupHtml.includes(needle)) { console.error("popup.html missing token:", needle); process.exit(1); }
}

const popupJs = fs.readFileSync("src/popup.js", "utf8");
for (const needle of [
  "parseRepo",
  "parseLabels",
  "buildMarkdownBody",
  "deriveTitle",
  "qti.formState",
  "buildFormNode",
  "deriveScreenshotFilename",
  "normalizeRecentRepos",
  "filterRecentRepos",
  "addRecentRepo",
  "removeRecentRepo",
  "qti.recentRepos",
  "normalizeRepoTemplates",
  "renderTemplate",
  "DEFAULT_TEMPLATE",
  "MAX_TEMPLATE_LEN",
  "getRepoTemplate",
  "setRepoTemplate",
  "clearRepoTemplate",
  "qti.repoTemplates",
  "normalizeDrafts",
  "saveDraft",
  "deleteDraft",
  "qti.drafts",
  "normalizeBulkQuotes",
  "removeBulkQuote",
  "clearBulkQuotes",
  "appendBulkSection",
  "qti.bulkQuotes",
  "MAX_BULK_QUOTES",
]) {
  if (!popupJs.includes(needle)) { console.error("popup.js missing token:", needle); process.exit(1); }
}

const popupCss = fs.readFileSync("src/popup.css", "utf8");
for (const needle of [".form ", ".input", ".chip", ".btn", ".preview-body", ".shot", ".shot-img", ".shot-btn", ".repo-recents", ".repo-recent", ".template-body", ".template-block", ".template-actions", ".drafts", ".draft-row", ".draft-load", ".draft-remove", ".draft-status", ".bulk ", ".bulk-row", ".bulk-list", ".bulk-row-status", ".bulk-progress", ".bulk-row-remove"]) {
  if (!popupCss.includes(needle)) { console.error("popup.css missing token:", needle); process.exit(1); }
}

// Behavioural checks on the pure helpers — load the module in a stub env.
globalThis.document = { getElementById: () => null };
globalThis.chrome = undefined;
await import("../src/popup.js").catch((err) => { console.error("popup.js import failed:", err.message); process.exit(1); });
const { parseRepo, parseLabels, deriveTitle, buildMarkdownBody, deriveScreenshotFilename, formatBytes, normalizeRecentRepos, filterRecentRepos } = globalThis.__qti || {};
if (typeof parseRepo !== "function") { console.error("popup helpers not exported on globalThis.__qti"); process.exit(1); }
const goodRepo = parseRepo("vercel/next.js");
if (!goodRepo.ok || goodRepo.owner !== "vercel" || goodRepo.name !== "next.js") { console.error("parseRepo bad: vercel/next.js"); process.exit(1); }
const urlRepo = parseRepo("https://github.com/owner/repo.git");
if (!urlRepo.ok || urlRepo.value !== "owner/repo") { console.error("parseRepo bad: url form"); process.exit(1); }
if (parseRepo("bad").ok) { console.error("parseRepo should reject 'bad'"); process.exit(1); }
if (parseRepo("").ok) { console.error("parseRepo should reject empty"); process.exit(1); }
const labs = parseLabels("bug, docs, bug,  ,p1\nquestion");
if (labs.join("|") !== "bug|docs|p1|question") { console.error("parseLabels wrong:", labs); process.exit(1); }
const title = deriveTitle({ selectionText: "hello there general kenobi", pageTitle: "X" });
if (!title.startsWith("Quote:")) { console.error("deriveTitle bad:", title); process.exit(1); }
const body = buildMarkdownBody({
  selectionText: "line one\nline two",
  contextBefore: "prior", contextAfter: "after",
  pageTitle: "Doc", pageUrl: "https://example.com/page",
  nearestHeading: "Intro", capturedAt: "2026-05-23T10:00:00Z",
});
for (const needle of ["> line one", "> line two", "**Source:** [Doc](https://example.com/page)", "**Section:** Intro", "**Captured:**"]) {
  if (!body.includes(needle)) { console.error("buildMarkdownBody missing:", needle); process.exit(1); }
}

// Screenshot helpers + markdown note
if (typeof deriveScreenshotFilename !== "function") { console.error("deriveScreenshotFilename missing"); process.exit(1); }
const shotName = deriveScreenshotFilename({ pageUrl: "https://Example.com/path?q=1", capturedAt: "2026-05-23T10:00:00.000Z" });
if (!shotName.endsWith(".png") || !shotName.includes("example.com")) { console.error("deriveScreenshotFilename bad:", shotName); process.exit(1); }
if (formatBytes(2048) !== "2 KB") { console.error("formatBytes(2048) bad:", formatBytes(2048)); process.exit(1); }
if (formatBytes(0) !== "") { console.error("formatBytes(0) bad"); process.exit(1); }

// Recent repos normalization + filter
if (typeof normalizeRecentRepos !== "function") { console.error("normalizeRecentRepos missing"); process.exit(1); }
const rawRecents = [
  { value: "vercel/next.js", lastUsed: "2026-05-20T10:00:00Z" },
  { value: "VERCEL/next.js", lastUsed: "2026-05-22T10:00:00Z" }, // dedupe (case-insensitive), newer should win after sort
  { value: "facebook/react", lastUsed: "2026-05-21T10:00:00Z" },
  { value: "bad-input", lastUsed: "2026-05-23T10:00:00Z" }, // dropped
  { value: "", lastUsed: "2026-05-23T10:00:00Z" }, // dropped
  null,
];
const normed = normalizeRecentRepos(rawRecents);
if (normed.length !== 2) { console.error("normalizeRecentRepos length wrong:", normed); process.exit(1); }
if (normed[0].value !== "VERCEL/next.js") { console.error("normalizeRecentRepos sort wrong:", normed); process.exit(1); }
if (normed[1].value !== "facebook/react") { console.error("normalizeRecentRepos second wrong:", normed); process.exit(1); }
const big = Array.from({ length: 20 }, (_, i) => ({ value: `owner/repo-${i}`, lastUsed: new Date(2026, 0, 1 + i).toISOString() }));
if (normalizeRecentRepos(big).length !== 8) { console.error("normalizeRecentRepos should cap at 8"); process.exit(1); }
if (normalizeRecentRepos("not-an-array").length !== 0) { console.error("normalizeRecentRepos non-array"); process.exit(1); }
const filtered = filterRecentRepos(normed, "react");
if (filtered.length !== 1 || filtered[0].value !== "facebook/react") { console.error("filterRecentRepos bad:", filtered); process.exit(1); }
if (filterRecentRepos(normed, "").length !== 2) { console.error("filterRecentRepos empty query should return all"); process.exit(1); }

// Per-repo templates: normalization, placeholder rendering
const { normalizeRepoTemplates, renderTemplate, DEFAULT_TEMPLATE } = globalThis.__qti;
if (typeof normalizeRepoTemplates !== "function") { console.error("normalizeRepoTemplates missing"); process.exit(1); }
const rawT = {
  "vercel/next.js": { body: "hello {{quote}}", updatedAt: "2026-05-20T10:00:00Z" },
  "VERCEL/Next.JS": { body: "override", updatedAt: "2026-05-22T10:00:00Z" }, // dedupe via lowercase key
  "bad-input": { body: "x" },
  "empty/repo": { body: "   " }, // dropped (empty after trim)
};
const normT = normalizeRepoTemplates(rawT);
const keys = Object.keys(normT);
if (keys.length !== 1 || keys[0] !== "vercel/next.js") { console.error("normalizeRepoTemplates keys wrong:", keys); process.exit(1); }
if (!normT["vercel/next.js"].updatedAt) { console.error("normalizeRepoTemplates lost updatedAt"); process.exit(1); }
if (normalizeRepoTemplates(null) && Object.keys(normalizeRepoTemplates(null)).length !== 0) { console.error("normalizeRepoTemplates(null) should be empty"); process.exit(1); }
if (typeof DEFAULT_TEMPLATE !== "string" || !DEFAULT_TEMPLATE.includes("{{quote_blockquote}}")) { console.error("DEFAULT_TEMPLATE invalid"); process.exit(1); }
const rendered = renderTemplate(
  "Title: {{source_title}}\nURL: {{source_url}}\n{{quote_blockquote}}\nSection: {{section}}\n{{unknown_token}}",
  { selectionText: "line one\nline two", pageTitle: "Doc", pageUrl: "https://example.com/p", nearestHeading: "Intro", capturedAt: "2026-05-23T10:00:00Z" },
);
if (!rendered.includes("Title: Doc")) { console.error("renderTemplate source_title:", rendered); process.exit(1); }
if (!rendered.includes("URL: https://example.com/p")) { console.error("renderTemplate source_url:", rendered); process.exit(1); }
if (!rendered.includes("> line one") || !rendered.includes("> line two")) { console.error("renderTemplate quote_blockquote:", rendered); process.exit(1); }
if (!rendered.includes("Section: Intro")) { console.error("renderTemplate section:", rendered); process.exit(1); }
if (!rendered.includes("{{unknown_token}}")) { console.error("renderTemplate unknown placeholders should remain"); process.exit(1); }
if (renderTemplate("", { selectionText: "x" }) !== "") { console.error("renderTemplate empty input should be empty"); process.exit(1); }

const bodyShot = buildMarkdownBody({
  selectionText: "hi",
  pageTitle: "D", pageUrl: "https://e.com",
  capturedAt: "2026-05-23T10:00:00Z",
  screenshot: { dataUrl: "data:image/png;base64,AAAA", width: 1280, height: 720, bytes: 1024 },
});
if (!bodyShot.includes("**Screenshot:**") || !bodyShot.includes("1280\u00d7720")) { console.error("buildMarkdownBody screenshot line missing"); process.exit(1); }

console.log("\u2713 smoke ok");

// --- Drafts ----------------------------------------------------------------
const { normalizeDrafts, MAX_DRAFTS } = globalThis.__qti;
if (typeof normalizeDrafts !== "function") { console.error("normalizeDrafts missing"); process.exit(1); }
if (typeof MAX_DRAFTS !== "number" || MAX_DRAFTS < 5) { console.error("MAX_DRAFTS invalid"); process.exit(1); }
if (normalizeDrafts(null).length !== 0) { console.error("normalizeDrafts(null) should be []"); process.exit(1); }
const draftsIn = [
  { id: "a", title: "first", repo: "owner/repo", body: "hi", updatedAt: "2026-05-22T10:00:00Z" },
  { id: "b", title: "", body: "", quote: null, updatedAt: "2026-05-23T10:00:00Z" }, // empty -> dropped
  { id: "a", title: "dup", body: "x", updatedAt: "2026-05-23T11:00:00Z" }, // dedupe by id (first wins)
  { id: "c", title: "newer", body: "y", updatedAt: "2026-05-23T12:00:00Z" },
  { id: "d", quote: { selectionText: "only a quote" }, updatedAt: "2026-05-22T09:00:00Z" },
];
const draftsOut = normalizeDrafts(draftsIn);
if (draftsOut.length !== 3) { console.error("normalizeDrafts length wrong:", draftsOut.map((d) => d.id)); process.exit(1); }
if (draftsOut[0].id !== "c") { console.error("normalizeDrafts sort wrong:", draftsOut.map((d) => d.id)); process.exit(1); }
if (draftsOut[1].id !== "a" || draftsOut[1].title !== "first") { console.error("normalizeDrafts dedupe wrong:", draftsOut); process.exit(1); }
const bigDrafts = Array.from({ length: MAX_DRAFTS + 7 }, (_, i) => ({ id: `id-${i}`, title: `t${i}`, updatedAt: new Date(2026, 0, 1 + i).toISOString() }));
if (normalizeDrafts(bigDrafts).length !== MAX_DRAFTS) { console.error("normalizeDrafts should cap at MAX_DRAFTS"); process.exit(1); }
const longBody = "x".repeat(50_000);
const clipped = normalizeDrafts([{ id: "big", title: "t", body: longBody, updatedAt: "2026-05-23T10:00:00Z" }]);
if (clipped[0].body.length > 32_000) { console.error("normalizeDrafts should clip body"); process.exit(1); }
console.log("\u2713 drafts smoke ok");

// --- Bulk batch -----------------------------------------------------------
const { normalizeBulkQuotes, MAX_BULK_QUOTES } = globalThis.__qti;
if (typeof normalizeBulkQuotes !== "function") { console.error("normalizeBulkQuotes missing"); process.exit(1); }
if (typeof MAX_BULK_QUOTES !== "number" || MAX_BULK_QUOTES < 5) { console.error("MAX_BULK_QUOTES invalid"); process.exit(1); }
if (normalizeBulkQuotes(null).length !== 0) { console.error("normalizeBulkQuotes(null) should be []"); process.exit(1); }
const bulkIn = [
  { id: "q1", selectionText: "first selection", pageUrl: "https://a.com/p", capturedAt: "2026-05-23T10:00:00Z" },
  { id: "q2", selectionText: "  ", pageUrl: "https://a.com/p" }, // dropped (empty)
  { id: "q3", selectionText: "first selection", pageUrl: "https://a.com/p" }, // dedupe via fingerprint
  { id: "q4", selectionText: "different", pageUrl: "https://b.com" },
  { selectionText: "no-id is fine", pageUrl: "https://c.com" },
];
const bulkOut = normalizeBulkQuotes(bulkIn);
if (bulkOut.length !== 3) { console.error("normalizeBulkQuotes length wrong:", bulkOut.map((q) => q.selectionText)); process.exit(1); }
if (bulkOut[0].id !== "q1") { console.error("normalizeBulkQuotes order wrong:", bulkOut); process.exit(1); }
if (!bulkOut[2].id?.startsWith("b_")) { console.error("normalizeBulkQuotes generated id missing"); process.exit(1); }
const tooMany = Array.from({ length: MAX_BULK_QUOTES + 5 }, (_, i) => ({ selectionText: `sel-${i}`, pageUrl: `https://x.com/${i}` }));
if (normalizeBulkQuotes(tooMany).length !== MAX_BULK_QUOTES) { console.error("normalizeBulkQuotes cap wrong"); process.exit(1); }
console.log("\u2713 bulk smoke ok");

// --- Token storage (encrypted PAT) ----------------------------------------
await import("../src/token.js").catch((err) => { console.error("token.js import failed:", err.message); process.exit(1); });
const tok = globalThis.__qtiToken;
if (!tok || typeof tok.looksLikeGithubToken !== "function") {
  console.error("token helpers not exported on globalThis.__qtiToken"); process.exit(1);
}
const goodTokens = [
  "ghp_" + "a".repeat(36),
  "github_pat_" + "b".repeat(40),
  "ABCDEF0123456789abcdef0123456789ABCDEF01",
];
for (const t of goodTokens) {
  if (!tok.looksLikeGithubToken(t)) { console.error("looksLikeGithubToken false-negative:", t); process.exit(1); }
}
for (const t of ["", "short", "has spaces in it abc", "ghp_short", "!!!notavalid!!!"]) {
  if (tok.looksLikeGithubToken(t)) { console.error("looksLikeGithubToken false-positive:", t); process.exit(1); }
}
const prev = tok.previewToken("ghp_abcdefghijklmnopqrSTUV");
if (!prev.endsWith("STUV") || prev.includes("a")) { console.error("previewToken bad:", prev); process.exit(1); }
if (tok.previewToken("") !== "") { console.error("previewToken empty bad"); process.exit(1); }

const mem = new Map();
globalThis.chrome = {
  storage: {
    local: {
      async get(keys) {
        const ks = Array.isArray(keys) ? keys : (typeof keys === "string" ? [keys] : Object.keys(keys || {}));
        const out = {};
        for (const k of ks) if (mem.has(k)) out[k] = mem.get(k);
        return out;
      },
      async set(obj) { for (const [k, v] of Object.entries(obj)) mem.set(k, v); },
      async remove(keys) {
        const ks = Array.isArray(keys) ? keys : [keys];
        for (const k of ks) mem.delete(k);
      },
    },
  },
};
if (typeof globalThis.crypto?.subtle?.encrypt !== "function") {
  console.error("WebCrypto subtle unavailable in Node — upgrade Node"); process.exit(1);
}
const PAT = "ghp_" + "x".repeat(36);
const saved = await tok.setToken(PAT);
if (!saved.ok) { console.error("setToken did not report ok"); process.exit(1); }
if (!(await tok.hasToken())) { console.error("hasToken false after save"); process.exit(1); }
if ((await tok.getToken()) !== PAT) { console.error("getToken round-trip failed"); process.exit(1); }
const info = await tok.getTokenInfo();
if (!info || info.tail !== PAT.slice(-4) || !info.createdAt) { console.error("getTokenInfo bad:", info); process.exit(1); }
const envRaw = JSON.stringify(mem.get(tok.STORAGE_KEYS.envelope));
if (envRaw.includes(PAT)) { console.error("envelope leaked plaintext"); process.exit(1); }
const env = mem.get(tok.STORAGE_KEYS.envelope);
mem.set(tok.STORAGE_KEYS.envelope, { ...env, ct: "AAAA" + env.ct.slice(4) });
if ((await tok.getToken()) !== null) { console.error("getToken should return null on tampered ct"); process.exit(1); }
mem.set(tok.STORAGE_KEYS.envelope, env);
if ((await tok.getToken()) !== PAT) { console.error("restore failed"); process.exit(1); }
await tok.clearToken();
if (await tok.hasToken()) { console.error("hasToken true after clear"); process.exit(1); }
if ((await tok.getToken()) !== null) { console.error("getToken not null after clear"); process.exit(1); }
let rejected = false;
try { await tok.setToken(""); } catch { rejected = true; }
if (!rejected) { console.error("setToken should reject empty"); process.exit(1); }

console.log("\u2713 token smoke ok");
