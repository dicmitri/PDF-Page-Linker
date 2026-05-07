# Chrome Web Store Submission Checklist

## Package items still needed

- Add extension icons to `store-assets/icons/` and then wire final paths into `manifest.json`.
  - Required package icon: `128x128`.
  - Recommended manifest icon sizes: `16x16`, `32x32`, `48x48`, `128x128`.
- Create final store screenshots in `store-assets/screenshots/`.
- Create promotional images in `store-assets/promotional-images/`.
  - Small promotional image and at least one screenshot are required for the listing.
- Prepare final listing copy in `store-assets/listing-copy/`.
- Prepare reviewer notes or demo/test instructions in `store-assets/review-materials/`.

## Store listing copy to finalize

- Extension name.
- Short description.
- Detailed description.
- Category.
- Language.
- Support/contact URL or email.
- Optional website URL.
- Screenshots captions, if desired.

## Privacy and compliance

- Complete the Chrome Web Store Privacy tab.
- Single purpose suggestion: "Replace browser PDF viewing with a clean PDF.js viewer that can copy and locally save links to the current PDF page."
- Declare locally stored history data:
  - PDF URL
  - page number
  - filename
  - copied page link
  - timestamp
- State that history is stored in `chrome.storage.local` and is not sent to an external server.
- Review `PRIVACY.md` and ensure the store privacy disclosures match it.
- Review `THIRD_PARTY_NOTICES.md` and keep `pdfjs/LICENSE` in the submitted package.

## Permission justifications

- `storage`: saves copied PDF page-link history locally.
- `downloads`: lets the viewer download the current PDF.
- `tabs`: opens saved history links from the popup with the Visit button.
- `declarativeNetRequest`: redirects web-served PDFs into the custom viewer.
- `host_permissions` for `http://*/*` and `https://*/*`: required to detect and fetch web-served PDFs.

## Pre-submission checks

- Reload the unpacked extension in Chrome.
- Test a visible `.pdf` URL.
- Test a PDF served by `Content-Type: application/pdf` without a `.pdf` suffix.
- Test text selection and copy/paste.
- Test `Link this page`, popup history, Copy, Visit, and Delete.
- Verify the uploaded ZIP excludes `.git`, temporary files, and source screenshots not intended for the store.
- Increment `manifest.json` version before each submitted update.

## References

- Chrome Web Store publishing: https://developer.chrome.com/docs/webstore/publish
- Chrome Web Store preparation: https://developer.chrome.com/docs/webstore/prepare/
- Chrome Web Store images: https://developer.chrome.com/webstore/images
- Chrome Web Store privacy fields: https://developer.chrome.com/docs/webstore/cws-dashboard-privacy
