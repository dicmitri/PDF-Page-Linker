# Third-Party Notices

## PDF.js

- Project: PDF.js, https://github.com/mozilla/pdf.js
- Version: 5.6.205 (build `ada343803`)
- Copyright: Mozilla Foundation and PDF.js contributors
- License: Apache License 2.0, included as `pdfjs/LICENSE`
- Bundled files: `pdfjs/pdf.mjs`, `pdfjs/pdf.worker.mjs` (the core library, unmodified)

PDF.js is used only to extract the text of PDFs, so the extension can find which
page a selection is on. The PDF.js viewer is not included; PDFs are displayed by
Chrome's own viewer.

## Adobe CMap resources (via PDF.js)

- Files: `pdfjs/cmaps/*.bcmap`, distributed with PDF.js
- Copyright: 1990-2009 Adobe Systems Incorporated
- License: BSD-style, included as `pdfjs/cmaps/LICENSE`

These character maps let PDF.js extract text from PDFs that use CJK
(Chinese, Japanese, Korean) font encodings.

---

Mozilla, Firefox, PDF.js and Adobe names and marks belong to their respective
owners. This project is not affiliated with, sponsored by, or endorsed by
Mozilla or Adobe.
