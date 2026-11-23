import { locate } from "./locate.js";

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.target !== "offscreen") {
    return false;
  }
  handle(message).then(sendResponse, error => {
    sendResponse({
      status: "error",
      code: error?.code || "internal",
      message: error?.message || String(error),
      candidates: []
    });
  });
  return true;
});

async function handle(message) {
  switch (message.type) {
    case "locate": {
      // Report progress so long PDFs show a percentage (and keep the worker awake).
      let lastSent = 0;
      const onProgress = (done, total) => {
        const now = Date.now();
        if (done === total || now - lastSent > 400) {
          lastSent = now;
          chrome.runtime.sendMessage({ target: "background", type: "progress", requestId: message.requestId, done, total })
            .catch(() => {});
        }
      };
      return locate(message.url, message.selection, onProgress);
    }
    case "copy":
      return { ok: copyClip(message.text, message.html) };
    default:
      throw new Error(`Unknown request: ${message.type}`);
  }
}

// MV3 service workers have no clipboard; an offscreen document can use
// execCommand("copy") (allowed by the clipboardWrite permission). The copy
// event sets plain text and, for quotes, rich text.
function copyClip(text, html) {
  const onCopy = event => {
    event.clipboardData.setData("text/plain", text);
    if (html) {
      event.clipboardData.setData("text/html", html);
    }
    event.preventDefault();
  };
  const textarea = document.getElementById("clipboard");
  textarea.value = text;
  textarea.select();
  document.addEventListener("copy", onCopy);
  const ok = document.execCommand("copy");
  document.removeEventListener("copy", onCopy);
  textarea.value = "";
  return ok;
}
