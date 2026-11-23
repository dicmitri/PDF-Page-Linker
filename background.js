// Right-click a selection in a PDF (or press the shortcut) -> work out its
// page -> copy a link.
//
// Permissions: clicking our menu item or pressing our shortcut grants
// `activeTab`, a temporary host permission for the tab's site. That is enough
// to download the PDF again and read its text, so the user never sees a
// permission prompt.

import { buildLink, cleanSelection, fallbackDirective, filenameFromUrl, quoteClip, stripFragment } from "./linkformat.js";
import { addHistoryEntry } from "./history.js";

// Menu item ids double as command names (manifest "commands") and map to a kind.
const KINDS = {
  "copy-page-link": "page",
  "copy-passage-link": "passage",
  "copy-quote-link": "quote"
};
const MENU_TITLES = {
  "copy-page-link": "Copy link to this page",
  "copy-passage-link": "Copy link to this passage",
  "copy-quote-link": "Copy quote with link"
};
const LAST_RESULT_KEY = "lastResult";
const OFFSCREEN_URL = "offscreen.html";
const PDF_VIEWER_ORIGIN = "chrome-extension://mhjfbmdgcfjbbpaeojofohoefgiehjai";

const BADGE = {
  working: "#5f6368",
  ok: "#188038",
  attention: "#b06000"
};

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    for (const [id, title] of Object.entries(MENU_TITLES)) {
      chrome.contextMenus.create({ id, title, contexts: ["selection"] });
    }
  });
});

const LOCATE_TIMEOUT_MS = 60_000;
const pendingRequests = new Map();

// Progress from the offscreen document while it reads a long PDF.
chrome.runtime.onMessage.addListener(message => {
  if (message?.target !== "background" || message.type !== "progress") {
    return false;
  }
  const pending = pendingRequests.get(message.requestId);
  if (pending && message.total > 20) {
    const percent = Math.min(99, Math.round((message.done / message.total) * 100));
    setBadge(pending.tabId, `${percent}%`, BADGE.working);
  }
  chrome.storage.session.set({ lastProgress: { ...message, at: Date.now() } });
  return false;
});

function withTimeout(promise, ms) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      const error = new Error("Reading the PDF took too long.");
      error.code = "timeout";
      reject(error);
    }, ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

// ---------------------------------------------------------------------------
// Entry points

chrome.contextMenus.onClicked.addListener((info, tab) => {
  const kind = KINDS[info.menuItemId];
  if (!kind) {
    return;
  }
  const url = info.frameUrl || info.pageUrl || tab?.url || "";
  handleSelection(kind, url, info.selectionText, tab?.id).catch(error => console.error("PDF links:", error));
});

chrome.commands.onCommand.addListener((command, tab) => {
  const kind = KINDS[command];
  if (!kind || !tab) {
    return;
  }
  handleShortcut(kind, tab).catch(error => console.error("PDF links:", error));
});

async function handleShortcut(kind, tab) {
  const { text, unavailable } = await readSelection(tab.id);
  if (!text) {
    const pdfUrl = stripFragment(tab.url || "");
    await reportProblem({
      status: "error",
      code: unavailable ? "selection-unavailable" : "no-selection",
      candidates: [],
      kind,
      pdfUrl,
      selection: "",
      filename: filenameFromUrl(pdfUrl),
      at: Date.now()
    }, tab.id);
    return;
  }
  await handleSelection(kind, tab.url || "", text, tab.id);
}

/**
 * The selected text, read on demand (keyboard shortcut only; the right-click
 * menu gets it from Chrome). In Chrome's PDF viewer the text is asked for
 * through the viewer's message channel with its embedding page. That channel
 * is internal to Chrome, so if it doesn't answer, report it as unavailable
 * and point the user to the right-click menu.
 */
async function readSelection(tabId) {
  try {
    const [injection] = await chrome.scripting.executeScript({
      target: { tabId },
      args: [PDF_VIEWER_ORIGIN],
      func: viewerOrigin => new Promise(resolve => {
        const viewer = chrome.dom?.openOrClosedShadowRoot?.(document.body)
          ?.querySelector('iframe[type="application/pdf"]');
        if (!viewer) {
          resolve({ text: String(window.getSelection?.() || "") });
          return;
        }
        const onMessage = event => {
          if (event.origin === viewerOrigin && event.data?.type === "getSelectedTextReply") {
            clearTimeout(timer);
            window.removeEventListener("message", onMessage);
            resolve({ text: String(event.data.selectedText || "") });
          }
        };
        const timer = setTimeout(() => {
          window.removeEventListener("message", onMessage);
          resolve({ text: "", unavailable: true });
        }, 1500);
        window.addEventListener("message", onMessage);
        viewer.contentWindow.postMessage({ type: "getSelectedText" }, "*");
      })
    });
    const result = injection?.result || {};
    return { text: cleanSelection(result.text), unavailable: Boolean(result.unavailable) };
  } catch {
    return { text: "", unavailable: true };
  }
}

async function handleSelection(kind, url, selectionText, tabId) {
  const pdfUrl = stripFragment(url);
  const selection = cleanSelection(selectionText);

  let result;
  if (!/^https?:\/\//i.test(pdfUrl)) {
    result = {
      status: "error",
      code: "unsupported-url",
      message: "Only PDFs opened from the web (http/https) are supported.",
      candidates: []
    };
  } else {
    await setBadge(tabId, "…", BADGE.working);
    const requestId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    pendingRequests.set(requestId, { tabId });
    try {
      await ensureOffscreen();
      result = await withTimeout(
        sendToOffscreen({ type: "locate", url: pdfUrl, selection, requestId }),
        LOCATE_TIMEOUT_MS
      );
    } catch (error) {
      result = { status: "error", code: error.code || "internal", message: error.message, candidates: [] };
    } finally {
      pendingRequests.delete(requestId);
    }
  }

  const record = { ...result, kind, pdfUrl, selection, filename: filenameFromUrl(pdfUrl), at: Date.now() };
  await handleResult(record, tabId);
}

// ---------------------------------------------------------------------------
// Results

async function handleResult(record, tabId) {
  const withPassage = record.kind !== "page";
  if (record.status === "found") {
    const candidate = record.candidates[0];
    const link = buildLink(record.pdfUrl, {
      page: candidate.page,
      directive: withPassage ? candidate.directive : undefined
    });
    const copied = await copyAndRemember(record, link, candidate.page, tabId, candidate.quote);
    if (copied) {
      await setBadge(tabId, String(candidate.page), BADGE.ok, 6000);
    }
  } else if (record.status === "ambiguous") {
    // Several pages contain this text: let the user pick in the popup.
    await setBadge(tabId, "?", BADGE.attention);
    await saveLastResult(record);
    await openPopup();
  } else {
    // Page unknown. A passage link still works in Chrome without a page number,
    // unless the text is so common that Chrome would jump to the wrong place.
    // Not for web pages: Chrome's own "Copy link to highlight" does that better.
    if (withPassage && !["too-short", "too-common"].includes(record.status) && record.code !== "not-pdf") {
      const directive = fallbackDirective(record.selection);
      if (directive) {
        await copyAndRemember(record, buildLink(record.pdfUrl, { directive }), undefined, tabId);
      }
    }
    await reportProblem(record, tabId);
  }
}

async function reportProblem(record, tabId) {
  await setBadge(tabId, "!", BADGE.attention);
  await saveLastResult(record);
  await openPopup();
}

/** What goes on the clipboard: the link, or for quotes rich text + plain text. */
function clipFor(record, link, page, quote) {
  return record.kind === "quote" ? quoteClip({ quote, link, page }) : { text: link };
}

// `quote` is the selection with half-selected words completed (when known).
async function copyAndRemember(record, link, page, tabId, quote = record.selection) {
  const ok = await writeClipboard(tabId, clipFor(record, link, page, quote));
  record.link = link;
  record.quote = quote;
  record.copied = Boolean(ok);
  record.copiedPage = page;
  await saveLastResult(record);
  await addHistoryEntry({
    kind: record.kind,
    pdfUrl: record.pdfUrl,
    page,
    link,
    quote: record.kind === "page" ? "" : quote,
    filename: record.filename
  });
  if (!ok) {
    // Couldn't write the clipboard: show the link in the popup with a Copy button.
    await openPopup();
  }
  return Boolean(ok);
}

// Copy from the offscreen document, which the clipboardWrite permission allows
// without focus or a user gesture. Writing from the page instead makes Chrome
// ask the *website* for clipboard access ("example.org wants to see text and
// images copied to the clipboard"), which is confusing and blocks the copy.
async function writeClipboard(_tabId, { text, html }) {
  try {
    await ensureOffscreen();
    const { ok } = await sendToOffscreen({ type: "copy", text, html: html || "" });
    return Boolean(ok);
  } catch {
    return false;
  }
}

async function saveLastResult(record) {
  await chrome.storage.session.set({ [LAST_RESULT_KEY]: record });
}

// ---------------------------------------------------------------------------
// Offscreen document (PDF.js + clipboard)

let creatingOffscreen = null;

async function ensureOffscreen() {
  const contexts = await chrome.runtime.getContexts({
    contextTypes: ["OFFSCREEN_DOCUMENT"],
    documentUrls: [chrome.runtime.getURL(OFFSCREEN_URL)]
  });
  if (contexts.length) {
    return;
  }
  creatingOffscreen ??= chrome.offscreen.createDocument({
    url: OFFSCREEN_URL,
    reasons: ["WORKERS", "CLIPBOARD"],
    justification: "Read the PDF's text with PDF.js to find the selected text's page, and copy the generated link."
  }).finally(() => {
    creatingOffscreen = null;
  });
  await creatingOffscreen;
}

function sendToOffscreen(message) {
  return chrome.runtime.sendMessage({ target: "offscreen", ...message });
}

// ---------------------------------------------------------------------------
// Feedback

async function setBadge(tabId, text, color, clearAfterMs = 0) {
  if (tabId === undefined) {
    return;
  }
  try {
    await chrome.action.setBadgeBackgroundColor({ tabId, color });
    await chrome.action.setBadgeTextColor?.({ tabId, color: "#ffffff" });
    await chrome.action.setBadgeText({ tabId, text });
    if (clearAfterMs) {
      setTimeout(() => {
        chrome.action.setBadgeText({ tabId, text: "" }).catch(() => {});
      }, clearAfterMs);
    }
  } catch {
    // The tab may have closed.
  }
}

async function openPopup() {
  try {
    await chrome.action.openPopup();
  } catch {
    // Not available (e.g. window not focused); the badge still tells the user.
  }
}
