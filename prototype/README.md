# PDF Page Linker: page-detection prototype

Select text in a PDF, right-click, and copy a link to **that page** or **that
passage**. The page number is filled in automatically. It works on top of
Chrome's own PDF viewer; nothing replaces or redirects it.

```
Right-click a selection ─► "Copy link to this page"     ─► https://host/doc.pdf#page=12
                         └► "Copy link to this passage" ─► https://host/doc.pdf#page=12:~:text=first%20words,last%20words
```

Chrome's viewer scrolls to and highlights the `:~:text=` passage, and falls
back to `page=12` if the text can't be found. Viewers that don't understand
passage links still get the page number.

## Try it

1. In `chrome://extensions`, **turn off the old PDF Page Linker** (its redirect
   would take over PDFs, and this prototype relies on Chrome's own viewer).
2. Enable Developer mode, choose **Load unpacked**, and pick this `prototype/` folder.
3. Open any web PDF, select some text, right-click, and open **PDF Page Linker (prototype)**.

The toolbar badge shows the detected page number when a link has been copied.
If the text appears on several pages, the popup opens and asks which one you
meant. The popup also has the original **Link to a page** box for typing a
page number by hand, plus your recent links.

## How it works

1. `contextMenus` hands the extension the selected text and the PDF's URL.
   Clicking the menu item also grants `activeTab`: temporary access to that
   tab's site, with no permission prompt.
2. An offscreen document downloads the PDF (with the user's cookies) and
   extracts every page's text with PDF.js (`locate.js`).
3. `match.js` finds the selection in that text. Chrome's viewer (PDFium) and
   PDF.js extract text slightly differently (spacing, ﬁ ligatures, hyphenated
   line breaks, accents), so both sides are reduced to lower-case letters and
   digits before matching. If that fails, it tries the beginning and end of
   the selection ("head-tail"), then a word-overlap score ("fuzzy").
4. For passage links, the words come from Chrome's own selection, so Chrome
   will find them. The PDF text is used to check they are unique, and to add
   surrounding words (`prefix-,` / `,-suffix`) when they aren't.
5. The link is copied by a script injected into the tab (no `clipboardWrite`
   permission needed). If that fails, the popup shows the link with a Copy button.

The last three PDFs are cached in memory, so further links into the same PDF
are instant.

| File | Role |
|---|---|
| `background.js` | Context menu, offscreen document, badge, clipboard |
| `offscreen.html` / `offscreen.js` | Hidden page that runs PDF.js |
| `locate.js` | Download, PDF.js text extraction, cache |
| `match.js` | Pure matching and passage-link logic (unit-tested) |
| `linkformat.js` | Link and `text=` directive encoding |
| `popup.*` | Last result, page chooser, manual page entry, history |
| `history.js` | Link history in `chrome.storage.local` |

## Permissions

`activeTab`, `contextMenus`, `offscreen`, `scripting`, `storage`, and **no
host permissions**. `chrome.management.getPermissionWarningsByManifest`
returns no warnings for this manifest, so the install dialog shows none. For
comparison, `clipboardWrite` would add "Modify data you copy and paste", and
host access to all sites would add "Read and change all your data on all websites".

## Test results

Measured in Chromium 153 on Linux.

**Accuracy** (`tests/browser/accuracy.cjs`): real mouse selections in Chrome's
viewer on four public PDFs: two LaTeX papers (one two-column), a 75-page
paper, and the 142-page IRS Publication 17.
- 31 selections, 12 to 6,003 characters.
- Detected page: 29 exactly right. 2 were short fragments that really do
  appear on several pages; they were flagged as ambiguous, and the true page
  was listed. **0 wrong pages.**
- Generated passage links: 31/31 opened on the right page. 29/31 highlighted
  the passage. The two that didn't were table/figure fragments; they fell back
  to the page. (The script's highlight detector only recognises Chrome's
  highlight colour on white, so it reports 27; two highlights on grey table
  cells were checked by eye.)
- Time for the first link in a PDF (download plus text extraction, from a
  local server): 0.3–0.6 s for 15–75-page papers, 1.6–1.9 s for 142 pages,
  1.5 s for a synthetic 800-page PDF. Later links in the same PDF take a few ms.

**End to end** (real right-click menu driven with `xdotool`, clipboard read
from the X server):
- passage link copied, badge showed the page;
- ambiguous word: popup opened with 8 candidate pages, nothing was copied until
  one was picked, and the picked link highlighted that exact occurrence;
- word on 58 pages: "appears on too many pages… select a longer passage",
  nothing copied;
- HTML page: "This page isn't a PDF".

**Unit tests**: `node --test 'prototype/tests/*.test.mjs'` runs 19 tests for
the matching and link code (no browser needed).

**Accuracy test**: `xvfb-run -a node prototype/tests/browser/accuracy.cjs`
needs Playwright. On a desktop, drop `xvfb-run -a`.

## Known limitations / open questions

- **The PDF is downloaded twice.** Chrome's viewer and the extension don't
  share the HTTP cache, so large PDFs on slow connections take longer the
  first time. The badge shows progress for long documents.
- **Logged-in / cookie-protected PDFs are untested.** The download sends
  cookies, but third-party cookie rules may block some sites. If the download
  fails, a passage link is still copied without a page number, and the popup
  offers manual entry.
- **Scanned PDFs without a text layer** can't be detected; the popup asks for the page.
- **Only http(s) PDFs.** `file://` PDFs, and PDFs embedded in another site's
  iframe, aren't handled yet.
- **The menu shows on every text selection**, because an extension can't tell
  in advance that a tab is a PDF. On normal web pages it says it isn't a PDF.
- **Firefox and Safari behaviour** for `#page=N:~:text=…` links is untested.
  PDF.js reads `page` with `| 0`, so if Firefox doesn't strip the `:~:` part
  first, the page may be lost.
- One early build stalled once while scanning (badge stuck on "…"). It
  didn't happen again after adding progress messages; a 60-second timeout now
  guarantees an error message instead of a stuck badge.
- Chrome 153's viewer has its own greyed-out "Copy link to highlight" for
  PDFs. If Google enables it, passage links become built in; page detection,
  the page fallback and history remain this extension's job.
