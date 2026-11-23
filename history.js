// Copied links, kept locally (chrome.storage.local). Uses the same storage key
// as v1, so links copied with v1 still show up. v1 entries store the page as
// `pageNumber` and have no `kind`/`quote`; use pageOf() to read either shape.

const HISTORY_KEY = "linkHistory";
const MAX_HISTORY_ITEMS = 200;

export async function getHistory() {
  const stored = await chrome.storage.local.get({ [HISTORY_KEY]: [] });
  return stored[HISTORY_KEY];
}

/** Page number of a history entry, from either the v2 or the v1 format. */
export function pageOf(entry) {
  return entry.page ?? entry.pageNumber;
}

export async function deleteHistoryEntry(id) {
  const history = await getHistory();
  await chrome.storage.local.set({ [HISTORY_KEY]: history.filter(item => item.id !== id) });
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
