import { buildLink, fallbackDirective, filenameFromUrl, stripFragment } from "./linkformat.js";
import { addHistoryEntry, deleteHistoryEntry, getHistory, pageOf } from "./history.js";

const LAST_RESULT_KEY = "lastResult";
const RESULT_MAX_AGE_MS = 10 * 60 * 1000;

const MESSAGES = {
  "not-found": "Couldn't find the selected text in this PDF's text.",
  "no-text": "This PDF has no text layer (it may be a scanned image), so the page can't be detected.",
  "too-short": "Select a few more words, then try again.",
  "too-common": "This text appears on too many pages to tell which one you meant. Select a longer passage."
};

const $ = id => document.getElementById(id);

init().catch(error => console.error(error));

async function init() {
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
  renderManual(fresh, tabUrl || fresh?.pdfUrl || "");
  renderHistory(await getHistory());
}

// ---------------------------------------------------------------------------
// Last right-click result

function renderResult(record) {
  if (!record) {
    return;
  }
  $("result").hidden = false;
  $("candidates").replaceChildren();
  $("resultMessage").textContent = "";

  if (record.status === "ambiguous" && !record.copied) {
    $("resultTitle").textContent = `This text appears on ${record.candidates.length} pages`;
    $("resultMessage").textContent = "Which one did you select?";
    for (const candidate of record.candidates) {
      $("candidates").append(candidateButton(record, candidate));
    }
  } else if (record.copied) {
    $("resultTitle").textContent = copiedTitle(record);
    if (!record.copiedPage) {
      $("resultMessage").textContent =
        `${MESSAGES[record.status] || record.message || ""} The link opens the passage in Chrome; ` +
        "add the page number below so other PDF viewers land on the right page too.";
    }
  } else if (record.link) {
    $("resultTitle").textContent = record.copiedPage
      ? `Link to page ${record.copiedPage} is ready`
      : "Link is ready";
    $("resultMessage").textContent = "It couldn't be copied automatically. Click Copy.";
  } else {
    $("resultTitle").textContent = "No link copied";
    $("resultMessage").textContent = MESSAGES[record.status] || record.message || "Something went wrong.";
    if (record.status === "too-common" && record.pageCount) {
      $("resultTitle").textContent = `This text appears on ${record.pageCount} pages`;
    }
  }

  if (record.link) {
    $("resultLinkRow").hidden = false;
    $("resultLink").textContent = record.link;
    $("resultLink").title = record.link;
    $("copyAgain").onclick = () => copyWithFeedback(record.link, $("copyAgain"));
  }

  const meta = [];
  if (record.filename) meta.push(record.filename);
  if (record.method) meta.push(`${record.method} match`);
  if (record.ms !== undefined) meta.push(`${(record.ms / 1000).toFixed(1)} s`);
  if (record.numPages) meta.push(`${record.numPages} pages scanned`);
  $("resultMeta").textContent = meta.join(" · ");
}

function copiedTitle(record) {
  if (record.kind === "page") {
    return `Copied link to page ${record.copiedPage}`;
  }
  return record.copiedPage
    ? `Copied link to passage on page ${record.copiedPage}`
    : "Copied passage link (page not detected)";
}

function candidateButton(record, candidate) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "candidate";

  const page = document.createElement("span");
  page.className = "candidate-page";
  page.textContent = `Page ${candidate.page}`;

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
  return button;
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
    ? "The link will include the passage you selected."
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
  for (const item of history) {
    const row = document.createElement("li");
    row.className = "history-item";

    const details = document.createElement("div");
    details.className = "history-details";
    const title = document.createElement("div");
    title.className = "history-title";
    const page = pageOf(item);
    title.textContent = `${item.filename || "document.pdf"}${page ? ` · p. ${page}` : ""}`;
    title.title = item.link;
    details.append(title);
    if (item.quote) {
      const quote = document.createElement("div");
      quote.className = "history-quote";
      quote.textContent = `“${item.quote}”`;
      details.append(quote);
    }
    const time = document.createElement("time");
    time.className = "history-time";
    time.dateTime = item.copiedAt || "";
    time.textContent = formatTimestamp(item.copiedAt);
    details.append(time);

    const actions = document.createElement("div");
    actions.className = "history-actions";
    actions.append(
      smallButton("Open", `Open ${item.link}`, () => chrome.tabs.create({ url: item.link })),
      smallButton("Copy", "Copy this link", button => copyWithFeedback(item.link, button)),
      smallButton("Delete", "Remove from history", async () => {
        await deleteHistoryEntry(item.id);
        renderHistory(await getHistory());
      }, "danger")
    );

    row.append(details, actions);
    list.append(row);
  }
}

function smallButton(label, title, onClick, variant = "") {
  const button = document.createElement("button");
  button.type = "button";
  button.className = `button small ${variant}`.trim();
  button.textContent = label;
  button.title = title;
  button.addEventListener("click", () => onClick(button));
  return button;
}

function formatTimestamp(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(date);
}

async function copyWithFeedback(text, button) {
  await navigator.clipboard.writeText(text);
  const label = button.textContent;
  button.textContent = "Copied!";
  setTimeout(() => {
    button.textContent = label;
  }, 1200);
}
