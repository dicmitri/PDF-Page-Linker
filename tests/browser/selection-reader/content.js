// TEST ONLY. Asks Chrome's PDF viewer for its selected text through the viewer's
// internal postMessage channel, so the accuracy test sees exactly the text that
// the context menu would receive. The extension itself never does this.
window.addEventListener("message", event => {
  if (event.data?.__probe === "getSelection") {
    const iframe = chrome.dom.openOrClosedShadowRoot(document.body)?.querySelector("iframe");
    iframe?.contentWindow.postMessage({ type: "getSelectedText" }, "*");
  } else if (event.data?.type === "getSelectedTextReply") {
    document.documentElement.dataset.probeSelection = JSON.stringify({ text: event.data.selectedText });
  }
});
