// Right-click a selection in a PDF -> work out its page -> copy a link.
//
// Permissions: clicking our menu item grants `activeTab`, a temporary host
// permission for the tab's site. That is enough to download the PDF again and
// read its text, so the user never sees a permission prompt.

import { buildLink, cleanSelection, fallbackDirective, filenameFromUrl, stripFragment } from "./linkformat.js";
import { addHistoryEntry } from "./history.js";

const MENU_PAGE = "copy-page-link";
const MENU_PASSAGE = "copy-passage-link";
const LAST_RESULT_KEY = "lastResult";
const OFFSCREEN_URL = "offscreen.html";

const BADGE = {
  working: "#5f6368",
  ok: "#188038",
  attention: "#b06000"
};

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({ id: MENU_PAGE, title: "Copy link to this page", contexts: ["selection"] });
    chrome.contextMenus.create({ id: MENU_PASSAGE, title: "Copy link to this passage", contexts: ["selection"] });
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

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== MENU_PAGE && info.menuItemId !== MENU_PASSAGE) {
    return;
  }
  handleMenuClick(info, tab).catch(error => console.error("PDF links:", error));
});

async function handleMenuClick(info, tab) {
  const kind = info.menuItemId === MENU_PASSAGE ? "passage" : "page";
  const pdfUrl = stripFragment(info.frameUrl || info.pageUrl || tab?.url || "");
  const selection = cleanSelection(info.selectionText);
  const tabId = tab?.id;

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

async function handleResult(record, tabId) {
  if (record.status === "found") {
    const candidate = record.candidates[0];
    const link = buildLink(record.pdfUrl, {
      page: candidate.page,
      directive: record.kind === "passage" ? candidate.directive : undefined
    });
    const copied = await copyAndRemember(record, link, candidate.page, tabId);
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
    if (record.kind === "passage" && !["too-short", "too-common"].includes(record.status)) {
      const directive = fallbackDirective(record.selection);
      if (directive) {
        await copyAndRemember(record, buildLink(record.pdfUrl, { directive }), undefined, tabId);
      }
    }
    await setBadge(tabId, "!", BADGE.attention);
    await saveLastResult(record);
    await openPopup();
  }
}

async function copyAndRemember(record, link, page, tabId) {
  const ok = await writeClipboard(tabId, link);
  record.link = link;
  record.copied = Boolean(ok);
  record.copiedPage = page;
  await saveLastResult(record);
  await addHistoryEntry({
    kind: record.kind,
    pdfUrl: record.pdfUrl,
    page,
    link,
    quote: record.kind === "passage" ? record.selection : "",
    filename: record.filename
  });
  if (!ok) {
    // Couldn't write the clipboard: show the link in the popup with a Copy button.
    await openPopup();
  }
  return Boolean(ok);
}

// Copy without the clipboardWrite permission (which adds an install warning):
// write from the tab itself, which `activeTab` + `scripting` allow.
async function writeClipboard(tabId, text) {
  if (tabId !== undefined) {
    try {
      const [injection] = await chrome.scripting.executeScript({
        target: { tabId },
        func: value => navigator.clipboard.writeText(value).then(() => true, () => false),
        args: [text]
      });
      if (injection?.result === true) {
        return true;
      }
    } catch {
      // Not scriptable (e.g. chrome:// pages); try the offscreen document.
    }
  }
  const { ok } = await sendToOffscreen({ type: "copy", text }).catch(() => ({ ok: false }));
  return Boolean(ok);
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
