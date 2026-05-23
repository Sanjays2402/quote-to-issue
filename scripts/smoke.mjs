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
]) {
  if (!popupJs.includes(needle)) { console.error("popup.js missing token:", needle); process.exit(1); }
}

const popupCss = fs.readFileSync("src/popup.css", "utf8");
for (const needle of [".form ", ".input", ".chip", ".btn", ".preview-body"]) {
  if (!popupCss.includes(needle)) { console.error("popup.css missing token:", needle); process.exit(1); }
}

// Behavioural checks on the pure helpers — load the module in a stub env.
globalThis.document = { getElementById: () => null };
globalThis.chrome = undefined;
await import("../src/popup.js").catch((err) => { console.error("popup.js import failed:", err.message); process.exit(1); });
const { parseRepo, parseLabels, deriveTitle, buildMarkdownBody } = globalThis.__qti || {};
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

console.log("\u2713 smoke ok");

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
