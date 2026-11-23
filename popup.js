import { buildLink, fallbackDirective, filenameFromUrl, stripFragment } from "./linkformat.js";
import { addHistoryEntry, deleteHistoryEntry, getHistory, pageOf } from "./history.js";

const LAST_RESULT_KEY = "lastResult";
const RESULT_MAX_AGE_MS = 10 * 60 * 1000;

// 24px stroke icons (static markup, never user data).
const ICONS = {
  check: '<path d="M20 6 9 17l-5-5"/>',
  copy: '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1"/>',
  open: '<path d="M14 4h6v6"/><path d="M10 14 20 4"/><path d="M19 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5"/>',
  trash: '<path d="M4 7h16"/><path d="M9 7V4h6v3"/><path d="M6 7l1 13h10l1-13"/>',
  alert: '<circle cx="12" cy="12" r="9"/><path d="M12 7.5v5"/><path d="M12 16.5h.01"/>',
  question: '<circle cx="12" cy="12" r="9"/><path d="M9.6 9.2a2.5 2.5 0 0 1 4.8.9c0 1.6-2.4 2.1-2.4 3.6"/><path d="M12 17h.01"/>'
};

const ERRORS = {
  "not-found": ["Text not found", "Couldn't find the selected text in this PDF."],
  "no-text": ["No text in this PDF", "It may be a scanned image, so the page can't be detected. Enter it below."],
  "too-short": ["Select a bit more", "Select a few words, then try again."],
  "too-common": ["Too common", "This text is on too many pages to tell which one you meant. Select a longer passage."],
  "not-pdf": ["Not a PDF", "PDF Page Linker works with PDFs opened from the web."],
  "unsupported-url": ["Not a web PDF", "Only PDFs opened over http or https are supported."],
  "fetch-failed": ["Couldn't read the PDF", null],
  "encrypted": ["Password-protected PDF", "The page can't be detected in a protected PDF. Enter it below."],
  "timeout": ["That took too long", "Reading the PDF timed out. Try again, or enter the page below."]
};

const $ = id => document.getElementById(id);

function icon(name) {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name]}</svg>`;
}

init().catch(error => console.error(error));

async function init() {
  const { name } = chrome.runtime.getManifest();
  $("appName").textContent = name;
  $("menuName").textContent = name;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.id !== undefined) {
    chrome.action.setBadgeText({ tabId: tab.id, text: "" }).catch(() => {});
  }
  const stored = await chrome.storage.session.get(LAST_RESULT_KEY);
  const record = stored[LAST_RESULT_KEY];
  const fresh = record && Date.now() - record.at < RESULT_MAX_AGE_MS ? record : null;

  renderResult(fresh);
  // Link to the PDF in the current tab; fall back to the last right-clicked PDF.
  const tabUrl = /^https?:\/\//i.test(tab?.url || "") ? tab.url : "";
  const knownNotPdf = fresh?.code === "not-pdf" && (!tabUrl || stripFragment(tabUrl) === fresh.pdfUrl);
  if (!knownNotPdf) {
    renderManual(fresh, tabUrl || fresh?.pdfUrl || "");
  }
  renderHistory(await getHistory());
}

// ---------------------------------------------------------------------------
// Last right-click result

function setStatus(tone, iconName, title, meta) {
  const statusIcon = $("statusIcon");
  statusIcon.className = `status-icon ${tone}`;
  statusIcon.innerHTML = icon(iconName);
  $("resultTitle").textContent = title;
  $("resultMeta").textContent = meta;
}

function setMessage(text) {
  $("resultMessage").hidden = !text;
  $("resultMessage").textContent = text || "";
}

function renderResult(record) {
  $("howTo").hidden = Boolean(record);
  $("result").hidden = !record;
  if (!record) {
    return;
  }
  const candidates = $("candidates");
  candidates.replaceChildren();
  candidates.hidden = true;
  setMessage("");

  const pageMeta = page => [page ? `Page ${page}` : "", record.filename].filter(Boolean).join(" · ");
  const [errorTitle, errorText] = ERRORS[record.code] || ERRORS[record.status] || ["Something went wrong", null];

  if (record.status === "ambiguous" && !record.copied) {
    setStatus("attention", "question", `On ${record.candidates.length} pages`, "Which one did you select?");
    for (const candidate of record.candidates) {
      candidates.append(candidateItem(record, candidate));
    }
    candidates.hidden = false;
  } else if (record.copied) {
    const title = record.kind === "page" ? "Link copied" : "Passage link copied";
    setStatus("success", "check", title, pageMeta(record.copiedPage));
    if (!record.copiedPage) {
      setMessage(`${errorText || record.message || "The page couldn't be detected."} ` +
        "The link still opens the passage in Chrome. Add the page below so other browsers land on it too.");
    }
  } else if (record.link) {
    setStatus("attention", "alert", "Link ready", pageMeta(record.copiedPage));
    setMessage("It couldn't be copied automatically. Use the copy button.");
  } else {
    const title = record.status === "too-common" && record.pageCount ? `On ${record.pageCount} pages` : errorTitle;
    setStatus("attention", "alert", title, record.filename || "");
    setMessage(errorText || record.message || "Try again, or enter the page below.");
  }

  // Technical details stay out of the way, in a tooltip.
  const details = [];
  if (record.method) details.push(`${record.method} match`);
  if (record.ms !== undefined) details.push(`${(record.ms / 1000).toFixed(1)} s`);
  if (record.numPages) details.push(`${record.numPages} pages scanned`);
  $("resultMeta").title = details.join(" · ");

  $("resultLinkRow").hidden = !record.link;
  if (record.link) {
    $("resultLink").textContent = record.link;
    $("resultLink").title = record.link;
    const copy = $("copyAgain");
    copy.innerHTML = icon("copy");
    copy.onclick = () => copyWithFeedback(record.link, copy);
  }
}

function candidateItem(record, candidate) {
  const item = document.createElement("li");
  const button = document.createElement("button");
  button.type = "button";
  button.className = "candidate";
  button.setAttribute("aria-label", `Copy link to page ${candidate.page}`);

  const page = document.createElement("span");
  page.className = "page-tag";
  page.textContent = `p. ${candidate.page}`;

  const snippet = document.createElement("span");
  snippet.className = "candidate-snippet";
  // Snippets mark the match as [[...]].
  const [before, rest = ""] = candidate.snippet.split("[[");
  const [match, after = ""] = rest.split("]]");
  const mark = document.createElement("mark");
  mark.textContent = match;
  snippet.append(before, mark, after);

  button.append(page, snippet);
  button.addEventListener("click", async () => {
    const link = buildLink(record.pdfUrl, {
      page: candidate.page,
      directive: record.kind === "passage" ? candidate.directive : undefined
    });
    await navigator.clipboard.writeText(link);
    await addHistoryEntry({
      kind: record.kind,
      pdfUrl: record.pdfUrl,
      page: candidate.page,
      link,
      quote: record.kind === "passage" ? record.selection : "",
      filename: record.filename
    });
    const updated = { ...record, copied: true, copiedPage: candidate.page, link };
    await chrome.storage.session.set({ [LAST_RESULT_KEY]: updated });
    renderResult(updated);
    renderHistory(await getHistory());
  });
  item.append(button);
  return item;
}

// ---------------------------------------------------------------------------
// Manual page entry (the original extension's feature)

function renderManual(record, tabUrl) {
  if (!/^https?:\/\//i.test(tabUrl)) {
    return;
  }
  const pdfUrl = stripFragment(tabUrl);
  // If a passage link in this same PDF was copied without a page, re-copy it
  // with the page added.
  const pendingDirective = record && record.pdfUrl === pdfUrl && record.kind === "passage" &&
    !record.copiedPage && !["too-short", "too-common"].includes(record.status)
    ? fallbackDirective(record.selection)
    : null;

  $("manual").hidden = false;
  $("manualHint").textContent = pendingDirective
    ? "Includes the passage you selected."
    : filenameFromUrl(pdfUrl);

  $("manualForm").addEventListener("submit", async event => {
    event.preventDefault();
    const page = Number($("manualPage").value);
    if (!Number.isInteger(page) || page < 1) {
      return;
    }
    const link = buildLink(pdfUrl, { page, directive: pendingDirective || undefined });
    const button = event.submitter || $("manualForm").querySelector("button");
    await copyWithFeedback(link, button);
    await addHistoryEntry({
      kind: pendingDirective ? "passage" : "page",
      pdfUrl,
      page,
      link,
      quote: pendingDirective ? record.selection : "",
      filename: filenameFromUrl(pdfUrl)
    });
    renderHistory(await getHistory());
  });
}

// ---------------------------------------------------------------------------
// History

function renderHistory(history) {
  const list = $("historyList");
  list.replaceChildren();
  $("emptyHistory").hidden = history.length > 0;
  $("historyCount").textContent = history.length ? String(history.length) : "";

  for (const item of history) {
    const row = document.createElement("li");
    row.className = "history-item";

    const details = document.createElement("div");
    details.className = "history-details";

    const line = document.createElement("div");
    line.className = "history-line";
    const title = document.createElement("span");
    title.className = "history-title";
    title.textContent = item.filename || "document.pdf";
    title.title = item.link;
    line.append(title);
    const page = pageOf(item);
    if (page) {
      const tag = document.createElement("span");
      tag.className = "page-tag history-page";
      tag.textContent = `p. ${page}`;
      line.append(tag);
    }
    details.append(line);

    if (item.quote) {
      const quote = document.createElement("div");
      quote.className = "history-quote";
      quote.textContent = `“${item.quote}”`;
      details.append(quote);
    }

    const time = document.createElement("time");
    time.className = "history-time";
    time.dateTime = item.copiedAt || "";
    time.textContent = relativeTime(item.copiedAt);
    time.title = absoluteTime(item.copiedAt);
    details.append(time);

    const actions = document.createElement("div");
    actions.className = "history-actions";
    actions.append(
      iconButton("open", "Open link", () => chrome.tabs.create({ url: item.link })),
      iconButton("copy", "Copy link", button => copyWithFeedback(item.link, button)),
      iconButton("trash", "Remove from history", async () => {
        await deleteHistoryEntry(item.id);
        renderHistory(await getHistory());
      }, "danger")
    );

    row.append(details, actions);
    list.append(row);
  }
}

function iconButton(name, label, onClick, variant = "") {
  const button = document.createElement("button");
  button.type = "button";
  button.className = `icon-button ${variant}`.trim();
  button.innerHTML = icon(name);
  button.title = label;
  button.setAttribute("aria-label", label);
  button.addEventListener("click", () => onClick(button));
  return button;
}

// ---------------------------------------------------------------------------
// Helpers

const relativeFormat = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });

function relativeTime(value) {
  const text = relativeTimeText(value);
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function relativeTimeText(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  const seconds = (date.getTime() - Date.now()) / 1000;
  const abs = Math.abs(seconds);
  if (abs < 45) return "Just now";
  if (abs < 3600) return relativeFormat.format(Math.round(seconds / 60), "minute");
  if (abs < 86400) return relativeFormat.format(Math.round(seconds / 3600), "hour");
  if (abs < 7 * 86400) return relativeFormat.format(Math.round(seconds / 86400), "day");
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(date);
}

function absoluteTime(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? ""
    : new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(date);
}

async function copyWithFeedback(text, button) {
  await navigator.clipboard.writeText(text);
  if (button.classList.contains("icon-button")) {
    const original = button.innerHTML;
    const label = button.getAttribute("aria-label");
    button.innerHTML = icon("check");
    button.classList.add("done");
    button.setAttribute("aria-label", "Copied");
    setTimeout(() => {
      button.innerHTML = original;
      button.classList.remove("done");
      button.setAttribute("aria-label", label);
    }, 1200);
  } else {
    const label = button.textContent;
    button.textContent = "Copied";
    setTimeout(() => {
      button.textContent = label;
    }, 1200);
  }
}
