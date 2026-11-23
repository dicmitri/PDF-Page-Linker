// Downloads a PDF, extracts each page's text with PDF.js, and asks match.js
// which page contains the selected text. Runs in the offscreen document.

import { getDocument, GlobalWorkerOptions } from "./pdfjs/pdf.mjs";
import { indexFromPageTexts, locateInIndex } from "./match.js";

GlobalWorkerOptions.workerSrc = new URL("./pdfjs/pdf.worker.mjs", import.meta.url).href;
const CMAP_URL = new URL("./pdfjs/cmaps/", import.meta.url).href;

const MAX_PDF_BYTES = 200 * 1024 * 1024;
const PAGE_CONCURRENCY = 6;
const INDEX_CACHE_SIZE = 3;

export class LocateError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

// ---------------------------------------------------------------------------
// Downloading

function looksLikePdf(bytes) {
  // The header may be preceded by junk; PDF readers scan the first 1 KB.
  const limit = Math.min(bytes.length, 1024) - 5;
  for (let i = 0; i <= limit; i += 1) {
    if (bytes[i] === 0x25 && bytes[i + 1] === 0x50 && bytes[i + 2] === 0x44 &&
        bytes[i + 3] === 0x46 && bytes[i + 4] === 0x2d) {
      return true;
    }
  }
  return false;
}

function concatChunks(chunks, total) {
  const data = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    data.set(chunk, offset);
    offset += chunk.length;
  }
  return data;
}

/**
 * Download the PDF with the user's cookies. Stops early if it isn't a PDF.
 * Cross-origin access comes from the temporary `activeTab` grant.
 */
export async function fetchPdf(url) {
  let response;
  try {
    response = await fetch(url, { credentials: "include" });
  } catch (error) {
    throw new LocateError("fetch-failed", `Couldn't download the PDF (${error.message}).`);
  }
  if (!response.ok) {
    throw new LocateError("fetch-failed", `Couldn't download the PDF (HTTP ${response.status}).`);
  }

  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  let checked = false;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    chunks.push(value);
    total += value.length;
    if (total > MAX_PDF_BYTES) {
      reader.cancel();
      throw new LocateError("too-large", "This PDF is too large to scan.");
    }
    if (!checked && total >= 1024) {
      checked = true;
      if (!looksLikePdf(concatChunks(chunks, total).subarray(0, 1024))) {
        reader.cancel();
        throw new LocateError("not-pdf", "This page isn't a PDF.");
      }
    }
  }
  const data = concatChunks(chunks, total);
  if (!checked && !looksLikePdf(data)) {
    throw new LocateError("not-pdf", "This page isn't a PDF.");
  }
  return data;
}

// ---------------------------------------------------------------------------
// Text extraction

async function extractPageText(pdf, pageNumber) {
  const page = await pdf.getPage(pageNumber);
  try {
    const content = await page.getTextContent();
    let raw = "";
    for (const item of content.items) {
      if (typeof item.str === "string") {
        raw += item.str;
        if (item.hasEOL) {
          raw += "\n";
        }
      }
    }
    return raw;
  } catch {
    return "";
  } finally {
    page.cleanup();
  }
}

/** Extract the text of every page and index it. */
export async function buildIndex(data, onProgress = () => {}) {
  let pdf;
  try {
    pdf = await getDocument({
      data,
      cMapUrl: CMAP_URL,
      cMapPacked: true,
      isEvalSupported: false,
      disableFontFace: true,
      verbosity: 0
    }).promise;
  } catch (error) {
    if (error?.name === "PasswordException") {
      throw new LocateError("encrypted", "This PDF is password protected.");
    }
    throw new LocateError("bad-pdf", `PDF.js couldn't read this PDF (${error?.message || error}).`);
  }

  try {
    const numPages = pdf.numPages;
    const pageTexts = new Array(numPages);
    let next = 1;
    let done = 0;
    const worker = async () => {
      while (next <= numPages) {
        const pageNumber = next;
        next += 1;
        pageTexts[pageNumber - 1] = await extractPageText(pdf, pageNumber);
        done += 1;
        onProgress(done, numPages);
      }
    };
    await Promise.all(Array.from({ length: Math.min(PAGE_CONCURRENCY, numPages) }, worker));
    return indexFromPageTexts(pageTexts);
  } finally {
    await pdf.destroy();
  }
}

// Small LRU cache so repeated links into the same PDF are instant.
const indexCache = new Map();

export function getIndex(url, onProgress, loader = fetchPdf) {
  if (indexCache.has(url)) {
    const cached = indexCache.get(url);
    indexCache.delete(url);
    indexCache.set(url, cached);
    return cached;
  }
  const promise = loader(url).then(data => buildIndex(data, onProgress));
  indexCache.set(url, promise);
  promise.catch(() => indexCache.delete(url));
  while (indexCache.size > INDEX_CACHE_SIZE) {
    indexCache.delete(indexCache.keys().next().value);
  }
  return promise;
}

/** Download (or reuse) the PDF at `url` and locate `selectionText` in it. */
export async function locate(url, selectionText, onProgress) {
  const startedAt = performance.now();
  const index = await getIndex(url, onProgress);
  const result = locateInIndex(index, selectionText);
  result.ms = Math.round(performance.now() - startedAt);
  return result;
}
