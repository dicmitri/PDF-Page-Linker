// Pure text matching: which page of a document contains a selection?
// No browser or PDF.js dependencies, so it can be unit-tested with Node.
//
// Chrome's viewer (PDFium) and PDF.js extract text slightly differently:
// spacing, ligatures (ﬁ vs fi), hyphenation at line ends, accents, quotes.
// To make the two comparable, both sides are reduced to lower-case letters and
// digits only ("normalized text") and matched on that. A map from every
// normalized character back to the original PDF.js text is kept so we can
// recover words around a match (for disambiguating text-fragment links).

import {
  EXACT_TERM_MAX_CHARS,
  EXACT_TERM_MAX_WORDS,
  cleanSelection,
  fallbackDirective,
  textDirective,
  wordsOf
} from "./linkformat.js";

// Matches kept per page. Every page is still scanned, so a phrase repeated
// thousands of times on early pages can't hide a later page.
const PER_PAGE_HITS = 20;
const MAX_CANDIDATES = 10;
const MIN_QUERY_CHARS = 4;

const ALNUM = /[\p{L}\p{N}]/u;
const MARK = /\p{M}/u;

// ---------------------------------------------------------------------------
// Normalization and indexing

/**
 * Reduce text to lower-case letters/digits. Returns the normalized string and,
 * for every UTF-16 unit of it, the index of the source character it came from.
 */
export function normalize(raw) {
  const out = [];
  const map = [];
  for (let i = 0; i < raw.length; ) {
    const cp = raw.codePointAt(i);
    const width = cp > 0xffff ? 2 : 1;
    if (cp < 128) {
      if ((cp >= 48 && cp <= 57) || (cp >= 97 && cp <= 122)) {
        out.push(raw[i]);
        map.push(i);
      } else if (cp >= 65 && cp <= 90) {
        out.push(String.fromCharCode(cp + 32));
        map.push(i);
      }
    } else {
      // NFKD splits ligatures (ﬁ -> fi) and accents (é -> e + mark).
      const decomposed = String.fromCodePoint(cp).normalize("NFKD").toLowerCase();
      for (const ch of decomposed) {
        if (ALNUM.test(ch) && !MARK.test(ch)) {
          out.push(ch);
          for (let unit = 0; unit < ch.length; unit += 1) {
            map.push(i);
          }
        }
      }
    }
    i += width;
  }
  return { text: out.join(""), map };
}

/** Build a searchable index from the raw text of each page (page 1 first). */
export function indexFromPageTexts(pageTexts) {
  const pages = [];
  const starts = [];
  const parts = [];
  let length = 0;
  for (const raw of pageTexts) {
    const { text, map } = normalize(raw || "");
    starts.push(length);
    pages.push({ raw: raw || "", map: Int32Array.from(map), start: length, length: text.length });
    parts.push(text);
    length += text.length;
  }
  return { numPages: pageTexts.length, pages, starts, text: parts.join("") };
}

// ---------------------------------------------------------------------------
// Helpers

function findAll(haystack, needle, limit) {
  const hits = [];
  let at = haystack.indexOf(needle);
  while (at !== -1 && hits.length < limit) {
    hits.push(at);
    at = haystack.indexOf(needle, at + 1);
  }
  return hits;
}

function countOccurrences(index, normalizedTerm, limit = 2) {
  return normalizedTerm ? findAll(index.text, normalizedTerm, limit).length : 0;
}

/**
 * Offsets of `needle` on every page it occurs on, keeping at most
 * PER_PAGE_HITS per page and then skipping to the next page.
 */
function findOnEveryPage(index, needle) {
  const hits = [];
  let from = 0;
  let currentPage = -1;
  let onPage = 0;
  for (;;) {
    const at = index.text.indexOf(needle, from);
    if (at === -1) {
      return hits;
    }
    const pageIndex = pageIndexAt(index, at);
    if (pageIndex !== currentPage) {
      currentPage = pageIndex;
      onPage = 0;
    }
    hits.push(at);
    onPage += 1;
    from = at + 1;
    if (onPage >= PER_PAGE_HITS) {
      const nextPageStart = pageIndex + 1 < index.starts.length ? index.starts[pageIndex + 1] : index.text.length;
      from = Math.max(from, nextPageStart);
    }
  }
}

/** Index (0-based) of the page containing a normalized offset. */
function pageIndexAt(index, offset) {
  let lo = 0;
  let hi = index.starts.length - 1;
  let found = 0;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (index.starts[mid] <= offset) {
      found = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return found;
}

/** Map a normalized offset to {pageIndex, rawIndex} in the page's raw text. */
function rawPosition(index, offset) {
  const pageIndex = pageIndexAt(index, offset);
  const page = index.pages[pageIndex];
  return { pageIndex, rawIndex: page.map[offset - page.start] };
}

function snippetAround(page, rawStart, rawEnd) {
  const from = Math.max(0, rawStart - 70);
  let before = page.raw.slice(from, rawStart);
  let after = page.raw.slice(rawEnd + 1, rawEnd + 71);
  // Don't start or end the snippet halfway through a word.
  if (from > 0) before = before.replace(/^\S*\s/, "");
  if (rawEnd + 71 < page.raw.length) after = after.replace(/\s\S*$/, "");
  const match = page.raw.slice(rawStart, rawEnd + 1);
  const more = rawEnd + 71 < page.raw.length;
  return cleanSelection(`${from > 0 ? "…" : ""}${before}[[${match}]]${after}${more ? "…" : ""}`);
}

// ---------------------------------------------------------------------------
// Text directives

/**
 * Build a text directive for one match. The terms come from Chrome's own
 * selection text (so they match what Chrome's viewer will search), while the
 * index is used to check uniqueness and to supply prefix/suffix words.
 */
function directiveForHit(index, selectionWords, hit, totalHits) {
  const start = rawPosition(index, hit.start);
  const end = rawPosition(index, hit.end - 1);
  const startPage = index.pages[start.pageIndex];
  const endPage = index.pages[end.pageIndex];

  // Text fragments only match whole words. Drop words the user cut in half.
  let words = selectionWords.slice();
  const charBefore = startPage.raw[start.rawIndex - 1] || "";
  const charAfter = endPage.raw[end.rawIndex + 1] || "";
  const droppedFirst = ALNUM.test(charBefore) && words.length > 1;
  if (droppedFirst) {
    words = words.slice(1);
  }
  const droppedLast = ALNUM.test(charAfter) && words.length > 1;
  if (droppedLast) {
    words = words.slice(0, -1);
  }
  if (!words.length) {
    return null;
  }

  const joined = words.join(" ");
  let parts;
  let needsContext;
  if (words.length <= EXACT_TERM_MAX_WORDS && joined.length <= EXACT_TERM_MAX_CHARS) {
    parts = { start: joined };
    needsContext = totalHits > 1 || countOccurrences(index, normalize(joined).text) > 1;
  } else {
    // Long passage: textStart,textEnd. Grow the start until it is unique.
    const endCount = Math.min(4, Math.max(2, Math.floor(words.length / 4)));
    const maxStart = Math.max(3, words.length - endCount);
    let startCount = 3;
    while (startCount < maxStart &&
           countOccurrences(index, normalize(words.slice(0, startCount).join(" ")).text) > 1) {
      startCount += 1;
    }
    const startTerm = words.slice(0, startCount).join(" ");
    parts = { start: startTerm, end: words.slice(-endCount).join(" ") };
    needsContext = countOccurrences(index, normalize(startTerm).text) > 1;
  }

  if (needsContext) {
    // Prefix/suffix must sit right next to the linked words. If a half-selected
    // word was dropped above, the whole of that word is the nearest context.
    let prefixEnd = start.rawIndex;
    if (droppedFirst) {
      prefixEnd = tokenBounds(startPage.raw, start.rawIndex)[1];
    }
    let suffixStart = end.rawIndex + 1;
    if (droppedLast) {
      suffixStart = tokenBounds(endPage.raw, end.rawIndex)[0];
    }
    const before = wordsOf(startPage.raw.slice(Math.max(0, prefixEnd - 200), prefixEnd));
    const after = wordsOf(endPage.raw.slice(suffixStart, suffixStart + 200));
    if (before.length) parts.prefix = before.slice(-3).join(" ");
    if (after.length) parts.suffix = after.slice(0, 3).join(" ");
  }
  return textDirective(parts);
}

/** [start, end) of the whitespace-delimited token containing raw[index]. */
function tokenBounds(raw, index) {
  let start = index;
  while (start > 0 && !/\s/.test(raw[start - 1])) {
    start -= 1;
  }
  let end = index;
  while (end < raw.length && !/\s/.test(raw[end])) {
    end += 1;
  }
  return [start, end];
}

// ---------------------------------------------------------------------------
// Matching

function fuzzyCandidates(index, selectionWords) {
  const terms = [...new Set(selectionWords.map(word => normalize(word).text).filter(word => word.length >= 4))];
  if (terms.length < 3) {
    return [];
  }
  const scored = index.pages.map((page, pageIndex) => {
    const pageText = index.text.slice(page.start, page.start + page.length);
    const found = terms.filter(term => pageText.includes(term)).length;
    return { pageIndex, score: found / terms.length };
  }).sort((a, b) => b.score - a.score);
  const best = scored[0];
  if (!best || best.score < 0.6) {
    return [];
  }
  // All qualifying pages; the caller decides whether there are too many.
  return scored.filter(entry => entry.score >= Math.max(0.6, best.score - 0.1));
}

/**
 * Locate a selection in an index.
 *
 * status: "found" (one page), "ambiguous" (2-10 pages, see candidates),
 * "too-common" (more pages than that), "not-found", "too-short", "no-text".
 */
export function locateInIndex(index, selectionText) {
  const selection = cleanSelection(selectionText);
  const selectionWords = wordsOf(selection);
  const query = normalize(selection).text;
  const base = { numPages: index.numPages, candidates: [] };

  if (!index.text.length) {
    return { ...base, status: "no-text" };
  }
  if (query.length < MIN_QUERY_CHARS) {
    return { ...base, status: "too-short" };
  }

  // 1. Exact match on normalized text.
  let method = "exact";
  const hits = findOnEveryPage(index, query).map(at => ({ start: at, end: at + query.length }));

  // 2. Beginning and end match, middle differs (equations, figures, odd glyphs).
  if (!hits.length && query.length >= 30) {
    method = "head-tail";
    const k = Math.min(20, Math.floor(query.length / 3));
    const head = query.slice(0, k);
    const tail = query.slice(-k);
    const maxSpan = Math.ceil(query.length * 1.5) + 200;
    for (const at of findOnEveryPage(index, head)) {
      const tailAt = index.text.indexOf(tail, at + k);
      if (tailAt !== -1 && tailAt + k - at <= maxSpan) {
        hits.push({ start: at, end: tailAt + k });
      }
    }
  }

  if (hits.length) {
    const byPage = new Map();
    for (const hit of hits) {
      const pageIndex = pageIndexAt(index, hit.start);
      if (!byPage.has(pageIndex)) {
        byPage.set(pageIndex, { hit, occurrences: 0 });
      }
      byPage.get(pageIndex).occurrences += 1;
    }
    if (byPage.size > MAX_CANDIDATES) {
      return { ...base, status: "too-common", method, pageCount: byPage.size };
    }
    const candidates = [...byPage.entries()].map(([pageIndex, { hit, occurrences }]) => {
      const start = rawPosition(index, hit.start);
      const end = rawPosition(index, hit.end - 1);
      const page = index.pages[pageIndex];
      return {
        page: pageIndex + 1,
        endPage: end.pageIndex + 1,
        occurrences,
        directive: directiveForHit(index, selectionWords, hit, hits.length),
        snippet: snippetAround(page, start.rawIndex, start.pageIndex === end.pageIndex ? end.rawIndex : page.raw.length - 1)
      };
    });
    return {
      ...base,
      status: candidates.length === 1 ? "found" : "ambiguous",
      method,
      candidates
    };
  }

  // 3. Fuzzy: which page contains most of the selection's longer words.
  const fuzzy = fuzzyCandidates(index, selectionWords);
  if (fuzzy.length > MAX_CANDIDATES) {
    return { ...base, status: "too-common", method: "fuzzy", pageCount: fuzzy.length };
  }
  if (fuzzy.length) {
    const directive = fallbackDirective(selection);
    return {
      ...base,
      status: fuzzy.length === 1 ? "found" : "ambiguous",
      method: "fuzzy",
      candidates: fuzzy.map(({ pageIndex, score }) => ({
        page: pageIndex + 1,
        endPage: pageIndex + 1,
        occurrences: 1,
        score: Math.round(score * 100) / 100,
        directive,
        snippet: `${cleanSelection(index.pages[pageIndex].raw.slice(0, 140))}…`
      }))
    };
  }

  return { ...base, status: "not-found" };
}
