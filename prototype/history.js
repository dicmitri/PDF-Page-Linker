// Copied links, kept locally (chrome.storage.local). Same idea as the v1 history.

const HISTORY_KEY = "linkHistory";
const MAX_HISTORY_ITEMS = 200;

export async function getHistory() {
  const stored = await chrome.storage.local.get({ [HISTORY_KEY]: [] });
  return stored[HISTORY_KEY];
}

/** @param {{kind: string, pdfUrl: string, page?: number, link: string, quote?: string, filename: string}} entry */
export async function addHistoryEntry(entry) {
  const history = await getHistory();
  const item = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    copiedAt: new Date().toISOString(),
    ...entry,
    quote: entry.quote ? entry.quote.slice(0, 240) : ""
  };
  await chrome.storage.local.set({ [HISTORY_KEY]: [item, ...history].slice(0, MAX_HISTORY_ITEMS) });
  return item;
}
