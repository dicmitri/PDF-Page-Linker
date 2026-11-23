import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildLink,
  cleanSelection,
  encodeTextTerm,
  fallbackDirective,
  filenameFromUrl,
  quoteClip,
  stripFragment,
  textDirective
} from "../linkformat.js";

test("dashes, commas and ampersands are escaped inside text terms", () => {
  assert.equal(encodeTextTerm("self-attention, a & b"), "self%2Dattention%2C%20a%20%26%20b");
});

test("text directive with prefix, range and suffix", () => {
  assert.equal(
    textDirective({ prefix: "as meeting the", start: "Residency", suffix: "test even if" }),
    "text=as%20meeting%20the-,Residency,-test%20even%20if"
  );
  assert.equal(textDirective({ start: "a b", end: "c d" }), "text=a%20b,c%20d");
});

test("links replace any existing fragment, including a :~: directive", () => {
  assert.equal(stripFragment("https://x.org/a.pdf#page=3:~:text=old"), "https://x.org/a.pdf");
  assert.equal(buildLink("https://x.org/a.pdf#page=3", { page: 12 }), "https://x.org/a.pdf#page=12");
  // "&" keeps page=12 readable for viewers that don't understand ":~:".
  assert.equal(
    buildLink("https://x.org/a.pdf?dl=1", { page: 12, directive: "text=hello" }),
    "https://x.org/a.pdf?dl=1#page=12&:~:text=hello"
  );
  assert.equal(new URLSearchParams(buildLink("https://x.org/a.pdf", { page: 7, directive: "text=a" }).split("#")[1]).get("page"), "7");
  assert.equal(buildLink("https://x.org/a.pdf", { directive: "text=hello" }), "https://x.org/a.pdf#:~:text=hello");
});

test("selection text is collapsed to single spaces", () => {
  assert.equal(cleanSelection("  line one\nline\ttwo  "), "line one line two");
});

test("fallback directive: exact for short, range for long", () => {
  assert.equal(fallbackDirective("short phrase"), "text=short%20phrase");
  assert.equal(
    fallbackDirective("one two three four five six seven eight nine ten"),
    "text=one%20two%20three%20four,seven%20eight%20nine%20ten"
  );
  assert.equal(fallbackDirective("   "), null);
});

test("filenames for the history list", () => {
  assert.equal(filenameFromUrl("https://arxiv.org/pdf/1706.03762"), "1706.03762");
  assert.equal(filenameFromUrl("https://x.org/docs/My%20Paper.pdf?x=1"), "My Paper.pdf");
});

test("quote with link: rich text links the quote, plain text keeps the URL", () => {
  const clip = quoteClip({
    quote: "Attention is\nall you <need> & more",
    link: "https://x.org/a.pdf#page=3&:~:text=Attention",
    page: 3
  });
  assert.equal(clip.text, "“Attention is all you <need> & more” (p. 3)\nhttps://x.org/a.pdf#page=3&:~:text=Attention");
  assert.equal(
    clip.html,
    "“<a href=\"https://x.org/a.pdf#page=3&amp;:~:text=Attention\">Attention is all you &lt;need&gt; &amp; more</a>” (p. 3)"
  );
  assert.equal(quoteClip({ quote: "hi", link: "https://x.org/a.pdf", page: undefined }).text, "“hi”\nhttps://x.org/a.pdf");
});
