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
});

const root = document.getElementById("root");
const tplEmpty = document.getElementById("tpl-empty");
const tplQuote = document.getElementById("tpl-quote");
const tplForm = document.getElementById("tpl-form");
const tplSettings = document.getElementById("tpl-settings");
const tplSuccess = document.getElementById("tpl-success");

let settingsOpen = false;

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
    lines.push(`**Source:** [${title}](${q.pageUrl || "#"})`);
  }
  if (q.nearestHeading) lines.push(`**Section:** ${q.nearestHeading}`);
  if (q.capturedAt) lines.push(`**Captured:** ${q.capturedAt}`);
  return lines.join("\n").trim();
}

// expose for tests
if (typeof globalThis !== "undefined") {
  globalThis.__qti = { parseRepo, parseLabels, deriveTitle, buildMarkdownBody };
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function renderEmpty() {
  root.replaceChildren(tplEmpty.content.cloneNode(true));
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
    link.href = q.pageUrl || "#";
    link.textContent = q.pageTitle || hostnameOf(q.pageUrl) || q.pageUrl || "(unknown source)";
  }

  if (q.nearestHeading) {
    node.querySelector("[data-heading-row]").hidden = false;
    setText("nearestHeading", q.nearestHeading);
  }

  setText("capturedAtPretty", fmtTime(q.capturedAt));

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
  const toggleBtn = node.querySelector('[data-action="toggle-preview"]');
  const submitBtn = node.querySelector('[data-action="submit"]');

  repoInput.value = state.repo || "";
  titleInput.value = state.title || deriveTitle(q);
  labelsInput.value = state.labels || "";
  renderLabelChips(chipRow, parseLabels(labelsInput.value));
  previewBody.textContent = buildMarkdownBody(q);

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

  repoInput.addEventListener("input", () => {
    validateRepo();
    saveFormState({ repo: repoInput.value });
  });
  titleInput.addEventListener("input", () => saveFormState({ title: titleInput.value }));
  labelsInput.addEventListener("input", () => {
    renderLabelChips(chipRow, parseLabels(labelsInput.value));
    saveFormState({ labels: labelsInput.value });
  });

  toggleBtn.addEventListener("click", () => {
    const shown = !previewBox.hidden;
    previewBox.hidden = shown;
    toggleBtn.setAttribute("aria-pressed", String(!shown));
    if (!shown) previewBody.textContent = buildMarkdownBody(q);
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
        body: buildMarkdownBody(q),
        labels: parseLabels(labelsInput.value),
      });
      if (!reply?.ok) throw new Error(reply?.error || "Unknown error");
      const created = reply.result || {};
      await chrome.storage?.local?.remove?.(STORAGE_KEYS.pendingQuote);
      await saveFormState({ title: "" });
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
}

chrome?.storage?.onChanged?.addListener((changes, area) => {
  if (area === "local" && changes[STORAGE_KEYS.pendingQuote]) loadPending();
});
if (root) loadPending();

