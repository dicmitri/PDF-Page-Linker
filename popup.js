const HISTORY_KEY = "linkHistory";

const elements = {
  emptyState: document.getElementById("emptyState"),
  historyList: document.getElementById("historyList")
};

document.addEventListener("DOMContentLoaded", renderHistory);

async function renderHistory() {
  const history = (await getHistory()).sort((first, second) => {
    return new Date(second.copiedAt).getTime() - new Date(first.copiedAt).getTime();
  });
  elements.historyList.replaceChildren();
  elements.emptyState.hidden = history.length > 0;

  for (const item of history) {
    elements.historyList.append(createHistoryItem(item));
  }
}

function createHistoryItem(item) {
  const row = document.createElement("li");
  const details = document.createElement("div");
  const title = document.createElement("div");
  const meta = document.createElement("div");
  const actions = document.createElement("div");
  const copyButton = document.createElement("button");
  const deleteButton = document.createElement("button");

  row.className = "history-item";
  details.className = "history-details";
  title.className = "history-title";
  meta.className = "history-meta";
  actions.className = "history-actions";

  title.textContent = `${item.filename || "document.pdf"} - page ${item.pageNumber}`;
  meta.textContent = `${sourceHint(item.pdfUrl)} - ${formatTimestamp(item.copiedAt)}`;

  copyButton.type = "button";
  copyButton.className = "copy-button";
  copyButton.textContent = "Copy";
  copyButton.addEventListener("click", async () => {
    await navigator.clipboard.writeText(item.link);
    copyButton.textContent = "Copied!";
    window.setTimeout(() => {
      copyButton.textContent = "Copy";
    }, 1500);
  });

  deleteButton.type = "button";
  deleteButton.className = "delete-button";
  deleteButton.textContent = "Delete";
  deleteButton.addEventListener("click", async () => {
    await deleteHistoryItem(item.id);
    await renderHistory();
  });

  details.append(title, meta);
  actions.append(copyButton, deleteButton);
  row.append(details, actions);
  return row;
}

async function getHistory() {
  const result = await chrome.storage.local.get({ [HISTORY_KEY]: [] });
  return result[HISTORY_KEY];
}

async function deleteHistoryItem(id) {
  const history = await getHistory();
  await chrome.storage.local.set({
    [HISTORY_KEY]: history.filter(item => item.id !== id)
  });
}

function sourceHint(url) {
  try {
    const parsed = new URL(url);
    return `${parsed.hostname}${parsed.pathname}`;
  } catch {
    return url || "Unknown source";
  }
}

function formatTimestamp(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }

  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}
