// Quote to Issue — popup entry point
const LOG = "[quote-to-issue]";

const root = document.getElementById("root");
const tplEmpty = document.getElementById("tpl-empty");
const tplQuote = document.getElementById("tpl-quote");

document.getElementById("settings-btn")?.addEventListener("click", () => {
  // Settings UI lands in a later roadmap item.
  console.log(LOG, "settings click");
});

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

function renderEmpty() {
  root.replaceChildren(tplEmpty.content.cloneNode(true));
}

function renderQuote(q) {
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
    setText("hi", q.selectionText ? `“${q.selectionText.slice(0, 120)}${q.selectionText.length > 120 ? "…" : ""}”` : "");
    setText("contextAfter", q.contextAfter ? ` ${q.contextAfter}…` : "");
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
    await chrome.storage?.local?.remove?.("qti.pendingQuote");
    renderEmpty();
  });

  root.replaceChildren(node);
}

async function loadPending() {
  if (!chrome?.storage?.local) return renderEmpty();
  const out = await chrome.storage.local.get("qti.pendingQuote");
  const q = out["qti.pendingQuote"];
  if (q && q.selectionText) renderQuote(q);
  else renderEmpty();
}

// Re-render if storage changes while popup open.
chrome?.storage?.onChanged?.addListener((changes, area) => {
  if (area === "local" && changes["qti.pendingQuote"]) loadPending();
});

loadPending();
