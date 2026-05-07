<# PDF Page Linker

A Chrome extension that opens web-served PDFs with a clean PDF instead of the Chrome default one. It keeps the basic core functionalities of the default viewer and adds one-click copying for links to the current page.

## Features

- Custom PDF.js viewer with continuous scrolling and selectable text.
- Minimal Chrome-style toolbar: navigation sidebar, previous/next, page number, zoom, fit width, download, and Link this page.
- Copies links in the form `https://example.com/file.pdf#page=12`.
- Saves copied links automatically to `chrome.storage.local`.
- Extension popup shows link history with one-click re-copy and delete.

## Development

1. Open `chrome://extensions` in Chrome 128 or newer.
2. Enable Developer mode.
3. Choose Load unpacked and select this repository folder.
4. Open an `http` or `https` PDF URL.

Local files are intentionally out of scope for this version.

## Notices

This extension bundles PDF.js by Mozilla as its PDF rendering engine. See `THIRD_PARTY_NOTICES.md` and `pdfjs/LICENSE` for attribution and license details.

History is stored locally in `chrome.storage.local`. See `PRIVACY.md` for the stored fields and privacy behavior.
>