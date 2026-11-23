// Building shareable links.
//
// Page links:    https://host/file.pdf#page=12
// Passage links: https://host/file.pdf#page=12:~:text=start%20words,end%20words
//
// Chrome's PDF viewer scrolls to and highlights the text directive, and falls
// back to page=12 when the text cannot be found. Viewers that do not know text
// fragments still get the page number.

/** Strip any fragment (including an existing :~: directive) from a URL. */
export function stripFragment(url) {
  const hashIndex = url.indexOf("#");
  return hashIndex === -1 ? url : url.slice(0, hashIndex);
}

/**
 * Percent-encode one term of a text directive. On top of encodeURIComponent,
 * the dash must be escaped because "-," and ",-" mark prefix/suffix.
 */
export function encodeTextTerm(term) {
  return encodeURIComponent(term).replace(/-/g, "%2D");
}

/** Collapse all whitespace (including PDF line breaks) into single spaces. */
export function cleanSelection(text) {
  return String(text || "").replace(/\s+/g, " ").trim();
}

/**
 * Assemble a text directive ("text=...") from already-chosen parts.
 * @param {{start: string, end?: string, prefix?: string, suffix?: string}} parts
 */
export function textDirective({ start, end, prefix, suffix }) {
  let body = encodeTextTerm(start);
  if (end) {
    body += `,${encodeTextTerm(end)}`;
  }
  if (prefix) {
    body = `${encodeTextTerm(prefix)}-,${body}`;
  }
  if (suffix) {
    body += `,-${encodeTextTerm(suffix)}`;
  }
  return `text=${body}`;
}

export function wordsOf(text) {
  return cleanSelection(text).split(" ").filter(Boolean);
}

// Short selections are matched exactly; longer ones use textStart,textEnd.
export const EXACT_TERM_MAX_WORDS = 8;
export const EXACT_TERM_MAX_CHARS = 80;

/** Directive built from the selection alone, used when the PDF index can't help. */
export function fallbackDirective(selectionText) {
  const words = wordsOf(selectionText);
  if (!words.length) {
    return null;
  }
  const joined = words.join(" ");
  if (words.length <= EXACT_TERM_MAX_WORDS && joined.length <= EXACT_TERM_MAX_CHARS) {
    return textDirective({ start: joined });
  }
  return textDirective({ start: words.slice(0, 4).join(" "), end: words.slice(-4).join(" ") });
}

/** Human-friendly name for a PDF URL. */
export function filenameFromUrl(url) {
  try {
    const parsed = new URL(url);
    const last = parsed.pathname.split("/").filter(Boolean).pop();
    return decodeURIComponent(last || parsed.hostname);
  } catch {
    return "document.pdf";
  }
}

/**
 * Build the final link.
 * @param {string} pdfUrl
 * @param {{page?: number, directive?: string}} options
 */
export function buildLink(pdfUrl, { page, directive } = {}) {
  const base = stripFragment(pdfUrl);
  let fragment = page ? `page=${page}` : "";
  if (directive) {
    fragment += `:~:${directive}`;
  }
  return fragment ? `${base}#${fragment}` : base;
}
