// Quote to Issue — Settings page with token rotation history.
import {
  looksLikeGithubToken,
  previewToken,
  setToken,
  clearToken,
  getTokenInfo,
  hasToken,
  rotateToken,
  getRotationHistory,
  clearRotationHistory,
} from "./token.js";

// --- Theme (mirrors popup behaviour) -------------------------------------
const THEME_MODES = ["system", "light", "dark"];
const THEME_LABELS = { system: "follow system", light: "light", dark: "dark" };
const THEME_STORAGE_KEY = "qti.themeMode";
let themeMode = "system";

function resolveTheme(mode) {
  if (mode === "light" || mode === "dark") return mode;
  try {
    if (window.matchMedia) {
      return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
    }
  } catch {}
  return "dark";
}

function applyTheme(mode) {
  const resolved = resolveTheme(mode);
  document.body.dataset.theme = resolved;
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
    if (window.matchMedia) {
      const mq = window.matchMedia("(prefers-color-scheme: light)");
      mq.addEventListener?.("change", () => { if (themeMode === "system") applyTheme("system"); });
    }
  } catch {}
  document.getElementById("theme-btn")?.addEventListener("click", async () => {
    const i = THEME_MODES.indexOf(themeMode);
    themeMode = THEME_MODES[(i + 1) % THEME_MODES.length];
    applyTheme(themeMode);
    try { await chrome?.storage?.local?.set?.({ [THEME_STORAGE_KEY]: themeMode }); } catch {}
  });
}

// --- Time formatter ------------------------------------------------------
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
  if (days < 30) return `${days}d ago`;
  const mo = Math.round(days / 30);
  return `${mo}mo ago`;
}

function fmtAbs(iso) {
  if (!iso) return "";
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return iso;
  return new Date(t).toLocaleString();
}

// --- Token panel ---------------------------------------------------------
const tokenInput = document.querySelector('[data-field="token"]');
const tokenHint = document.querySelector('[data-field="token-hint"]');
const statusEl = document.querySelector('[data-field="token-status"]');
const statusText = document.querySelector('[data-field="token-status-text"]');
const saveBtn = document.querySelector('[data-action="save-token"]');
const clearBtn = document.querySelector('[data-action="clear-token"]');
const rotateBtn = document.querySelector('[data-action="rotate-token"]');
const revealBtn = document.querySelector('[data-action="reveal-token"]');
const clearRotBtn = document.querySelector('[data-action="clear-rotations"]');
const rotList = document.querySelector('[data-rotation-list]');
const rotEmpty = document.querySelector('[data-rotation-empty]');

let hadTokenSaved = false;

async function refreshTokenStatus() {
  const info = await getTokenInfo().catch(() => null);
  hadTokenSaved = !!info;
  if (info) {
    statusEl.dataset.state = "saved";
    const tail = info.tail ? `••••${info.tail}` : "••••";
    const when = info.createdAt ? ` · saved ${fmtRelative(info.createdAt)}` : "";
    statusText.textContent = `Token saved (${tail})${when}`;
    clearBtn.disabled = false;
  } else {
    statusEl.dataset.state = "empty";
    statusText.textContent = "No token saved";
    clearBtn.disabled = true;
  }
  updateActionState();
}

function updateActionState() {
  const v = tokenInput.value.trim();
  const valid = !!v && looksLikeGithubToken(v);
  saveBtn.disabled = !valid;
  rotateBtn.disabled = !(valid && hadTokenSaved);
}

function validate() {
  const v = tokenInput.value.trim();
  if (!v) {
    tokenHint.textContent = "Token never leaves this machine.";
    tokenHint.classList.remove("error");
    updateActionState();
    return false;
  }
  if (!looksLikeGithubToken(v)) {
    tokenHint.textContent = "That doesn't look like a GitHub token.";
    tokenHint.classList.add("error");
    updateActionState();
    return false;
  }
  tokenHint.textContent = hadTokenSaved
    ? `Will rotate to ${previewToken(v)} (old token's tail will be logged).`
    : `Will save ${previewToken(v)} encrypted.`;
  tokenHint.classList.remove("error");
  updateActionState();
  return true;
}

tokenInput.addEventListener("input", validate);
tokenInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    if (hadTokenSaved && !rotateBtn.disabled) rotateBtn.click();
    else if (!saveBtn.disabled) saveBtn.click();
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
    await refreshTokenStatus();
  } catch (err) {
    tokenHint.textContent = `Save failed: ${err?.message || err}`;
    tokenHint.classList.add("error");
    updateActionState();
  }
});

rotateBtn.addEventListener("click", async () => {
  if (!validate()) return;
  rotateBtn.disabled = true;
  try {
    await rotateToken(tokenInput.value.trim());
    tokenInput.value = "";
    tokenInput.type = "password";
    revealBtn.setAttribute("aria-pressed", "false");
    tokenHint.textContent = "Token rotated. Previous tail logged below.";
    tokenHint.classList.remove("error");
    await refreshTokenStatus();
    await refreshRotations();
  } catch (err) {
    tokenHint.textContent = `Rotation failed: ${err?.message || err}`;
    tokenHint.classList.add("error");
    updateActionState();
  }
});

clearBtn.addEventListener("click", async () => {
  await clearToken().catch(() => {});
  tokenInput.value = "";
  tokenHint.textContent = "Token cleared.";
  tokenHint.classList.remove("error");
  await refreshTokenStatus();
});

clearRotBtn.addEventListener("click", async () => {
  await clearRotationHistory().catch(() => {});
  await refreshRotations();
});

// --- Rotation history ----------------------------------------------------
async function refreshRotations() {
  const log = await getRotationHistory().catch(() => []);
  rotList.replaceChildren();
  if (!log.length) {
    rotEmpty.style.display = "";
    return;
  }
  rotEmpty.style.display = "none";
  for (const entry of log) {
    const row = document.createElement("div");
    row.className = "rotation-row";

    const tail = document.createElement("span");
    tail.className = "rotation-tail";
    tail.textContent = `••••${entry.tail || "????"}`;
    row.appendChild(tail);

    const meta = document.createElement("div");
    meta.className = "rotation-meta";
    const label = document.createElement("span");
    label.className = "rotation-meta-label";
    label.textContent = `Retired ${fmtRelative(entry.retiredAt)}`;
    const sub = document.createElement("span");
    sub.className = "rotation-meta-sub";
    sub.textContent = entry.createdAt
      ? `In service from ${fmtAbs(entry.createdAt)}`
      : "Creation date unknown";
    meta.appendChild(label);
    meta.appendChild(sub);
    row.appendChild(meta);

    const when = document.createElement("span");
    when.className = "rotation-when";
    when.title = fmtAbs(entry.retiredAt);
    when.textContent = fmtAbs(entry.retiredAt).split(",")[0] || "";
    row.appendChild(when);

    rotList.appendChild(row);
  }
}

// --- Boot ----------------------------------------------------------------
(async function boot() {
  await initTheme();
  await refreshTokenStatus();
  await refreshRotations();
  tokenInput.focus?.();
})();
