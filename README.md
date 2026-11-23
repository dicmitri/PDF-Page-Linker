# PDF Page Linker

A Chrome extension for sharing links to a specific page, or a specific
passage, of an online PDF. Select text in a PDF, right-click, and copy a link;
the page number is filled in for you.

It works with Chrome's own PDF viewer. Nothing is replaced or redirected, so
search, printing, forms, the outline and clickable links inside PDFs all keep
working as usual.

```
Right-click a selection ─► "Copy link to this page"     ─► https://host/doc.pdf#page=12
                         └► "Copy link to this passage" ─► https://host/doc.pdf#page=12:~:text=first%20words,last%20words
```

Whoever opens a passage link in Chrome lands on that passage, highlighted, with
no extension needed. If the passage can't be found, Chrome falls back to
`page=12`. Other PDF viewers that understand `#page=` open the right page.

## Using it

- **Copy link to this page / passage**: select any text in a PDF and right-click
  → **PDF Page Linker**. When the link is copied, the toolbar badge shows the
  page number.
- **Same text on several pages**: the popup opens and asks which one you meant,
  showing each occurrence in context. Text that appears on more than 10 pages
  asks you to select a longer passage instead.
- **Link to a page by number**: click the toolbar icon, type a page number and
  press **Copy link** (the original version's feature, still there for scanned
  PDFs or when you'd rather not select anything).
- **Recent links**: the popup lists everything you've copied, with **Open**,
  **Copy** and **Delete**. Links copied with version 1 still appear.

## Install for development

1. Open `chrome://extensions` (Chrome 127 or newer) and enable **Developer mode**.
2. Choose **Load unpacked** and select this repository folder.
3. Open any web PDF, select some text and right-click.

Only PDFs opened over `http`/`https` are supported.

## How it works

1. `contextMenus` gives the extension the selected text and the PDF's URL.
   Clicking the menu item also grants `activeTab`: temporary access to that
   tab's site, with no permission prompt.
2. An offscreen document downloads the PDF again (with the browser's cookies
   for that site) and extracts each page's text with PDF.js (`locate.js`).
3. `match.js` finds the selection in that text. Chrome's viewer (PDFium) and
   PDF.js extract text slightly differently (spacing, ﬁ ligatures,
   hyphenated line breaks, accents), so both sides are reduced to lower-case
   letters and digits before matching. If that fails, it tries the
   selection's beginning and end ("head-tail"), then a word-overlap score ("fuzzy").
4. Passage links use the words from Chrome's own selection, so Chrome will find
   them. The PDF text is used to check they are unique, and to add surrounding
   words (`prefix-,` / `,-suffix`) when they aren't.
5. The link is copied by a script injected into the tab. If that isn't
   possible, the popup shows it with a **Copy** button.

The text of the last three PDFs is kept in memory, so further links into the
same PDF are instant.

## Permissions

| Permission | Why |
|---|---|
| `contextMenus` | The right-click items |
| `activeTab` | Download the PDF you right-clicked in, only after you click an item |
| `offscreen` | Run PDF.js (it needs a document and a worker) |
| `scripting` | Write the link to the clipboard from the tab |
| `storage` | Keep the link history on your device |

There are no host permissions, and Chrome shows no permission warnings when
installing (checked with `chrome.management.getPermissionWarningsByManifest`).
See [PRIVACY.html](PRIVACY.html) for what is stored.

## Project layout

| Path | Role |
|---|---|
| `manifest.json` | Extension manifest (MV3) |
| `background.js` | Context menu, offscreen document, badge, clipboard |
| `offscreen.html` / `offscreen.js` | Hidden page that runs PDF.js |
| `locate.js` | Download, PDF.js text extraction, cache |
| `match.js` | Matching and passage-link logic (no browser dependencies) |
| `linkformat.js` | Link and `text=` directive encoding |
| `popup.*` | Last result, page chooser, manual page entry, history |
| `history.js` | Link history in `chrome.storage.local` |
| `pdfjs/` | PDF.js 5.6.205 core library and character maps (see notices) |
| `tests/` | Unit tests and the real-browser accuracy test |
| `store-assets/` | Chrome Web Store images (not part of the package) |

## Tests

```sh
node --test 'tests/*.test.mjs'                 # matching and link format, no browser
xvfb-run -a node tests/browser/accuracy.cjs    # real Chrome; drop xvfb-run on a desktop
```

The accuracy test needs Playwright (`npm i -D playwright`). It makes real mouse
selections in Chrome's PDF viewer on four public PDFs (downloaded on first run
into `tests/browser/.pdfs/`), and checks the detected pages. It then opens the
generated passage links to check where Chrome lands. Latest result (Chromium
153):
- 31 selections, 12 to 6,003 characters;
- 29 on the exact page, 2 short fragments correctly reported as being on
  several pages, 0 wrong;
- all 31 passage links opened on the right page.

## Packaging for the Chrome Web Store

```sh
mkdir -p dist && git archive --format=zip --output=dist/pdf-page-linker-2.0.0.zip HEAD
```

`.gitattributes` keeps tests, docs and store assets out of the archive. See
[submission.md](submission.md) for the store checklist.

## Known limitations

- **The PDF is downloaded a second time** when you create the first link for
  it, because Chrome's viewer and extensions don't share a cache. Long PDFs
  show progress on the badge.
- **PDFs behind a login are untested.** The download sends the browser's
  cookies, but some sites may still refuse it. You then get a passage link
  without a page number, plus the manual page box.
- **Scanned PDFs without a text layer** can't be detected; use the manual page box.
- **Not supported yet:** `file://` PDFs, and PDFs embedded in another site's frame.
- **The menu appears on every text selection**, because an extension can't tell
  in advance that a tab is a PDF. On normal pages it says it isn't a PDF.
- **Firefox and Safari** haven't been tested with combined `#page=N:~:text=…` links.
- Chrome 153's viewer has its own greyed-out "Copy link to highlight" for
  PDFs. If Google enables it, plain passage links become built in; page
  detection, the page fallback and history remain this extension's job.

## Version 1

Version 1 replaced Chrome's PDF viewer with a custom PDF.js viewer that could
read the current page number. It was removed in 2.0 because recreating a
whole viewer broke too much: toolbar layout, memory use on long PDFs, links
inside PDFs, search, printing and redirects of non-PDF pages. It is
preserved in git history at commit `1f3ea4d`.

## Notices

Bundles the PDF.js core library by Mozilla, used only to extract text. See
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md), `pdfjs/LICENSE` and
`pdfjs/cmaps/LICENSE`.
