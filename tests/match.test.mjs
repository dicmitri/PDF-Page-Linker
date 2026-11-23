// Run with: node --test 'tests/*.test.mjs'
// Page texts below imitate PDF.js output; selections imitate what Chrome's
// viewer (PDFium) hands to the context menu. The two differ in the ways that
// real PDFs differ: ligatures, hyphenation, missing spaces, accents, quotes.

import { test } from "node:test";
import assert from "node:assert/strict";
import { indexFromPageTexts, locateInIndex, normalize } from "../match.js";

const filler = n => `Filler sentence number ${n} keeps pages apart from each other.\n`;
const page = (n, body) => `${filler(n)}${body}\n${filler(n + 100)}`;

const doc = indexFromPageTexts([
  page(1, "Introduction to the method. We describe an efﬁcient approach to detec-\ntion of anomalies."),
  page(2, "The café served “quoted” text and naïve résumé entries."),
  page(3, "Results are summarized in Table 2.Our method outperformsthe baseline by 4.1 points."),
  page(4, "Residency test: the child must live with you. See the residency test rules."),
  page(5, "Also, the residency test applies to relatives in some cases."),
  `${filler(6)}A passage that ends at the bottom of the page and continues`,
  `onto the next page without any break in the sentence itself.\n${filler(107)}`,
  page(8, "Energy is given by the famous equation E = mc² where c is the speed of light in a vacuum, as shown by Einstein in 1905."),
  page(9, "Left column starts here with unique words alpha bravo charlie.\nRight column interleaves delta echo foxtrot golf hotel india.")
]);

const pagesOf = result => result.candidates.map(c => c.page);

test("normalize keeps letters/digits, folds case, splits ligatures and accents", () => {
  assert.equal(normalize("Eﬃcient Café, “naïve”!").text, "efficientcafenaive");
  const { text, map } = normalize("A-b");
  assert.equal(text, "ab");
  assert.deepEqual(map, [0, 2]);
});

test("exact match despite ligature and line-end hyphenation", () => {
  const result = locateInIndex(doc, "We describe an efficient approach to detection of anomalies.");
  assert.equal(result.status, "found");
  assert.equal(result.method, "exact");
  assert.deepEqual(pagesOf(result), [1]);
});

test("accents and curly quotes don't matter", () => {
  const result = locateInIndex(doc, 'The cafe served "quoted" text and naive resume entries.');
  assert.deepEqual(pagesOf(result), [2]);
});

test("missing spaces in the PDF.js text don't matter", () => {
  const result = locateInIndex(doc, "Table 2. Our method outperforms the baseline");
  assert.equal(result.status, "found");
  assert.deepEqual(pagesOf(result), [3]);
});

test("text on several pages is ambiguous and lists every page", () => {
  const result = locateInIndex(doc, "residency test");
  assert.equal(result.status, "ambiguous");
  assert.deepEqual(pagesOf(result), [4, 5]);
  assert.equal(result.candidates[0].occurrences, 2);
  // Each candidate gets prefix/suffix context so Chrome highlights that occurrence.
  for (const candidate of result.candidates) {
    assert.match(candidate.directive, /^text=.+-,residency%20test,-.+$/);
  }
});

test("selection running onto the next page reports the page it starts on", () => {
  const result = locateInIndex(doc, "ends at the bottom of the page and continues onto the next page");
  assert.equal(result.status, "found");
  assert.equal(result.candidates[0].page, 6);
  assert.equal(result.candidates[0].endPage, 7);
});

test("head-tail match survives a garbled middle (equations, symbols)", () => {
  const result = locateInIndex(doc, "Energy is given by the famous equation E = m·c^2 [garbled glyphs] where c is the speed of light in a vacuum, as shown by Einstein");
  assert.equal(result.status, "found");
  assert.equal(result.method, "head-tail");
  assert.deepEqual(pagesOf(result), [8]);
});

test("fuzzy match handles a different reading order between columns", () => {
  const result = locateInIndex(doc, "alpha delta bravo echo charlie foxtrot");
  assert.equal(result.status, "found");
  assert.equal(result.method, "fuzzy");
  assert.deepEqual(pagesOf(result), [9]);
});

test("very common text is reported as too common", () => {
  const manual = indexFromPageTexts(Array.from({ length: 15 }, (_, i) => `Publication 17 (2025)\nPage ${i + 1} body text ${i}.`));
  const result = locateInIndex(manual, "Publication 17 (2025)");
  assert.equal(result.status, "too-common");
  assert.ok(result.pageCount > 10);
});

test("many hits on early pages don't hide a later page", () => {
  // 60 hits on pages 1-5 and one on page 6: page 6 must still be offered.
  const pages = Array.from({ length: 5 }, (_, i) => `${"alpha bravo ".repeat(12)} page ${i}`);
  pages.push("the one alpha bravo on page six");
  const result = locateInIndex(indexFromPageTexts(pages), "alpha bravo");
  assert.equal(result.status, "ambiguous");
  assert.deepEqual(pagesOf(result), [1, 2, 3, 4, 5, 6]);
});

test("thousands of hits on one page don't hide a later page", () => {
  const index = indexFromPageTexts(["alpha bravo ".repeat(5000), "Unique context alpha bravo on page two."]);
  const result = locateInIndex(index, "alpha bravo");
  assert.equal(result.status, "ambiguous");
  assert.deepEqual(pagesOf(result), [1, 2]);
});

test("fuzzy matches on more than 10 pages are too common, not truncated", () => {
  const pages = Array.from({ length: 11 }, (_, i) => `page ${i} alpha charlie bravo`);
  const result = locateInIndex(indexFromPageTexts(pages), "alpha bravo charlie");
  assert.equal(result.method, "fuzzy");
  assert.equal(result.status, "too-common");
  assert.equal(result.pageCount, 11);
});

test("tiny selections and unknown text", () => {
  assert.equal(locateInIndex(doc, "of").status, "too-short");
  assert.equal(locateInIndex(doc, "this sentence is nowhere in the document").status, "not-found");
  assert.equal(locateInIndex(indexFromPageTexts(["", ""]), "anything at all").status, "no-text");
});

test("words cut in half by the selection are dropped from the link", () => {
  // User dragged from the middle of "Introduction" to the middle of "method".
  const result = locateInIndex(doc, "duction to the meth");
  assert.equal(result.status, "found");
  // "to the" also occurs elsewhere, so context is added: the words right next to it.
  assert.equal(result.candidates[0].directive, "text=each%20other.%20Introduction-,to%20the,-method.%20We%20describe");
});

test("long passages use textStart,textEnd", () => {
  const result = locateInIndex(doc, "Energy is given by the famous equation E = mc² where c is the speed of light in a vacuum, as shown by Einstein in 1905.");
  assert.equal(result.status, "found");
  assert.equal(result.candidates[0].directive, "text=Energy%20is%20given,by%20Einstein%20in%201905.");
});
