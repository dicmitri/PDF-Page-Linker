import {
  AbortException,
  GlobalWorkerOptions,
  RenderingCancelledException,
  TextLayer,
  getDocument
} from "./pdfjs/build/pdf.mjs";

const HISTORY_KEY = "linkHistory";
const MAX_HISTORY_ITEMS = 200;
const MIN_SCALE = 0.25;
const MAX_SCALE = 4;
const ZOOM_STEP = 1.15;
const DEFAULT_SCALE = 2;

GlobalWorkerOptions.workerSrc = chrome.runtime.getURL("pdfjs/build/pdf.worker.mjs");

const elements = {
  appShell: document.getElementById("appShell"),
  sidebar: document.getElementById("sidebar"),
  thumbnails: document.getElementById("thumbnails"),
  viewerFrame: document.getElementById("viewerFrame"),
  pages: document.getElementById("pages"),
  status: document.getElementById("status"),
  toggleSidebar: document.getElementById("toggleSidebar"),
  fileName: document.getElementById("fileName"),
  prevPage: document.getElementById("prevPage"),
  nextPage: document.getElementById("nextPage"),
  pageNumber: document.getElementById("pageNumber"),
  pageTotal: document.getElementById("pageTotal"),
  zoomOut: document.getElementById("zoomOut"),
  zoomValue: document.getElementById("zoomValue"),
  zoomIn: document.getElementById("zoomIn"),
  fitWidth: document.getElementById("fitWidth"),
  downloadPdf: document.getElementById("downloadPdf"),
  copyLink: document.getElementById("copyLink")
};

const state = {
  pdfUrl: "",
  fetchUrl: "",
  filename: "document.pdf",
  pdf: null,
  pages: [],
  currentPage: 1,
  scale: 1,
  fitWidth: true,
  observer: null,
  thumbnailObserver: null,
  renderToken: 0,
  scrollRaf: 0,
  feedbackTimer: 0
};

init().catch(showError);

async function init() {
  state.pdfUrl = readPdfUrl();
  if (!state.pdfUrl) {
    throw new Error("No PDF URL was provided.");
  }

  state.fetchUrl = stripHash(state.pdfUrl);
  state.filename = filenameFromUrl(state.fetchUrl);
  elements.fileName.textContent = state.filename;
  elements.fileName.title = state.filename;

  bindControls();
  await loadPdf();
}

function readPdfUrl() {
  const hash = window.location.hash.slice(1);
  if (hash.startsWith("src=")) {
    return hash.slice(4);
  }

  const params = new URLSearchParams(window.location.search);
  return params.get("src") || "";
}

async function loadPdf() {
  setStatus("Loading PDF...");

  const loadingTask = getDocument({
    url: state.fetchUrl,
    withCredentials: true,
    cMapUrl: chrome.runtime.getURL("pdfjs/cmaps/"),
    cMapPacked: true,
    standardFontDataUrl: chrome.runtime.getURL("pdfjs/standard_fonts/"),
    wasmUrl: chrome.runtime.getURL("pdfjs/wasm/"),
    iccUrl: chrome.runtime.getURL("pdfjs/iccs/")
  });

  loadingTask.onPassword = updatePassword => {
    const password = window.prompt("Enter the password for this PDF.");
    if (password) {
      updatePassword(password);
    }
  };

  state.pdf = await loadingTask.promise;
  elements.pageTotal.textContent = `/ ${state.pdf.numPages}`;
  elements.pageNumber.max = String(state.pdf.numPages);

  await createPageShells();
  setScale(DEFAULT_SCALE, false, { preservePage: false });
  setupLazyRendering();
  setupThumbnailRendering();
  setStatus("");

  const requestedPage = pageFromUrl(state.pdfUrl);
  scrollToPage(clampPage(requestedPage || 1), "auto");
}

async function createPageShells() {
  const fragment = document.createDocumentFragment();

  for (let pageNumber = 1; pageNumber <= state.pdf.numPages; pageNumber += 1) {
    const page = await state.pdf.getPage(pageNumber);
    const viewport = page.getViewport({ scale: 1 });
    const pageElement = document.createElement("section");
    const canvas = document.createElement("canvas");
    const textLayer = document.createElement("div");
    const thumbnail = createThumbnailShell(pageNumber);

    pageElement.className = "page";
    pageElement.dataset.pageNumber = String(pageNumber);
    pageElement.style.setProperty("--page-ratio", `${viewport.width} / ${viewport.height}`);
    pageElement.setAttribute("aria-label", `Page ${pageNumber}`);

    canvas.className = "page-canvas";
    textLayer.className = "textLayer";

    pageElement.append(canvas, textLayer);
    fragment.append(pageElement);
    elements.thumbnails.append(thumbnail.button);

    state.pages.push({
      pageNumber,
      page,
      width: viewport.width,
      height: viewport.height,
      element: pageElement,
      canvas,
      textLayer,
      thumbnailButton: thumbnail.button,
      thumbnailCanvas: thumbnail.canvas,
      thumbnailRendered: false,
      rendered: false,
      rendering: false,
      renderTask: null,
      textLayerInstance: null
    });
  }

  elements.pages.append(fragment);
}

function setupLazyRendering() {
  state.observer?.disconnect();
  state.observer = new IntersectionObserver(entries => {
    for (const entry of entries) {
      if (!entry.isIntersecting) {
        continue;
      }

      const pageNumber = Number(entry.target.dataset.pageNumber);
      const record = state.pages[pageNumber - 1];
      renderPage(record, state.renderToken).catch(error => {
        if (!isExpectedRenderCancel(error)) {
          console.error(error);
        }
      });
    }
  }, {
    root: elements.viewerFrame,
    rootMargin: "900px 0px",
    threshold: 0.01
  });

  for (const record of state.pages) {
    state.observer.observe(record.element);
  }

  updateCurrentPageFromScroll();
}

function setupThumbnailRendering() {
  state.thumbnailObserver?.disconnect();
  state.thumbnailObserver = new IntersectionObserver(entries => {
    for (const entry of entries) {
      if (!entry.isIntersecting) {
        continue;
      }

      const pageNumber = Number(entry.target.dataset.pageNumber);
      renderThumbnail(state.pages[pageNumber - 1]).catch(console.error);
    }
  }, {
    root: elements.sidebar,
    rootMargin: "600px 0px",
    threshold: 0.01
  });

  for (const record of state.pages) {
    state.thumbnailObserver.observe(record.thumbnailButton);
  }
}

async function renderPage(record, token) {
  if (!record || record.rendered || record.rendering) {
    return;
  }

  record.rendering = true;
  const viewport = record.page.getViewport({ scale: state.scale });
  const outputScale = window.devicePixelRatio || 1;
  const context = record.canvas.getContext("2d", { alpha: false });

  record.element.style.width = `${viewport.width}px`;
  record.element.style.height = `${viewport.height}px`;
  record.element.style.setProperty("--total-scale-factor", state.scale);
  record.canvas.style.width = `${viewport.width}px`;
  record.canvas.style.height = `${viewport.height}px`;
  record.canvas.width = Math.floor(viewport.width * outputScale);
  record.canvas.height = Math.floor(viewport.height * outputScale);

  context.setTransform(outputScale, 0, 0, outputScale, 0, 0);
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, viewport.width, viewport.height);

  try {
    record.renderTask = record.page.render({
      canvasContext: context,
      viewport
    });
    await record.renderTask.promise;

    if (token !== state.renderToken) {
      return;
    }

    record.textLayer.replaceChildren();
    record.textLayerInstance = new TextLayer({
      textContentSource: record.page.streamTextContent({ includeMarkedContent: true }),
      container: record.textLayer,
      viewport
    });
    await record.textLayerInstance.render();
    installTextSelectionStabilizer(record.textLayer);

    if (token === state.renderToken) {
      record.rendered = true;
    }
  } finally {
    record.rendering = false;
    record.renderTask = null;
  }
}

function createThumbnailShell(pageNumber) {
  const button = document.createElement("button");
  const canvas = document.createElement("canvas");
  const label = document.createElement("span");

  button.type = "button";
  button.className = "thumbnail-button";
  button.dataset.pageNumber = String(pageNumber);
  button.title = `Go to page ${pageNumber}`;
  button.setAttribute("aria-label", `Go to page ${pageNumber}`);
  button.addEventListener("click", () => {
    scrollToPage(pageNumber);
  });

  canvas.className = "thumbnail-canvas";
  label.className = "thumbnail-label";
  label.textContent = String(pageNumber);

  button.append(canvas, label);
  return { button, canvas };
}

async function renderThumbnail(record) {
  if (!record || record.thumbnailRendered) {
    return;
  }

  const viewport = record.page.getViewport({ scale: 1 });
  const scale = 116 / viewport.width;
  const thumbViewport = record.page.getViewport({ scale });
  const outputScale = window.devicePixelRatio || 1;
  const context = record.thumbnailCanvas.getContext("2d", { alpha: false });

  record.thumbnailCanvas.width = Math.floor(thumbViewport.width * outputScale);
  record.thumbnailCanvas.height = Math.floor(thumbViewport.height * outputScale);
  record.thumbnailCanvas.style.width = `${thumbViewport.width}px`;
  record.thumbnailCanvas.style.height = `${thumbViewport.height}px`;

  context.setTransform(outputScale, 0, 0, outputScale, 0, 0);
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, thumbViewport.width, thumbViewport.height);

  await record.page.render({
    canvasContext: context,
    viewport: thumbViewport
  }).promise;

  record.thumbnailRendered = true;
}

function bindControls() {
  elements.toggleSidebar.addEventListener("click", () => {
    const isCollapsed = elements.appShell.classList.toggle("sidebar-collapsed");
    elements.toggleSidebar.setAttribute("aria-pressed", String(!isCollapsed));
    if (state.fitWidth) {
      window.requestAnimationFrame(applyFitWidth);
    }
  });

  elements.prevPage.addEventListener("click", () => {
    scrollToPage(state.currentPage - 1);
  });

  elements.nextPage.addEventListener("click", () => {
    scrollToPage(state.currentPage + 1);
  });

  elements.pageNumber.addEventListener("change", () => {
    scrollToPage(clampPage(Number(elements.pageNumber.value)));
  });

  elements.pageNumber.addEventListener("keydown", event => {
    if (event.key === "Enter") {
      event.currentTarget.blur();
    }
  });

  elements.zoomOut.addEventListener("click", () => {
    setScale(state.scale / ZOOM_STEP, false);
  });

  elements.zoomIn.addEventListener("click", () => {
    setScale(state.scale * ZOOM_STEP, false);
  });

  elements.fitWidth.addEventListener("click", () => {
    applyFitWidth();
  });

  elements.downloadPdf.addEventListener("click", () => {
    chrome.downloads.download({
      url: state.fetchUrl,
      filename: state.filename,
      saveAs: false
    });
  });

  elements.copyLink.addEventListener("click", () => {
    copyCurrentPageLink().catch(showError);
  });

  elements.viewerFrame.addEventListener("scroll", () => {
    if (state.scrollRaf) {
      return;
    }
    state.scrollRaf = window.requestAnimationFrame(() => {
      state.scrollRaf = 0;
      updateCurrentPageFromScroll();
    });
  });

  window.addEventListener("resize", () => {
    if (state.fitWidth) {
      applyFitWidth();
    }
  });
}

function setScale(nextScale, fitWidth, options = {}) {
  const { preservePage = true } = options;
  const currentPage = state.currentPage;
  const scale = clamp(nextScale, MIN_SCALE, MAX_SCALE);
  if (Math.abs(scale - state.scale) < 0.001 && fitWidth === state.fitWidth) {
    return;
  }

  state.scale = scale;
  state.fitWidth = fitWidth;
  elements.fitWidth.classList.toggle("active", fitWidth);
  updateZoomValue();
  resetRenderedPages();
  if (preservePage && state.pages.length) {
    scrollToPage(currentPage, "auto");
  }
  window.requestAnimationFrame(renderVisiblePages);
}

function applyFitWidth() {
  const firstPage = state.pages[0];
  if (!firstPage) {
    return;
  }

  const horizontalPadding = 48;
  const availableWidth = Math.max(260, elements.viewerFrame.clientWidth - horizontalPadding);
  setScale(availableWidth / firstPage.width, true);
}

function resetRenderedPages() {
  state.renderToken += 1;

  for (const record of state.pages) {
    record.renderTask?.cancel();
    record.textLayerInstance?.cancel?.();
    record.canvas.width = 0;
    record.canvas.height = 0;
    record.textLayer.replaceChildren();
    record.rendered = false;
    record.rendering = false;
    record.renderTask = null;
    record.textLayerInstance = null;

    const width = record.width * state.scale;
    const height = record.height * state.scale;
    record.element.style.width = `${width}px`;
    record.element.style.height = `${height}px`;
    record.element.style.setProperty("--total-scale-factor", state.scale);
  }
}

function renderVisiblePages() {
  const frameRect = elements.viewerFrame.getBoundingClientRect();
  const margin = 900;

  for (const record of state.pages) {
    const rect = record.element.getBoundingClientRect();
    if (rect.bottom >= frameRect.top - margin && rect.top <= frameRect.bottom + margin) {
      renderPage(record, state.renderToken).catch(error => {
        if (!isExpectedRenderCancel(error)) {
          console.error(error);
        }
      });
    }
  }
}

function scrollToPage(pageNumber, behavior = "smooth") {
  const page = clampPage(pageNumber);
  const record = state.pages[page - 1];
  if (!record) {
    return;
  }

  record.element.scrollIntoView({
    behavior,
    block: "start"
  });
  setCurrentPage(page);
}

function updateCurrentPageFromScroll() {
  const viewportTop = elements.viewerFrame.getBoundingClientRect().top;
  const viewportBottom = elements.viewerFrame.getBoundingClientRect().bottom;
  let bestPage = state.currentPage;
  let bestVisible = -1;

  for (const record of state.pages) {
    const rect = record.element.getBoundingClientRect();
    const visible = Math.min(rect.bottom, viewportBottom) - Math.max(rect.top, viewportTop);
    if (visible > bestVisible) {
      bestVisible = visible;
      bestPage = record.pageNumber;
    }
  }

  setCurrentPage(bestPage);
}

function setCurrentPage(pageNumber) {
  const page = clampPage(pageNumber);
  const previous = state.pages[state.currentPage - 1];
  previous?.thumbnailButton.classList.remove("active");

  state.currentPage = page;
  elements.pageNumber.value = String(page);
  elements.prevPage.disabled = page <= 1;
  elements.nextPage.disabled = page >= (state.pdf?.numPages || 1);

  const current = state.pages[page - 1];
  current?.thumbnailButton.classList.add("active");
  current?.thumbnailButton.scrollIntoView({
    block: "nearest"
  });
  renderThumbnail(current).catch(console.error);
}

async function copyCurrentPageLink() {
  const link = pageLinkFor(state.currentPage);
  await navigator.clipboard.writeText(link);
  await saveHistoryItem(link);
  showCopiedFeedback();
}

async function saveHistoryItem(link) {
  const entry = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    pdfUrl: state.fetchUrl,
    pageNumber: state.currentPage,
    filename: state.filename,
    copiedAt: new Date().toISOString(),
    link
  };

  const result = await chrome.storage.local.get({ [HISTORY_KEY]: [] });
  const history = [entry, ...result[HISTORY_KEY]].slice(0, MAX_HISTORY_ITEMS);
  await chrome.storage.local.set({ [HISTORY_KEY]: history });
}

function showCopiedFeedback() {
  window.clearTimeout(state.feedbackTimer);
  setCopyLinkLabel("Copied!");
  elements.copyLink.classList.add("copied");
  state.feedbackTimer = window.setTimeout(() => {
    setCopyLinkLabel("Link this page");
    elements.copyLink.classList.remove("copied");
  }, 1500);
}

function setCopyLinkLabel(label) {
  const labelElement = elements.copyLink.querySelector("span");
  if (labelElement) {
    labelElement.textContent = label;
  }
}

function pageLinkFor(pageNumber) {
  const url = new URL(state.fetchUrl);
  url.hash = "";
  return `${url.toString()}#page=${pageNumber}`;
}

function pageFromUrl(url) {
  try {
    const hash = new URL(url).hash;
    const match = hash.match(/page=(\d+)/i);
    return match ? Number(match[1]) : 0;
  } catch {
    return 0;
  }
}

function filenameFromUrl(url) {
  try {
    const pathname = new URL(url).pathname;
    const lastSegment = pathname.split("/").filter(Boolean).pop();
    return sanitizeFilename(decodeURIComponent(lastSegment || "document.pdf"));
  } catch {
    return "document.pdf";
  }
}

function sanitizeFilename(filename) {
  return filename.replace(/[<>:"\/\\|?*\u0000-\u001F]/g, "_") || "document.pdf";
}

function stripHash(url) {
  const parsed = new URL(url);
  parsed.hash = "";
  return parsed.toString();
}

function clampPage(pageNumber) {
  const max = state.pdf?.numPages || 1;
  return clamp(Number.isFinite(pageNumber) ? pageNumber : 1, 1, max);
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function setStatus(message) {
  elements.status.textContent = message;
  elements.status.hidden = !message;
}

function updateZoomValue() {
  elements.zoomValue.textContent = `${Math.round(state.scale * 100)}%`;
}

function installTextSelectionStabilizer(textLayer) {
  const endOfContent = document.createElement("div");
  endOfContent.className = "endOfContent";
  textLayer.append(endOfContent);

  textLayer.addEventListener("mousedown", () => {
    endOfContent.classList.add("active");
    document.addEventListener("mouseup", () => {
      endOfContent.classList.remove("active");
    }, { once: true });
  });
}

function showError(error) {
  console.error(error);
  setStatus(error?.message || "The PDF could not be loaded.");
}

function isExpectedRenderCancel(error) {
  return error instanceof RenderingCancelledException || error instanceof AbortException;
}
