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
  "chrome.commands",
  "file-issue-now",
  "add-to-batch",
  "handleFileIssueShortcut",
  "handleAddToBatchShortcut",
  "__qtiBuildMarkdownBody",
  "__qtiDeriveTitle",
  "__qtiRenderTemplate",
  "__qtiFlashBadge",
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
for (const needle of ["> line one", "> line two", "**Source:** [Doc](https://example.com/page", "**Section:** Intro", "**Captured:**"]) {
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

// --- Source URL anchor (Scroll-To-Text-Fragment) --------------------------
const { buildSourceUrlWithAnchor } = globalThis.__qti;
if (typeof buildSourceUrlWithAnchor !== "function") { console.error("buildSourceUrlWithAnchor missing"); process.exit(1); }
if (buildSourceUrlWithAnchor({ pageUrl: "", selectionText: "x" }) !== "") { console.error("anchor: empty url should return ''"); process.exit(1); }
if (buildSourceUrlWithAnchor({ pageUrl: "https://e.com/p", selectionText: "" }) !== "https://e.com/p") { console.error("anchor: empty selection should pass url through"); process.exit(1); }
const shortAnchor = buildSourceUrlWithAnchor({ pageUrl: "https://e.com/p", selectionText: "hello world" });
if (shortAnchor !== "https://e.com/p#:~:text=hello%20world") { console.error("anchor short wrong:", shortAnchor); process.exit(1); }
const preserved = buildSourceUrlWithAnchor({ pageUrl: "https://e.com/p#existing", selectionText: "hello" });
if (preserved !== "https://e.com/p#existing") { console.error("anchor: should not clobber existing fragment"); process.exit(1); }
const encoded = buildSourceUrlWithAnchor({ pageUrl: "https://e.com/p", selectionText: "a, b - c & d" });
if (!encoded.includes("%2C") || !encoded.includes("%2D") || !encoded.includes("%26")) { console.error("anchor: reserved chars not encoded:", encoded); process.exit(1); }
const longText = Array.from({ length: 60 }, (_, i) => `word${i}`).join(" ");
const longAnchor = buildSourceUrlWithAnchor({ pageUrl: "https://e.com/p", selectionText: longText });
if (!longAnchor.includes("#:~:text=") || !longAnchor.includes(",")) { console.error("anchor long should be start,end:", longAnchor); process.exit(1); }
if (!longAnchor.includes("word0") || !longAnchor.includes("word59")) { console.error("anchor long should include first+last words:", longAnchor); process.exit(1); }
// Body should embed the anchored link.
const bodyAnchored = buildMarkdownBody({
  selectionText: "the quick brown fox",
  pageTitle: "Doc", pageUrl: "https://example.com/page",
  capturedAt: "2026-05-23T10:00:00Z",
});
if (!bodyAnchored.includes("#:~:text=the%20quick%20brown%20fox")) { console.error("body should contain anchored URL"); process.exit(1); }
if (!bodyAnchored.includes("Plain URL:")) { console.error("body should include plain URL footer when anchored"); process.exit(1); }
// Template placeholder.
const renderedAnchor = renderTemplate("link: {{source_url_anchor}}", { selectionText: "hi there", pageUrl: "https://e.com/p" });
if (!renderedAnchor.includes("#:~:text=hi%20there")) { console.error("renderTemplate source_url_anchor:", renderedAnchor); process.exit(1); }
console.log("\u2713 anchor smoke ok");

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

// --- Commands manifest -----------------------------------------------------
if (!m.commands || typeof m.commands !== "object") { console.error("manifest.commands missing"); process.exit(1); }
for (const cmd of ["file-issue-now", "add-to-batch"]) {
  const c = m.commands[cmd];
  if (!c?.suggested_key?.default) { console.error("manifest.commands missing", cmd); process.exit(1); }
  if (!c.description) { console.error("manifest.commands missing description for", cmd); process.exit(1); }
}
console.log("\u2713 commands smoke ok");

// --- Capture settings (surrounding-context toggle + radius) --------------
const { normalizeCaptureSettings, DEFAULT_CAPTURE_SETTINGS, CONTEXT_RADIUS_MAX } = globalThis.__qti;
if (typeof normalizeCaptureSettings !== "function") { console.error("normalizeCaptureSettings missing"); process.exit(1); }
if (!DEFAULT_CAPTURE_SETTINGS || DEFAULT_CAPTURE_SETTINGS.contextEnabled !== true) { console.error("DEFAULT_CAPTURE_SETTINGS invalid"); process.exit(1); }
if (DEFAULT_CAPTURE_SETTINGS.contextRadius !== 240) { console.error("DEFAULT_CAPTURE_SETTINGS radius wrong"); process.exit(1); }
if (DEFAULT_CAPTURE_SETTINGS.highlightMode !== false) { console.error("DEFAULT_CAPTURE_SETTINGS highlightMode must default to false"); process.exit(1); }
const capDef = normalizeCaptureSettings(undefined);
if (capDef.contextEnabled !== true || capDef.contextRadius !== 240) { console.error("normalizeCaptureSettings undefined wrong"); process.exit(1); }
const capOff = normalizeCaptureSettings({ contextEnabled: false, contextRadius: 400 });
if (capOff.contextEnabled !== false || capOff.contextRadius !== 0) { console.error("disabled should zero radius"); process.exit(1); }
const capClamp = normalizeCaptureSettings({ contextEnabled: true, contextRadius: 99999 });
if (capClamp.contextRadius !== CONTEXT_RADIUS_MAX) { console.error("radius clamp wrong:", capClamp); process.exit(1); }
const capNeg = normalizeCaptureSettings({ contextEnabled: true, contextRadius: -10 });
if (capNeg.contextRadius !== 0) { console.error("radius negative clamp wrong"); process.exit(1); }
const capStr = normalizeCaptureSettings({ contextEnabled: true, contextRadius: "180" });
if (capStr.contextRadius !== 180) { console.error("radius string coerce wrong"); process.exit(1); }
// Highlight mode normalization.
if (normalizeCaptureSettings({ highlightMode: true }).highlightMode !== true) { console.error("highlightMode true round-trip"); process.exit(1); }
if (normalizeCaptureSettings({ highlightMode: "yes" }).highlightMode !== false) { console.error("highlightMode non-bool should default false"); process.exit(1); }
if (normalizeCaptureSettings(undefined).highlightMode !== false) { console.error("highlightMode default false"); process.exit(1); }
console.log("\u2713 capture settings smoke ok");

// --- Privacy mode (scrub query params + auth tokens) ---------------------
const { scrubUrlForPrivacy, scrubAuthParamsOnly, applyPrivacyToQuote, PRIVACY_AUTH_PARAM_RE, PRIVACY_TRACKING_PARAM_RE } = globalThis.__qti;
if (typeof scrubUrlForPrivacy !== "function") { console.error("scrubUrlForPrivacy missing"); process.exit(1); }
if (typeof scrubAuthParamsOnly !== "function") { console.error("scrubAuthParamsOnly missing"); process.exit(1); }
if (typeof applyPrivacyToQuote !== "function") { console.error("applyPrivacyToQuote missing"); process.exit(1); }
if (!(PRIVACY_AUTH_PARAM_RE instanceof RegExp)) { console.error("PRIVACY_AUTH_PARAM_RE not regex"); process.exit(1); }
if (!(PRIVACY_TRACKING_PARAM_RE instanceof RegExp)) { console.error("PRIVACY_TRACKING_PARAM_RE not regex"); process.exit(1); }
if (scrubUrlForPrivacy("") !== "") { console.error("scrubUrlForPrivacy empty"); process.exit(1); }
if (scrubUrlForPrivacy("not a url") !== "") { console.error("scrubUrlForPrivacy invalid"); process.exit(1); }
if (scrubUrlForPrivacy("javascript:alert(1)") !== "") { console.error("scrubUrlForPrivacy should reject non-http"); process.exit(1); }
if (scrubUrlForPrivacy("file:///etc/passwd") !== "") { console.error("scrubUrlForPrivacy should reject file://"); process.exit(1); }
const sc1 = scrubUrlForPrivacy("https://example.com/path?token=abc123&utm_source=newsletter&q=ok#frag");
if (sc1 !== "https://example.com/path") { console.error("scrubUrlForPrivacy basic:", sc1); process.exit(1); }
const sc2 = scrubUrlForPrivacy("https://user:pass@example.com/x?y=1");
if (sc2 !== "https://example.com/x") { console.error("scrubUrlForPrivacy userinfo:", sc2); process.exit(1); }
const sc3 = scrubUrlForPrivacy("https://example.com/article");
if (sc3 !== "https://example.com/article") { console.error("scrubUrlForPrivacy passthrough:", sc3); process.exit(1); }
const sc4 = scrubUrlForPrivacy("http://Example.COM:8080/Path?Token=x");
if (!sc4.startsWith("http://example.com:8080/Path") || sc4.includes("Token")) { console.error("scrubUrlForPrivacy port/case:", sc4); process.exit(1); }

// scrubAuthParamsOnly retains the path + non-sensitive params.
const sa1 = scrubAuthParamsOnly("https://example.com/path?token=abc&page=2&utm_source=x");
if (sa1 !== "https://example.com/path?page=2") { console.error("scrubAuthParamsOnly mixed:", sa1); process.exit(1); }
const sa2 = scrubAuthParamsOnly("https://example.com/path?page=2&size=10");
if (sa2 !== "https://example.com/path?page=2&size=10") { console.error("scrubAuthParamsOnly safe params passthrough:", sa2); process.exit(1); }
if (scrubAuthParamsOnly("") !== "") { console.error("scrubAuthParamsOnly empty"); process.exit(1); }
if (scrubAuthParamsOnly("not a url") !== "not a url") { console.error("scrubAuthParamsOnly invalid passthrough"); process.exit(1); }
for (const k of ["token", "access_token", "id_token", "refresh_token", "auth_token", "bearer", "api_key", "apikey", "secret", "password", "sessionid", "sid", "sig", "signature", "code", "state", "nonce", "jwt", "otp", "csrf", "x_auth_session"]) {
  if (!PRIVACY_AUTH_PARAM_RE.test(k)) { console.error("PRIVACY_AUTH_PARAM_RE should match:", k); process.exit(1); }
}
for (const k of ["page", "size", "id", "q", "query"]) {
  if (PRIVACY_AUTH_PARAM_RE.test(k)) { console.error("PRIVACY_AUTH_PARAM_RE false-positive:", k); process.exit(1); }
}
for (const k of ["utm_source", "utm_medium", "fbclid", "gclid", "mc_eid", "igshid"]) {
  if (!PRIVACY_TRACKING_PARAM_RE.test(k)) { console.error("PRIVACY_TRACKING_PARAM_RE should match:", k); process.exit(1); }
}

// applyPrivacyToQuote
if (applyPrivacyToQuote(null, { privacyMode: true }) !== null) { console.error("applyPrivacyToQuote null"); process.exit(1); }
const qIn = { selectionText: "hi", pageUrl: "https://e.com/p?token=secret&utm_source=x", frameUrl: "https://f.com/p?code=abc" };
const qOff = applyPrivacyToQuote(qIn, { privacyMode: false });
if (qOff.pageUrl !== qIn.pageUrl) { console.error("applyPrivacyToQuote off should not mutate"); process.exit(1); }
const qOn = applyPrivacyToQuote(qIn, { privacyMode: true });
if (qOn.pageUrl !== "https://e.com/p") { console.error("applyPrivacyToQuote on pageUrl:", qOn.pageUrl); process.exit(1); }
if (qOn.frameUrl !== "https://f.com/p") { console.error("applyPrivacyToQuote on frameUrl:", qOn.frameUrl); process.exit(1); }
if (qIn.pageUrl !== "https://e.com/p?token=secret&utm_source=x") { console.error("applyPrivacyToQuote should be non-mutating"); process.exit(1); }

// Normalization round-trips privacyMode.
if (normalizeCaptureSettings(undefined).privacyMode !== false) { console.error("privacyMode default false"); process.exit(1); }
if (normalizeCaptureSettings({ privacyMode: true }).privacyMode !== true) { console.error("privacyMode true round-trip"); process.exit(1); }
if (normalizeCaptureSettings({ privacyMode: "yes" }).privacyMode !== false) { console.error("privacyMode non-bool defaults false"); process.exit(1); }
if (DEFAULT_CAPTURE_SETTINGS.privacyMode !== false) { console.error("DEFAULT_CAPTURE_SETTINGS.privacyMode default false"); process.exit(1); }

// UI scaffolding tokens.
const popupHtmlPrivacy = fs.readFileSync("src/popup.html", "utf8");
for (const needle of ['data-privacy-row', 'data-action="toggle-privacy"', 'data-field="privacy-toggle-label"', 'data-field="privacy-knob"', "Privacy mode"]) {
  if (!popupHtmlPrivacy.includes(needle)) { console.error("popup.html missing privacy token:", needle); process.exit(1); }
}
const popupJsPrivacy = fs.readFileSync("src/popup.js", "utf8");
for (const needle of ["scrubUrlForPrivacy", "applyPrivacyToQuote", "privacyToggleBtn", "toggle-privacy", "privacyMode"]) {
  if (!popupJsPrivacy.includes(needle)) { console.error("popup.js missing privacy token:", needle); process.exit(1); }
}
const swPrivacy = fs.readFileSync("src/background.js", "utf8");
for (const needle of ["__qtiScrubUrlForPrivacy", "__qtiApplyPrivacyToQuote", "__qtiPrivacyModeEnabled", "privacyMode"]) {
  if (!swPrivacy.includes(needle)) { console.error("background.js missing privacy token:", needle); process.exit(1); }
}
console.log("\u2713 privacy-mode smoke ok");

// --- Highlighted-selection screenshot mode -------------------------------
const swHl = fs.readFileSync("src/background.js", "utf8");
for (const needle of [
  "applySpotlightHighlight",
  "__qtiMaybeSpotlight",
  "selectionRects",
  "highlighted: true",
  "OffscreenCanvas",
  "highlightMode",
  "roundedRectPath",
]) {
  if (!swHl.includes(needle)) { console.error("background.js missing highlight-mode token:", needle); process.exit(1); }
}
const popupHtmlHl = fs.readFileSync("src/popup.html", "utf8");
for (const needle of [
  'data-action="toggle-highlight"',
  'data-field="highlight-toggle-label"',
  'data-highlight-row',
  'data-field="highlight-knob"',
  'Spotlight selection',
]) {
  if (!popupHtmlHl.includes(needle)) { console.error("popup.html missing highlight token:", needle); process.exit(1); }
}
const popupJsHl = fs.readFileSync("src/popup.js", "utf8");
for (const needle of ["highlightMode", "toggle-highlight", "highlightToggleBtn"]) {
  if (!popupJsHl.includes(needle)) { console.error("popup.js missing highlight token:", needle); process.exit(1); }
}
console.log("\u2713 highlight-mode smoke ok");

// --- Byline + publish date scraping --------------------------------------
const { formatPublishDate } = globalThis.__qti;
if (typeof formatPublishDate !== "function") { console.error("formatPublishDate missing"); process.exit(1); }
if (formatPublishDate("") !== "") { console.error("formatPublishDate empty"); process.exit(1); }
if (formatPublishDate("2026-05-23T10:00:00Z") !== "2026-05-23") { console.error("formatPublishDate ISO"); process.exit(1); }
if (formatPublishDate("2026-05-23T12:00:00Z") !== "2026-05-23") { console.error("formatPublishDate ISO mid:", formatPublishDate("2026-05-23T12:00:00Z")); process.exit(1); }
if (formatPublishDate("not-a-date") !== "not-a-date") { console.error("formatPublishDate fallback"); process.exit(1); }
const bodyByline = buildMarkdownBody({
  selectionText: "hi", pageTitle: "D", pageUrl: "https://e.com",
  capturedAt: "2026-05-23T10:00:00Z",
  author: "Jane Doe", publishedAt: "2026-05-22T00:00:00Z",
});
if (!bodyByline.includes("**Author:** Jane Doe")) { console.error("body missing author"); process.exit(1); }
if (!bodyByline.includes("**Published:** 2026-05-22")) { console.error("body missing published"); process.exit(1); }
const renderedByline = renderTemplate("by {{author}} on {{published_at}}", { selectionText: "x", author: "Jane Doe", publishedAt: "2026-05-22T00:00:00Z" });
if (renderedByline !== "by Jane Doe on 2026-05-22") { console.error("renderTemplate byline:", renderedByline); process.exit(1); }
// Background scraper must declare same placeholders + DOM scrape hook.
const swSrc = fs.readFileSync("src/background.js", "utf8");
for (const needle of ["scrapeByline", "datePublished", "article:published_time", "itemprop=\"author\"", "author:", "publishedAt:", "__qtiFormatPublishDate", "published_at:"]) {
  if (!swSrc.includes(needle)) { console.error("background.js missing byline token:", needle); process.exit(1); }
}
const popupHtml2 = fs.readFileSync("src/popup.html", "utf8");
for (const needle of ["data-byline-row", "data-published-row", 'data-field="author"', 'data-field="publishedAt"']) {
  if (!popupHtml2.includes(needle)) { console.error("popup.html missing byline token:", needle); process.exit(1); }
}
console.log("\u2713 byline smoke ok");

// --- Code block detection ------------------------------------------------
const { buildCodeFence } = globalThis.__qti;
if (typeof buildCodeFence !== "function") { console.error("buildCodeFence missing"); process.exit(1); }
if (buildCodeFence({ selectionText: "" }) !== "") { console.error("buildCodeFence empty"); process.exit(1); }
const basicFence = buildCodeFence({ selectionText: "const x = 1;", codeLanguage: "js" });
if (!basicFence.startsWith("```js\n") || !basicFence.endsWith("\n```")) { console.error("buildCodeFence basic bad:", basicFence); process.exit(1); }
if (!basicFence.includes("const x = 1;")) { console.error("buildCodeFence missing body"); process.exit(1); }
const noLang = buildCodeFence({ selectionText: "plain" });
if (!noLang.startsWith("```\n")) { console.error("buildCodeFence no-lang bad:", noLang); process.exit(1); }
// Language sanitized.
const sanitized = buildCodeFence({ selectionText: "x", codeLanguage: "Java Script!! lol" });
if (sanitized.startsWith("```javascript!! lol") || sanitized.includes(" ")) {
  // The replacement strips spaces/!; ensure only [a-z0-9+#._-]
}
if (!/^```[a-z0-9+#._-]*\n/.test(sanitized)) { console.error("buildCodeFence sanitize bad:", sanitized); process.exit(1); }
// Fence escape when content contains backticks.
const nestedFence = buildCodeFence({ selectionText: "before ```` after", codeLanguage: "" });
if (!nestedFence.startsWith("`````\n")) { console.error("buildCodeFence escape bad:", nestedFence); process.exit(1); }
// Body integration.
const bodyCode = buildMarkdownBody({
  selectionText: "const x = 1;\nconsole.log(x);",
  isCode: true, codeLanguage: "js",
  pageTitle: "Doc", pageUrl: "https://e.com", capturedAt: "2026-05-23T10:00:00Z",
});
if (!bodyCode.includes("```js\nconst x = 1;\nconsole.log(x);\n```")) { console.error("body code fence missing:", bodyCode); process.exit(1); }
if (bodyCode.includes("> const x = 1;")) { console.error("body should NOT blockquote code"); process.exit(1); }
// When isCode is false we keep blockquote behavior.
const bodyQuote = buildMarkdownBody({ selectionText: "hello", isCode: false, pageUrl: "https://e.com", capturedAt: "2026-05-23T10:00:00Z" });
if (!bodyQuote.includes("> hello")) { console.error("non-code should still blockquote"); process.exit(1); }
// Template placeholder quote_code.
const rendCode = renderTemplate("X {{quote_code}} Y", { selectionText: "const x = 1;", isCode: true, codeLanguage: "js" });
if (!rendCode.includes("```js\nconst x = 1;\n```")) { console.error("renderTemplate quote_code:", rendCode); process.exit(1); }
const rendLang = renderTemplate("lang={{code_language}}", { selectionText: "x", codeLanguage: "ts" });
if (rendLang !== "lang=ts") { console.error("renderTemplate code_language:", rendLang); process.exit(1); }
// Background must declare same detection tokens.
const swCode = fs.readFileSync("src/background.js", "utf8");
for (const needle of ["isCode", "codeLanguage", "__qtiBuildCodeFence", "language-", "data-language", "PRE", "CODE"]) {
  if (!swCode.includes(needle)) { console.error("background.js missing code-detection token:", needle); process.exit(1); }
}
// Bulk quotes should round-trip isCode + codeLanguage.
const bulkCode = normalizeBulkQuotes([
  { selectionText: "const x = 1;", pageUrl: "https://e.com", isCode: true, codeLanguage: "js" },
]);
if (bulkCode.length !== 1 || !bulkCode[0].isCode || bulkCode[0].codeLanguage !== "js") {
  console.error("normalizeBulkQuotes lost code fields:", bulkCode); process.exit(1);
}
console.log("\u2713 code-block smoke ok");

// --- Recent issues panel --------------------------------------------------
const { normalizeRecentIssues, MAX_RECENT_ISSUES } = globalThis.__qti;
if (typeof normalizeRecentIssues !== "function") { console.error("normalizeRecentIssues missing"); process.exit(1); }
if (typeof MAX_RECENT_ISSUES !== "number" || MAX_RECENT_ISSUES < 5) { console.error("MAX_RECENT_ISSUES invalid"); process.exit(1); }
if (normalizeRecentIssues(null).length !== 0) { console.error("normalizeRecentIssues null"); process.exit(1); }
const riIn = [
  { repo: "vercel/next.js", number: 12, htmlUrl: "https://github.com/vercel/next.js/issues/12", title: "older", filedAt: "2026-05-20T10:00:00Z" },
  { repo: "vercel/next.js", number: 12, htmlUrl: "https://github.com/vercel/next.js/issues/12", title: "dup newer", filedAt: "2026-05-22T10:00:00Z" },
  { repo: "facebook/react", number: 99, htmlUrl: "https://github.com/facebook/react/issues/99", title: "react bug", filedAt: "2026-05-21T10:00:00Z" },
  { repo: "bad", number: 5, htmlUrl: "https://github.com/x/y/issues/5" }, // bad repo
  { repo: "o/r", number: 0, htmlUrl: "https://github.com/o/r/issues/0" }, // bad num
  { repo: "o/r", number: 7, htmlUrl: "javascript:alert(1)" }, // bad url
  null,
];
const riOut = normalizeRecentIssues(riIn);
if (riOut.length !== 2) { console.error("normalizeRecentIssues length wrong:", riOut); process.exit(1); }
if (riOut[0].repo !== "vercel/next.js" || riOut[0].title !== "dup newer") { console.error("normalizeRecentIssues dedupe+sort wrong:", riOut); process.exit(1); }
if (riOut[1].repo !== "facebook/react") { console.error("normalizeRecentIssues 2nd wrong"); process.exit(1); }
const riBig = Array.from({ length: MAX_RECENT_ISSUES + 5 }, (_, i) => ({
  repo: `o/r${i}`, number: i + 1, htmlUrl: `https://github.com/o/r${i}/issues/${i + 1}`,
  filedAt: new Date(2026, 0, 1 + i).toISOString(),
}));
if (normalizeRecentIssues(riBig).length !== MAX_RECENT_ISSUES) { console.error("normalizeRecentIssues cap wrong"); process.exit(1); }
console.log("\u2713 recent-issues smoke ok");

const popupHtmlRI = fs.readFileSync("src/popup.html", "utf8");
for (const needle of ["tpl-recent-issues", "tpl-recent-issue-row", "data-recent-issues", "data-recent-issues-list", 'data-action="clear-recent-issues"', 'data-action="remove-recent-issue"', 'data-field="recent-issue-link"', 'data-field="recent-issue-title"', 'data-field="recent-issue-repo"', 'data-field="recent-issue-number"', 'data-field="recent-issue-time"', 'data-field="recent-issues-count"']) {
  if (!popupHtmlRI.includes(needle)) { console.error("popup.html missing recent-issues token:", needle); process.exit(1); }
}
const popupCssRI = fs.readFileSync("src/popup.css", "utf8");
for (const needle of [".recent-issues", ".recent-issues-list", ".recent-issue-row", ".recent-issue-link", ".recent-issue-title", ".recent-issue-meta", ".recent-issue-number", ".recent-issue-remove"]) {
  if (!popupCssRI.includes(needle)) { console.error("popup.css missing recent-issues token:", needle); process.exit(1); }
}
const popupJsRI = fs.readFileSync("src/popup.js", "utf8");
for (const needle of ["normalizeRecentIssues", "addRecentIssue", "getRecentIssues", "appendRecentIssuesSection", "clearRecentIssues", "removeRecentIssue", "qti.recentIssues"]) {
  if (!popupJsRI.includes(needle)) { console.error("popup.js missing recent-issues token:", needle); process.exit(1); }
}
console.log("\u2713 recent-issues integration smoke ok");


// --- Per-repo default labels + assignees ---------------------------------
const { parseAssignees, normalizeRepoDefaults } = globalThis.__qti;
if (typeof parseAssignees !== "function") { console.error("parseAssignees missing"); process.exit(1); }
if (typeof normalizeRepoDefaults !== "function") { console.error("normalizeRepoDefaults missing"); process.exit(1); }
const asg = parseAssignees("@octocat, @MOJOMBO,  defunkt\noctocat, , -bad-, ok-user");
// dedupe (case-insensitive), drops invalid, strips @, keeps order
if (asg.join("|") !== "octocat|MOJOMBO|defunkt|ok-user") { console.error("parseAssignees wrong:", asg); process.exit(1); }
if (parseAssignees("").length !== 0) { console.error("parseAssignees empty"); process.exit(1); }
const rawD = {
  "vercel/next.js": { labels: ["bug", "p1"], assignees: ["octocat"], updatedAt: "2026-05-20T10:00:00Z" },
  "VERCEL/Next.JS": { labels: "docs", assignees: "" }, // dedupe via lowercase key, newer not provided — original wins
  "bad-input": { labels: ["x"] },
  "empty/repo": { labels: [], assignees: [] }, // dropped
  "string-input/repo": { labels: "bug, docs, bug", assignees: "@a, b" },
};
const normD = normalizeRepoDefaults(rawD);
const kD = Object.keys(normD).sort();
if (kD.length !== 2 || !kD.includes("vercel/next.js") || !kD.includes("string-input/repo")) { console.error("normalizeRepoDefaults keys wrong:", kD); process.exit(1); }
const v = normD["vercel/next.js"];
if (!Array.isArray(v.labels) || v.labels.join("|") !== "docs") { console.error("normalizeRepoDefaults labels wrong:", v); process.exit(1); }
if (!Array.isArray(v.assignees) || v.assignees.length !== 0) { console.error("normalizeRepoDefaults assignees wrong:", v); process.exit(1); }
const v2 = normD["string-input/repo"];
if (v2.labels.join("|") !== "bug|docs" || v2.assignees.join("|") !== "a|b") { console.error("normalizeRepoDefaults string-input wrong:", v2); process.exit(1); }
if (Object.keys(normalizeRepoDefaults(null)).length !== 0) { console.error("normalizeRepoDefaults null"); process.exit(1); }

// popup.html: assignees field + chip row + defaults controls
const popupHtmlD = fs.readFileSync("src/popup.html", "utf8");
for (const needle of ['data-field="assignees"', 'data-field="assignee-chips"', 'data-defaults-row', 'data-field="defaults-status"', 'data-action="save-defaults"', 'data-action="clear-defaults"', 'data-action="apply-defaults"']) {
  if (!popupHtmlD.includes(needle)) { console.error("popup.html missing defaults token:", needle); process.exit(1); }
}
// popup.css: chip-remove + defaults-row styling
const popupCssD = fs.readFileSync("src/popup.css", "utf8");
for (const needle of [".chip-remove", ".defaults-row", ".defaults-actions", ".defaults-status"]) {
  if (!popupCssD.includes(needle)) { console.error("popup.css missing defaults token:", needle); process.exit(1); }
}
// popup.js: storage key + helpers + wiring
const popupJsD = fs.readFileSync("src/popup.js", "utf8");
for (const needle of ["qti.repoDefaults", "normalizeRepoDefaults", "getRepoDefaults", "setRepoDefaults", "clearRepoDefaults", "parseAssignees", "loadDefaultsForRepo", "applyDefaults"]) {
  if (!popupJsD.includes(needle)) { console.error("popup.js missing defaults token:", needle); process.exit(1); }
}
// background.js: assignees forwarded on POST
const swD = fs.readFileSync("src/background.js", "utf8");
for (const needle of ["assignees", "msg?.assignees"]) {
  if (!swD.includes(needle)) { console.error("background.js missing assignees token:", needle); process.exit(1); }
}
console.log("\u2713 repo-defaults smoke ok");

// --- Settings page + token rotation --------------------------------------
for (const p of ["src/options.html", "src/options.css", "src/options.js"]) {
  if (!fs.existsSync(p)) { console.error("missing file:", p); process.exit(1); }
}
if (!m.options_ui || m.options_ui.page !== "src/options.html") {
  console.error("manifest.options_ui.page must be src/options.html"); process.exit(1);
}
if (m.options_ui.open_in_tab !== true) {
  console.error("manifest.options_ui.open_in_tab must be true"); process.exit(1);
}
const optHtml = fs.readFileSync("src/options.html", "utf8");
for (const needle of [
  'class="options-shell"', 'data-field="token"', 'data-action="save-token"',
  'data-action="clear-token"', 'data-action="rotate-token"', 'data-action="reveal-token"',
  'data-action="clear-rotations"', 'data-rotation-list', 'data-rotation-empty',
  'data-field="token-status"', 'data-field="token-status-text"', 'data-field="token-hint"',
  'src="options.js"', 'href="options.css"',
]) {
  if (!optHtml.includes(needle)) { console.error("options.html missing token:", needle); process.exit(1); }
}
const optCss = fs.readFileSync("src/options.css", "utf8");
for (const needle of [".options-shell", ".options-head", ".options-card", ".rotation-row", ".rotation-tail", ".rotation-empty"]) {
  if (!optCss.includes(needle)) { console.error("options.css missing token:", needle); process.exit(1); }
}
const optJs = fs.readFileSync("src/options.js", "utf8");
for (const needle of ["rotateToken", "getRotationHistory", "clearRotationHistory", "refreshRotations", "refreshTokenStatus"]) {
  if (!optJs.includes(needle)) { console.error("options.js missing token:", needle); process.exit(1); }
}

// Functional: rotateToken logs old tail, keeps current PAT working, and caps at MAX_ROTATIONS.
const tok2 = globalThis.__qtiToken;
if (typeof tok2.rotateToken !== "function") { console.error("token.rotateToken missing"); process.exit(1); }
if (typeof tok2.MAX_ROTATIONS !== "number" || tok2.MAX_ROTATIONS < 4) { console.error("MAX_ROTATIONS invalid"); process.exit(1); }
if ((await tok2.getRotationHistory()).length !== 0) { console.error("rotation log should start empty"); process.exit(1); }
// rotate when no prior token == set
const T1 = "ghp_" + "1".repeat(36);
await tok2.rotateToken(T1);
if ((await tok2.getToken()) !== T1) { console.error("rotateToken initial set failed"); process.exit(1); }
if ((await tok2.getRotationHistory()).length !== 0) { console.error("first rotation should not log"); process.exit(1); }
// rotate to a new token: old tail logged
const T2 = "ghp_" + "2".repeat(36);
await tok2.rotateToken(T2);
const log1 = await tok2.getRotationHistory();
if (log1.length !== 1) { console.error("rotation log should have 1:", log1); process.exit(1); }
if (log1[0].tail !== "1111") { console.error("rotation log tail wrong:", log1[0]); process.exit(1); }
if (!log1[0].retiredAt) { console.error("rotation log missing retiredAt"); process.exit(1); }
if ((await tok2.getToken()) !== T2) { console.error("rotateToken new token round-trip failed"); process.exit(1); }
// rotating to the same token should reject
let sameRej = false;
try { await tok2.rotateToken(T2); } catch { sameRej = true; }
if (!sameRej) { console.error("rotateToken should reject same token"); process.exit(1); }
// invalid token should reject
let badRej = false;
try { await tok2.rotateToken("junk"); } catch { badRej = true; }
if (!badRej) { console.error("rotateToken should reject invalid token"); process.exit(1); }
// rotation cap
for (let i = 3; i < tok2.MAX_ROTATIONS + 5; i++) {
  const Tn = "ghp_" + String(i).padStart(2, "0").repeat(18);
  await tok2.rotateToken(Tn);
}
const logFinal = await tok2.getRotationHistory();
if (logFinal.length !== tok2.MAX_ROTATIONS) { console.error("rotation log not capped:", logFinal.length); process.exit(1); }
// newest first
if (Date.parse(logFinal[0].retiredAt) < Date.parse(logFinal[logFinal.length - 1].retiredAt)) {
  console.error("rotation log not newest-first"); process.exit(1);
}
// clear
await tok2.clearRotationHistory();
if ((await tok2.getRotationHistory()).length !== 0) { console.error("clearRotationHistory failed"); process.exit(1); }
await tok2.clearToken();
console.log("\u2713 settings-rotation smoke ok");

// --- OAuth device flow ----------------------------------------------------
await import("../src/oauth.js").catch((err) => { console.error("oauth.js import failed:", err.message); process.exit(1); });
const oauth = globalThis.__qtiOauth;
if (!oauth || typeof oauth.runDeviceFlow !== "function") {
  console.error("oauth helpers not exported on globalThis.__qtiOauth"); process.exit(1);
}
if (!oauth.validateClientId("Iv1.abcdef1234567890")) { console.error("validateClientId false-negative Iv1"); process.exit(1); }
if (!oauth.validateClientId("Ov23liabcDEF12345_-.")) { console.error("validateClientId false-negative Ov23"); process.exit(1); }
for (const bad of ["", "short", "has space here", "!!!nope!!!", "x".repeat(120)]) {
  if (oauth.validateClientId(bad)) { console.error("validateClientId false-positive:", bad); process.exit(1); }
}
// parseDeviceCodeResponse
try { oauth.parseDeviceCodeResponse(null); console.error("parseDeviceCodeResponse null should throw"); process.exit(1); } catch {}
try { oauth.parseDeviceCodeResponse({ error: "access_denied", error_description: "nope" }); console.error("parseDeviceCodeResponse error should throw"); process.exit(1); } catch (e) {
  if (!String(e.message).includes("nope")) { console.error("parseDeviceCodeResponse should surface description"); process.exit(1); }
}
const pd = oauth.parseDeviceCodeResponse({ device_code: "D", user_code: "AB-CD", verification_uri: "https://github.com/login/device", expires_in: 900, interval: 5 });
if (pd.deviceCode !== "D" || pd.userCode !== "AB-CD" || pd.interval !== 5) { console.error("parseDeviceCodeResponse bad:", pd); process.exit(1); }
if (oauth.parseDeviceCodeResponse({ device_code: "D", user_code: "U", verification_uri: "u", expires_in: 0, interval: 0 }).interval !== 5) {
  console.error("parseDeviceCodeResponse default interval"); process.exit(1);
}
// parseTokenResponse
if (oauth.parseTokenResponse({ access_token: "ghp_abc", scope: "repo", token_type: "bearer" }).state !== "ok") { console.error("parseTokenResponse ok"); process.exit(1); }
if (oauth.parseTokenResponse({ error: "authorization_pending" }).state !== "pending") { console.error("parseTokenResponse pending"); process.exit(1); }
const slow = oauth.parseTokenResponse({ error: "slow_down", interval: 10 });
if (slow.state !== "slow_down" || slow.interval !== 10) { console.error("parseTokenResponse slow_down"); process.exit(1); }
if (oauth.parseTokenResponse({ error: "expired_token" }).state !== "expired") { console.error("parseTokenResponse expired"); process.exit(1); }
if (oauth.parseTokenResponse({ error: "access_denied" }).state !== "denied") { console.error("parseTokenResponse denied"); process.exit(1); }
if (oauth.parseTokenResponse({ error: "weird" }).state !== "error") { console.error("parseTokenResponse error"); process.exit(1); }
// runDeviceFlow with injected fetch + sleep
async function fakeFetch(seq) {
  let i = 0;
  return async () => {
    const next = seq[Math.min(i++, seq.length - 1)];
    if (next.throw) throw next.throw;
    return { ok: next.ok !== false, status: next.status || 200, async json() { return next.body; } };
  };
}
// Happy path: device-code then pending then ok
{
  const fetchImpl = await fakeFetch([
    { body: { device_code: "DEV", user_code: "AB-CD", verification_uri: "https://github.com/login/device", verification_uri_complete: "https://github.com/login/device?user_code=AB-CD", expires_in: 900, interval: 1 } },
    { body: { error: "authorization_pending" } },
    { body: { access_token: "gho_" + "x".repeat(36), scope: "repo", token_type: "bearer" } },
  ]);
  let codeSeen = null;
  const result = await oauth.runDeviceFlow({
    clientId: "Iv1.abcdef1234567890",
    onCode: (c) => { codeSeen = c; },
    fetchImpl,
    sleepImpl: async () => {},
  });
  if (!codeSeen || codeSeen.userCode !== "AB-CD") { console.error("runDeviceFlow onCode not fired"); process.exit(1); }
  if (!result.token.startsWith("gho_")) { console.error("runDeviceFlow token bad:", result); process.exit(1); }
}
// Denied
{
  const fetchImpl = await fakeFetch([
    { body: { device_code: "D", user_code: "U", verification_uri: "v", expires_in: 900, interval: 1 } },
    { body: { error: "access_denied" } },
  ]);
  let denied = false;
  try {
    await oauth.runDeviceFlow({ clientId: "Iv1.abcdef1234567890", fetchImpl, sleepImpl: async () => {} });
  } catch (e) { denied = /denied/i.test(e.message); }
  if (!denied) { console.error("runDeviceFlow should throw on denied"); process.exit(1); }
}
// Slow down adjusts interval and continues
{
  const calls = [];
  const fetchImpl = await fakeFetch([
    { body: { device_code: "D", user_code: "U", verification_uri: "v", expires_in: 900, interval: 1 } },
    { body: { error: "slow_down", interval: 8 } },
    { body: { access_token: "gho_" + "y".repeat(36) } },
  ]);
  const sleepImpl = async (ms) => { calls.push(ms); };
  const result = await oauth.runDeviceFlow({ clientId: "Iv1.abcdef1234567890", fetchImpl, sleepImpl });
  if (calls.length < 2) { console.error("slow_down should not break the loop"); process.exit(1); }
  if (calls[1] < 6000) { console.error("slow_down should grow interval"); process.exit(1); }
  if (!result.token) { console.error("slow_down then ok should resolve"); process.exit(1); }
}
// Abort signal
{
  const ac = new AbortController();
  const fetchImpl = async () => ({ ok: true, async json() { return { device_code: "D", user_code: "U", verification_uri: "v", expires_in: 900, interval: 1 }; } });
  ac.abort();
  let aborted = false;
  try { await oauth.runDeviceFlow({ clientId: "Iv1.abcdef1234567890", fetchImpl, sleepImpl: async () => {}, signal: ac.signal }); }
  catch (e) { aborted = /abort/i.test(e.message); }
  if (!aborted) { console.error("runDeviceFlow should reject when aborted"); process.exit(1); }
}
// Invalid client id rejected immediately
{
  let rej = false;
  try { await oauth.runDeviceFlow({ clientId: "bad id", fetchImpl: async () => ({ ok: true, async json() { return {}; } }) }); }
  catch { rej = true; }
  if (!rej) { console.error("runDeviceFlow should reject bad client id"); process.exit(1); }
}

// Scaffolding tokens for options page + manifest
const optHtml2 = fs.readFileSync("src/options.html", "utf8");
for (const needle of [
  "data-oauth-card",
  'data-field="oauth-client"',
  'data-field="oauth-status"',
  'data-field="oauth-codebox"',
  'data-field="oauth-user-code"',
  'data-field="oauth-verify-link"',
  'data-field="oauth-code-hint"',
  'data-action="start-oauth"',
  'data-action="cancel-oauth"',
  "Sign in with GitHub",
  "device flow",
]) {
  if (!optHtml2.includes(needle)) { console.error("options.html missing oauth token:", needle); process.exit(1); }
}
const optCss2 = fs.readFileSync("src/options.css", "utf8");
for (const needle of [".oauth-codebox", ".oauth-code", ".oauth-verify-link", ".oauth-code-hint"]) {
  if (!optCss2.includes(needle)) { console.error("options.css missing oauth token:", needle); process.exit(1); }
}
const optJs2 = fs.readFileSync("src/options.js", "utf8");
for (const needle of ["runDeviceFlow", "validateClientId", "qti.oauthClientId", "showCode", "resetOauthUi"]) {
  if (!optJs2.includes(needle)) { console.error("options.js missing oauth token:", needle); process.exit(1); }
}
if (!fs.existsSync("src/oauth.js")) { console.error("src/oauth.js missing"); process.exit(1); }
console.log("\u2713 oauth device-flow smoke ok");

// --- Offline queue --------------------------------------------------------
import fsRequired from "node:fs";
const swOffline = fsRequired.readFileSync("src/background.js", "utf8");
for (const needle of [
  "qti.offlineQueue",
  "__qtiNormalizeQueue",
  "__qtiIsRetryableError",
  "__qtiEnqueue",
  "flushOfflineQueue",
  "getOfflineQueue",
  "clearOfflineQueue",
  "removeOfflineItem",
  "chrome.alarms",
  "qti.offlineRetry",
  "MAX_OFFLINE_QUEUE",
  "MAX_QUEUE_ATTEMPTS",
]) {
  if (!swOffline.includes(needle)) { console.error("background.js missing offline-queue token:", needle); process.exit(1); }
}
const mOff = JSON.parse(fsRequired.readFileSync("manifest.json", "utf8"));
if (!Array.isArray(mOff.permissions) || !mOff.permissions.includes("alarms")) {
  console.error("manifest.permissions missing 'alarms'"); process.exit(1);
}

const popupHtmlOff = fsRequired.readFileSync("src/popup.html", "utf8");
for (const needle of [
  "tpl-offline-queue",
  "tpl-offline-queue-row",
  "data-offline-queue",
  "data-offline-queue-list",
  'data-action="flush-offline-queue"',
  'data-action="clear-offline-queue"',
  'data-action="remove-offline-item"',
  'data-field="offline-queue-count"',
  'data-field="offline-queue-status"',
  'data-field="offline-online-dot"',
  'data-field="offline-row-title"',
  'data-field="offline-row-repo"',
  'data-field="offline-row-meta"',
  'data-field="offline-row-error"',
]) {
  if (!popupHtmlOff.includes(needle)) { console.error("popup.html missing offline-queue token:", needle); process.exit(1); }
}
const popupCssOff = fsRequired.readFileSync("src/popup.css", "utf8");
for (const needle of [".offline-queue", ".offline-queue-head", ".offline-queue-list", ".offline-queue-row", ".offline-row-title", ".offline-row-meta", ".offline-row-error", ".offline-row-remove", ".offline-online-dot"]) {
  if (!popupCssOff.includes(needle)) { console.error("popup.css missing offline-queue token:", needle); process.exit(1); }
}
const popupJsOff = fsRequired.readFileSync("src/popup.js", "utf8");
for (const needle of ["normalizeOfflineQueue", "appendOfflineQueueSection", "getOfflineQueue", "flushOfflineQueue", "clearOfflineQueue", "removeOfflineItem", "renderQueued", "MAX_OFFLINE_QUEUE", "qti.offlineQueue", "isRetryableErrorMessage"]) {
  if (!popupJsOff.includes(needle)) { console.error("popup.js missing offline-queue token:", needle); process.exit(1); }
}

// Behavioural: normalizer + isRetryable from popup exports
const { normalizeOfflineQueue, MAX_OFFLINE_QUEUE: POP_MAX_Q, isRetryableErrorMessage } = globalThis.__qti;
if (typeof normalizeOfflineQueue !== "function") { console.error("normalizeOfflineQueue missing"); process.exit(1); }
if (typeof POP_MAX_Q !== "number" || POP_MAX_Q < 5) { console.error("MAX_OFFLINE_QUEUE invalid"); process.exit(1); }
if (normalizeOfflineQueue(null).length !== 0) { console.error("normalizeOfflineQueue(null)"); process.exit(1); }
const rawQ = [
  { id: "a", payload: { repo: "vercel/next.js", title: "first", body: "x" }, queuedAt: "2026-05-22T10:00:00Z", attempts: 2, lastError: "Failed to fetch" },
  { id: "a", payload: { repo: "vercel/next.js", title: "dup later", body: "y" }, queuedAt: "2026-05-23T10:00:00Z" }, // dedupe by id - sort puts later first, wins
  { id: "b", payload: { repo: "facebook/react", title: "" }, queuedAt: "2026-05-23T11:00:00Z" }, // dropped (no title)
  { id: "c", payload: { repo: "bad", title: "no" }, queuedAt: "2026-05-23T12:00:00Z" }, // dropped (bad repo)
  { id: "d", payload: { repo: "o/r", title: "newer", body: "z" }, queuedAt: "2026-05-24T10:00:00Z" },
];
const outQ = normalizeOfflineQueue(rawQ);
if (outQ.length !== 2) { console.error("normalizeOfflineQueue length:", outQ); process.exit(1); }
if (outQ[0].id !== "d") { console.error("normalizeOfflineQueue sort wrong:", outQ); process.exit(1); }
if (outQ[1].id !== "a" || outQ[1].payload.title !== "dup later") { console.error("normalizeOfflineQueue dedupe wrong:", outQ); process.exit(1); }
const bigQ = Array.from({ length: POP_MAX_Q + 5 }, (_, i) => ({ id: `i-${i}`, payload: { repo: `o/r${i}`, title: `t${i}` }, queuedAt: new Date(2026, 0, 1 + i).toISOString() }));
if (normalizeOfflineQueue(bigQ).length !== POP_MAX_Q) { console.error("normalizeOfflineQueue cap wrong"); process.exit(1); }
if (typeof isRetryableErrorMessage !== "function") { console.error("isRetryableErrorMessage missing"); process.exit(1); }
if (!isRetryableErrorMessage("Failed to fetch")) { console.error("isRetryable Failed to fetch"); process.exit(1); }
if (!isRetryableErrorMessage("GitHub: 502 Bad Gateway")) { console.error("isRetryable 502"); process.exit(1); }
if (!isRetryableErrorMessage("Network timeout")) { console.error("isRetryable timeout"); process.exit(1); }
if (isRetryableErrorMessage("Validation failed")) { console.error("isRetryable should reject validation"); process.exit(1); }
if (isRetryableErrorMessage("401 unauthorized")) { console.error("isRetryable should reject 401"); process.exit(1); }
console.log("\u2713 offline-queue smoke ok");

// --- Duplicate-issue detector -------------------------------------------
const { extractDupTokens, scoreDuplicateMatch, rankDuplicates } = globalThis.__qti;
if (typeof extractDupTokens !== "function") { console.error("extractDupTokens missing"); process.exit(1); }
if (typeof scoreDuplicateMatch !== "function") { console.error("scoreDuplicateMatch missing"); process.exit(1); }
if (typeof rankDuplicates !== "function") { console.error("rankDuplicates missing"); process.exit(1); }
const dupToks = extractDupTokens("Crash when opening settings panel on dark mode", "");
if (!dupToks.includes("crash") || !dupToks.includes("settings")) { console.error("extractDupTokens basic:", dupToks); process.exit(1); }
if (dupToks.includes("the") || dupToks.includes("on")) { console.error("extractDupTokens stopwords leaked:", dupToks); process.exit(1); }
if (dupToks.length > 6) { console.error("extractDupTokens cap wrong"); process.exit(1); }
if (extractDupTokens("", "").length !== 0) { console.error("extractDupTokens empty"); process.exit(1); }
if (extractDupTokens("the and to of", "").length !== 0) { console.error("extractDupTokens all-stopwords"); process.exit(1); }
// Dedupe
const dupToks2 = extractDupTokens("crash crash CRASH bug bug", "");
if (dupToks2.filter((t) => t === "crash").length !== 1) { console.error("extractDupTokens dedupe:", dupToks2); process.exit(1); }
// Numbers / short tokens filtered
const dupToks3 = extractDupTokens("a 12345 fix login bug", "");
if (dupToks3.includes("12345") || dupToks3.includes("a")) { console.error("extractDupTokens numerics:", dupToks3); process.exit(1); }
// Score + rank
const items = [
  { number: 1, title: "Settings panel crashes on launch", updatedAt: "2026-05-10T00:00:00Z", state: "open" },
  { number: 2, title: "Unrelated typo in README", updatedAt: "2026-05-22T00:00:00Z", state: "open" },
  { number: 3, title: "Crash in settings + dark mode", updatedAt: "2026-05-20T00:00:00Z", state: "open" },
];
const toks = extractDupTokens("Settings crash dark", "");
const ranked = rankDuplicates(items, toks);
if (ranked[0].number !== 3) { console.error("rankDuplicates top wrong:", ranked.map((r) => [r.number, r._score])); process.exit(1); }
if (ranked[ranked.length - 1].number !== 2) { console.error("rankDuplicates bottom wrong:", ranked); process.exit(1); }
// Score returns 0 with no tokens
if (scoreDuplicateMatch({ title: "x" }, []) !== 0) { console.error("scoreDuplicateMatch empty tokens"); process.exit(1); }
// Background scaffolding tokens
const swDup = fs.readFileSync("src/background.js", "utf8");
for (const needle of [
  "searchSimilarIssues",
  "/search/issues",
  "__qtiBuildDupQuery",
  "__qtiSearchIssues",
  "__qtiDupTokens",
  "is:issue",
  "DUP_STOPWORDS",
  "x-ratelimit-reset",
]) {
  if (!swDup.includes(needle)) { console.error("background.js missing dup-detector token:", needle); process.exit(1); }
}
// Popup scaffolding
const popupHtmlDup = fs.readFileSync("src/popup.html", "utf8");
for (const needle of [
  "data-dup-field",
  'data-action="refresh-dups"',
  'data-field="dup-status"',
  'data-field="dup-count"',
  "data-dup-list",
]) {
  if (!popupHtmlDup.includes(needle)) { console.error("popup.html missing dup-detector token:", needle); process.exit(1); }
}
const popupCssDup = fs.readFileSync("src/popup.css", "utf8");
for (const needle of [".dup-field", ".dup-head", ".dup-list", ".dup-row", ".dup-row-link", ".dup-row-state", ".dup-row-meta", ".dup-row-label", ".dup-refresh"]) {
  if (!popupCssDup.includes(needle)) { console.error("popup.css missing dup-detector token:", needle); process.exit(1); }
}
const popupJsDup = fs.readFileSync("src/popup.js", "utf8");
for (const needle of ["extractDupTokens", "rankDuplicates", "scoreDuplicateMatch", "searchSimilarIssues", "runDupSearch", "scheduleDupSearch", "DUP_STOPWORDS"]) {
  if (!popupJsDup.includes(needle)) { console.error("popup.js missing dup-detector token:", needle); process.exit(1); }
}
console.log("\u2713 dup-detector smoke ok");

// --- Template short-alias placeholders ({{url}}, {{selection}}, {{title}}, {{date}}) ---
const aliasOut = renderTemplate(
  "T={{title}}\nU={{url}}\nS={{selection}}\nD={{date}}",
  { selectionText: "hello world", pageTitle: "Doc", pageUrl: "https://example.com/p", capturedAt: "2026-05-23T10:00:00Z" },
);
if (!aliasOut.includes("T=Doc")) { console.error("alias {{title}} failed:", aliasOut); process.exit(1); }
if (!aliasOut.includes("U=https://example.com/p#:~:text=hello%20world")) { console.error("alias {{url}} should be anchored:", aliasOut); process.exit(1); }
if (!aliasOut.includes("S=hello world")) { console.error("alias {{selection}} failed:", aliasOut); process.exit(1); }
if (!aliasOut.includes("D=2026-05-23")) { console.error("alias {{date}} failed:", aliasOut); process.exit(1); }
// {{url}} falls back to plain pageUrl when there is no selection to anchor on.
const aliasFallback = renderTemplate("U={{url}}", { selectionText: "", pageUrl: "https://example.com/p" });
if (aliasFallback !== "U=https://example.com/p") { console.error("alias {{url}} fallback wrong:", aliasFallback); process.exit(1); }
console.log("\u2713 template-aliases smoke ok");

// --- Selection language detection + auto-label --------------------------
const { detectSelectionLanguage, languageLabelFor, mergeLanguageLabel, LANGUAGE_LABEL_PREFIX, LANG_KNOWN_CODES } = globalThis.__qti;
if (typeof detectSelectionLanguage !== "function") { console.error("detectSelectionLanguage missing"); process.exit(1); }
if (typeof languageLabelFor !== "function") { console.error("languageLabelFor missing"); process.exit(1); }
if (typeof mergeLanguageLabel !== "function") { console.error("mergeLanguageLabel missing"); process.exit(1); }
if (LANGUAGE_LABEL_PREFIX !== "lang:") { console.error("LANGUAGE_LABEL_PREFIX wrong:", LANGUAGE_LABEL_PREFIX); process.exit(1); }
if (!Array.isArray(LANG_KNOWN_CODES) || !LANG_KNOWN_CODES.includes("en")) { console.error("LANG_KNOWN_CODES missing en"); process.exit(1); }
if (detectSelectionLanguage("") !== null) { console.error("detect empty"); process.exit(1); }
if (detectSelectionLanguage("hi") !== null) { console.error("detect too-short"); process.exit(1); }
if (detectSelectionLanguage("The quick brown fox jumps over the lazy dog and runs") !== "en") { console.error("detect english"); process.exit(1); }
if (detectSelectionLanguage("こんにちは、世界。これはテストです") !== "ja") { console.error("detect japanese"); process.exit(1); }
if (detectSelectionLanguage("Доброе утро мир") !== "ru") { console.error("detect russian"); process.exit(1); }
if (detectSelectionLanguage("你好世界这是中文测试") !== "zh") { console.error("detect chinese"); process.exit(1); }
if (detectSelectionLanguage("안녕하세요 세계 테스트 입니다") !== "ko") { console.error("detect korean"); process.exit(1); }
if (detectSelectionLanguage("El gato y el perro corren por la calle de la ciudad") !== "es") { console.error("detect spanish"); process.exit(1); }
if (detectSelectionLanguage("Le chat et le chien courent dans la rue de la ville") !== "fr") { console.error("detect french"); process.exit(1); }
if (detectSelectionLanguage("xyzqq mnbvc poiuy lkjhg fdsa") !== null) { console.error("detect should reject gibberish"); process.exit(1); }
if (languageLabelFor("en") !== "lang:en") { console.error("label en"); process.exit(1); }
if (languageLabelFor("EN") !== "lang:en") { console.error("label EN normalize"); process.exit(1); }
if (languageLabelFor("xx") !== "") { console.error("label unknown should be empty"); process.exit(1); }
if (languageLabelFor("") !== "") { console.error("label empty"); process.exit(1); }
if (languageLabelFor(null) !== "") { console.error("label null"); process.exit(1); }
const mergedL1 = mergeLanguageLabel(["bug"], "en");
if (mergedL1.join("|") !== "bug|lang:en") { console.error("merge basic:", mergedL1); process.exit(1); }
const mergedL2 = mergeLanguageLabel(["bug", "lang:fr"], "en");
if (mergedL2.join("|") !== "bug|lang:en") { console.error("merge replace existing lang:", mergedL2); process.exit(1); }
const mergedL3 = mergeLanguageLabel(["bug"], "xx");
if (mergedL3.join("|") !== "bug") { console.error("merge unknown code should noop:", mergedL3); process.exit(1); }
const mergedL4 = mergeLanguageLabel(["bug", "lang:en", "lang:fr"], "de");
if (mergedL4.join("|") !== "bug|lang:de") { console.error("merge dedupes multiple lang:*", mergedL4); process.exit(1); }
if (DEFAULT_CAPTURE_SETTINGS.languageLabelEnabled !== true) { console.error("DEFAULT_CAPTURE_SETTINGS.languageLabelEnabled default true"); process.exit(1); }
if (normalizeCaptureSettings({ languageLabelEnabled: false }).languageLabelEnabled !== false) { console.error("languageLabelEnabled false round-trip"); process.exit(1); }
if (normalizeCaptureSettings({ languageLabelEnabled: "nope" }).languageLabelEnabled !== true) { console.error("languageLabelEnabled non-bool should keep default true"); process.exit(1); }
const popupHtmlLang = fs.readFileSync("src/popup.html", "utf8");
for (const needle of ['data-language-row', 'data-action="toggle-language"', 'data-field="language-toggle-label"', 'data-field="language-knob"', "Language label"]) {
  if (!popupHtmlLang.includes(needle)) { console.error("popup.html missing language token:", needle); process.exit(1); }
}
const popupJsLang = fs.readFileSync("src/popup.js", "utf8");
for (const needle of ["detectSelectionLanguage", "mergeLanguageLabel", "languageToggleBtn", "toggle-language", "languageLabelEnabled"]) {
  if (!popupJsLang.includes(needle)) { console.error("popup.js missing language token:", needle); process.exit(1); }
}
console.log("\u2713 language-label smoke ok");

// --- CODEOWNERS auto-mention --------------------------------------------
const { parseCodeowners, buildCodeownersMentionLine } = globalThis.__qti;
if (typeof parseCodeowners !== "function") { console.error("parseCodeowners missing"); process.exit(1); }
if (typeof buildCodeownersMentionLine !== "function") { console.error("buildCodeownersMentionLine missing"); process.exit(1); }
const coEmpty = parseCodeowners("");
if (coEmpty.owners.length !== 0 || coEmpty.catchAll.length !== 0) { console.error("parseCodeowners empty"); process.exit(1); }
const coBasic = parseCodeowners("# header\n*  @octocat @MOJOMBO\n/docs @docs-team @octocat\n");
if (coBasic.catchAll.join("|") !== "octocat|MOJOMBO") { console.error("parseCodeowners catchAll wrong:", coBasic); process.exit(1); }
if (!coBasic.owners.includes("octocat") || !coBasic.owners.includes("docs-team") || !coBasic.owners.includes("MOJOMBO")) { console.error("parseCodeowners owners wrong:", coBasic); process.exit(1); }
// dedupe owners (case-insensitive, first-wins)
if (coBasic.owners.filter((o) => o.toLowerCase() === "octocat").length !== 1) { console.error("parseCodeowners dedupe failed"); process.exit(1); }
// last catch-all wins
const coCa = parseCodeowners("* @a\n* @b @c\n");
if (coCa.catchAll.join("|") !== "b|c") { console.error("parseCodeowners last-catchAll-wins:", coCa); process.exit(1); }
// Invalid handles dropped
const coBad = parseCodeowners("* not-a-handle @ok-user  @bad!handle\n");
if (coBad.catchAll.join("|") !== "ok-user") { console.error("parseCodeowners bad-handles:", coBad); process.exit(1); }
// Comments stripped
const coCmt = parseCodeowners("* @ok # trailing comment\n# whole line\n  \n");
if (coCmt.catchAll.join("|") !== "ok") { console.error("parseCodeowners comments:", coCmt); process.exit(1); }
// Team handles (owner/team) accepted
const coTeam = parseCodeowners("* @vercel/next-team @octocat\n");
if (!coTeam.catchAll.includes("vercel/next-team")) { console.error("parseCodeowners team handle:", coTeam); process.exit(1); }
// Glob variants count as catch-all
for (const pat of ["**", "/*", "/**"]) {
  const c = parseCodeowners(`${pat} @x\n`);
  if (c.catchAll.join("|") !== "x") { console.error("parseCodeowners glob variant:", pat, c); process.exit(1); }
}
// buildCodeownersMentionLine
if (buildCodeownersMentionLine([]) !== "") { console.error("mention empty"); process.exit(1); }
if (buildCodeownersMentionLine(null) !== "") { console.error("mention null"); process.exit(1); }
const mline = buildCodeownersMentionLine(["octocat", "@MOJOMBO", "octocat", "bad!", "defunkt"]);
if (mline !== "cc @octocat @MOJOMBO @defunkt") { console.error("buildCodeownersMentionLine basic:", mline); process.exit(1); }
// Cap at 10 mentions
const manyMentions = buildCodeownersMentionLine(Array.from({ length: 20 }, (_, i) => `user${i}`));
if ((manyMentions.match(/@/g) || []).length !== 10) { console.error("buildCodeownersMentionLine cap:", manyMentions); process.exit(1); }
// Capture settings round-trip
if (DEFAULT_CAPTURE_SETTINGS.codeownersEnabled !== true) { console.error("DEFAULT_CAPTURE_SETTINGS.codeownersEnabled default true"); process.exit(1); }
if (normalizeCaptureSettings({ codeownersEnabled: false }).codeownersEnabled !== false) { console.error("codeownersEnabled false round-trip"); process.exit(1); }
if (normalizeCaptureSettings({ codeownersEnabled: "yes" }).codeownersEnabled !== true) { console.error("codeownersEnabled non-bool keeps default true"); process.exit(1); }
// Background scaffolding
const swCo = fs.readFileSync("src/background.js", "utf8");
for (const needle of [
  "__qtiParseCodeowners",
  "__qtiFetchCodeownersFromRepo",
  "getCodeowners",
  "CODEOWNERS_PATHS",
  "CODEOWNERS_CACHE_KEY",
  ".github/CODEOWNERS",
  "application/vnd.github.raw",
]) {
  if (!swCo.includes(needle)) { console.error("background.js missing CODEOWNERS token:", needle); process.exit(1); }
}
// Popup HTML / CSS scaffolding
const popupHtmlCo = fs.readFileSync("src/popup.html", "utf8");
for (const needle of [
  "data-codeowners-row",
  'data-action="toggle-codeowners"',
  'data-action="refresh-codeowners"',
  'data-field="codeowners-status"',
  'data-field="codeowners-chips"',
  'data-field="codeowners-count"',
  'data-field="codeowners-toggle-label"',
  'data-field="codeowners-knob"',
  "CODEOWNERS",
]) {
  if (!popupHtmlCo.includes(needle)) { console.error("popup.html missing CODEOWNERS token:", needle); process.exit(1); }
}
const popupCssCo = fs.readFileSync("src/popup.css", "utf8");
for (const needle of [".codeowners-row", ".codeowners-status", ".codeowners-chip", ".codeowners-chips", ".codeowners-count", ".codeowners-refresh"]) {
  if (!popupCssCo.includes(needle)) { console.error("popup.css missing CODEOWNERS token:", needle); process.exit(1); }
}
const popupJsCo = fs.readFileSync("src/popup.js", "utf8");
for (const needle of ["parseCodeowners", "buildCodeownersMentionLine", "runCodeownersFetch", "selectedCodeownersMentions", "getCodeowners", "codeownersEnabled"]) {
  if (!popupJsCo.includes(needle)) { console.error("popup.js missing CODEOWNERS token:", needle); process.exit(1); }
}
console.log("\u2713 codeowners smoke ok");

// --- Issue comment mode (post selection as comment on existing issue/PR) ---
const { parseIssueOrPrUrl } = globalThis.__qti;
if (typeof parseIssueOrPrUrl !== "function") { console.error("parseIssueOrPrUrl missing"); process.exit(1); }
for (const bad of ["", "   ", "not a url", "github.com/owner", "https://github.com/owner/repo", "https://github.com/owner/repo/issues/abc", "https://github.com/owner/repo/issues/0", "https://example.com/o/r/issues/1"]) {
  if (parseIssueOrPrUrl(bad).ok) { console.error("parseIssueOrPrUrl should reject:", bad); process.exit(1); }
}
const pi1 = parseIssueOrPrUrl("https://github.com/vercel/next.js/issues/123");
if (!pi1.ok || pi1.owner !== "vercel" || pi1.name !== "next.js" || pi1.number !== 123 || pi1.kind !== "issue") { console.error("parseIssueOrPrUrl issues:", pi1); process.exit(1); }
const pi2 = parseIssueOrPrUrl("https://github.com/octocat/Hello-World/pull/42");
if (!pi2.ok || pi2.kind !== "pr" || pi2.number !== 42) { console.error("parseIssueOrPrUrl pull:", pi2); process.exit(1); }
if (pi2.value !== "https://github.com/octocat/Hello-World/pull/42") { console.error("parseIssueOrPrUrl canonical value:", pi2.value); process.exit(1); }
const pi3 = parseIssueOrPrUrl("github.com/owner/repo/issues/7?since=2026");
if (!pi3.ok || pi3.number !== 7) { console.error("parseIssueOrPrUrl no-scheme + query:", pi3); process.exit(1); }
const pi4 = parseIssueOrPrUrl("https://github.com/owner/repo/issues/9#issuecomment-12345");
if (!pi4.ok || pi4.number !== 9) { console.error("parseIssueOrPrUrl fragment:", pi4); process.exit(1); }
const pi5 = parseIssueOrPrUrl("owner/repo#15");
if (!pi5.ok || pi5.number !== 15) { console.error("parseIssueOrPrUrl shorthand:", pi5); process.exit(1); }
const pi6 = parseIssueOrPrUrl("  https://github.com/owner/repo/pull/55/files  ");
if (!pi6.ok || pi6.kind !== "pr" || pi6.number !== 55) { console.error("parseIssueOrPrUrl trailing path:", pi6); process.exit(1); }

const popupHtmlComment = fs.readFileSync("src/popup.html", "utf8");
for (const needle of [
  "data-comment-mode-row",
  'data-action="toggle-comment-mode"',
  'data-field="comment-mode-toggle-label"',
  'data-field="comment-mode-knob"',
  'data-field="comment-target"',
  'data-field="comment-mode-hint"',
  "Comment mode",
]) {
  if (!popupHtmlComment.includes(needle)) { console.error("popup.html missing comment-mode token:", needle); process.exit(1); }
}
const popupCssComment = fs.readFileSync("src/popup.css", "utf8");
for (const needle of [".comment-mode-field", ".comment-mode-row", ".comment-mode-input", ".comment-mode-hint"]) {
  if (!popupCssComment.includes(needle)) { console.error("popup.css missing comment-mode token:", needle); process.exit(1); }
}
const popupJsComment = fs.readFileSync("src/popup.js", "utf8");
for (const needle of ["parseIssueOrPrUrl", "doSubmitComment", "commentMode", "submitComment", "toggle-comment-mode"]) {
  if (!popupJsComment.includes(needle)) { console.error("popup.js missing comment-mode token:", needle); process.exit(1); }
}
const swComment = fs.readFileSync("src/background.js", "utf8");
for (const needle of ["submitComment", "/issues/${number}/comments", "Invalid issue/PR number"]) {
  if (!swComment.includes(needle)) { console.error("background.js missing comment-mode token:", needle); process.exit(1); }
}
console.log("\u2713 comment-mode smoke ok");
