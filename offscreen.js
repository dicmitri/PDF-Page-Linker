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
      return { ok: copyText(message.text) };
    default:
      throw new Error(`Unknown request: ${message.type}`);
  }
}

// MV3 service workers have no clipboard; an offscreen document can use execCommand.
function copyText(text) {
  const textarea = document.getElementById("clipboard");
  textarea.value = text;
  textarea.select();
  const ok = document.execCommand("copy");
  textarea.value = "";
  return ok;
}
