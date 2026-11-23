# Chrome Web Store Submission Checklist (v2.0.0)

## Package

- Bump `version` in `manifest.json` before every upload (currently `2.0.0`).
- Build the ZIP from a committed tree:
  ```sh
  mkdir -p dist && git archive --format=zip --output=dist/pdf-page-linker-2.0.0.zip HEAD
  unzip -l dist/pdf-page-linker-2.0.0.zip   # check the contents
  ```
  `.gitattributes` excludes `tests/`, `store-assets/`, docs and dotfiles, so the
  ZIP contains only the manifest, the extension's JS/HTML/CSS, `icons/` and `pdfjs/`.
- Load the unzipped folder with **Load unpacked** once, to be sure it runs.
- Icons are wired in `manifest.json` (`icons/` 16, 32, 48, 128). The store icon is
  `store-assets/icons/chrome_web_store_icon_128x128.png` (96 px artwork inside
  16 px transparent padding); SVG sources and a 1024 px master are alongside it.

## Store listing

Every dashboard field (listing text, category, images, privacy answers,
distribution, reviewer instructions) is drafted, ready to paste, in
[store-assets/listing-copy/chrome-web-store-listing.md](store-assets/listing-copy/chrome-web-store-listing.md).
Publish 2.0.0 as an **update to the existing item**, not as a new item; that
file explains why.

- Screenshots: `store-assets/screenshots/01`–`05` (1280×800, captioned);
  uncaptioned versions in `store-assets/screenshots/raw/`.
- Promo tiles: `store-assets/promotional-images/` (440×280 and 1400×560).
- The screenshots use a sample PDF written for the listing
  (`store-assets/screenshot-source/`), so no third-party document appears in them.

## Privacy tab

- **Single purpose**: "Copy shareable links to a specific page or passage of a PDF the user is reading in Chrome's PDF viewer, optionally together with the quoted text."
- **Permission justifications**:
  - `contextMenus`: adds "Copy link to this page / passage" and "Copy quote with link" to the right-click menu on selected text.
  - `activeTab`: after the user clicks one of those items or presses the extension's keyboard shortcut, temporarily allows downloading the PDF open in that tab to find which page the selected text is on.
  - `offscreen`: runs PDF.js text extraction (which needs a document and a Web Worker) and writes the generated link to the clipboard.
  - `clipboardWrite`: copies the generated link, or the quote with its link, to the clipboard. Writing from the web page instead would make Chrome show the website asking for clipboard access.
  - `scripting`: reads the selected text from the active tab when the user presses the keyboard shortcut (Chrome passes the selection to context-menu clicks but not to shortcuts).
  - `storage`: keeps the user's link history locally.
  - No host permissions are requested.
- **Remote code**: none; all code, including PDF.js, is bundled.
- **Data handling facts to reflect in the disclosures** (check them against the
  dashboard's current definitions):
  - The selected text and the PDF's content are processed only on the device to
    find the page; nothing is transmitted to the developer or third parties.
  - Stored locally (`chrome.storage.local`): PDF URL, file name, page number,
    copied link, timestamp, and for passage and quote links up to 240
    characters of the selected text. The latest result is also kept in `chrome.storage.session`.
  - The only network request is re-downloading the PDF the user is viewing, from
    its original site.
  - No analytics, ads or tracking; data is not sold or used for unrelated purposes.
- Privacy policy URL: publish `PRIVACY.html` (e.g. via GitHub Pages) and link to it.

## Updating from v1

v2 removes `declarativeNetRequest`, `downloads`, `tabs` and the `http(s)://*/*`
host permissions. It adds `clipboardWrite`, whose warning ("Modify data you
copy and paste") v1 didn't have, so Chrome will ask existing users to accept it
and disables the extension until they do (Google: "When an update requires
additional permissions, users will be prompted to accept them or disable the
extension"). Their v1 link history stays visible in the popup (same storage key).

## Pre-submission checks

- `node --test 'tests/*.test.mjs'` passes.
- Optionally `node tests/browser/accuracy.cjs` (needs Playwright; on Linux,
  `xvfb-run -a`): 0 wrong pages.
- Manually, in a normal Chrome profile with v1 removed:
  - a `.pdf` URL and a PDF served without `.pdf` (e.g. `https://arxiv.org/pdf/1706.03762`);
  - Copy link to this page → badge shows the page; the pasted link opens on it;
  - Copy link to this passage → the pasted link highlights the passage;
  - Copy quote with link → pastes as a linked quote with "(p. N)" in Docs/Gmail,
    and as quote + link in a plain-text field;
  - Alt+Shift+L with text selected → passage link; with nothing selected → "Nothing selected";
  - a common word → popup asks which page; a very common word → "select a longer passage";
  - popup: Link to a page, recent links Open / Copy / Delete;
  - a normal web page → "Not a PDF", pointing to Chrome's own "Copy link to highlight".
- Open a copied page link and a passage link in a new tab in other browsers;
  expected results are in the README's "Where the links work" table.

## References

- Chrome Web Store publishing: https://developer.chrome.com/docs/webstore/publish
- Chrome Web Store preparation: https://developer.chrome.com/docs/webstore/prepare/
- Chrome Web Store images: https://developer.chrome.com/webstore/images
- Chrome Web Store privacy fields: https://developer.chrome.com/docs/webstore/cws-dashboard-privacy
