# Chrome Web Store: everything to enter for 2.0.0

Ready-to-paste answers for each tab of the developer dashboard, in the order
the dashboard asks for them. Checked against Google's documentation in
November 2026; links at the end.

---

## Update the existing item, don't create a new one

**Submit 2.0.0 as an update to your existing PDF Page Linker item.** Don't
create a second item.

- **How:** in the dashboard, open the existing item → **Package** →
  **Upload new package** → upload `dist/pdf-page-linker-2.0.0.zip`. Then update
  the Store listing and Privacy tabs below and submit it for review. The
  version only has to be higher than the published one (2.0.0 > 1.0.0).
- **Why update:** it keeps the same item, URL, users and ratings. Name, icon,
  description, screenshots and permissions can all change in an update; the
  store reviews it like a new item.
- **Why not a new item:** Google's spam policy says "We don't allow any
  developer … to submit multiple extensions that provide duplicate experiences
  or functionality". A second item doing the same job would put the old one
  (or both) at risk. You'd also have to remove the old one, losing its users
  and reviews.
- **If the old item was never published** (it doesn't show up in store search,
  so it may be a draft, unlisted or still in review): the answer is the same.
  Open that item and upload the new package. Create a new item only if the
  dashboard has no item at all.

What existing v1 users will see:

- Chrome asks them to accept the new permission ("Modify data you copy and
  paste") and keeps the extension disabled until they do. v1's own warnings
  ("Read and change all your data on all websites", downloads, tabs) are gone.
- PDFs open in Chrome's own viewer again. The custom viewer is gone.
- Their v1 link history still appears in the popup.

---

## Package tab

| Field | Value |
|---|---|
| Package | `dist/pdf-page-linker-2.0.0.zip`, built with `mkdir -p dist && git archive --format=zip --output=dist/pdf-page-linker-2.0.0.zip HEAD` from the merged commit |
| Version | 2.0.0 (from `manifest.json`) |

---

## Store listing tab

### Product details

**Title** (from the manifest's `name`, so it can't be edited here):
```
PDF Page and Passage Links
```

**Summary** (from the manifest's `description`, 132 characters max; edit
`manifest.json` to change it):
```
Right-click text in a PDF to copy a link to its page or passage, or the quote with its link.
```

**Description:**
```
Share exactly where you mean in an online PDF.

Select any text in a PDF, right-click, and choose:

• Copy link to this page: opens the PDF on that page. The page number is found for you.
• Copy link to this passage: opens the PDF scrolled to your passage, highlighted.
• Copy quote with link: paste the passage into Docs, Gmail, Slack or Word as a linked quote with its page number, like “…your passage…” (p. 12).

Whoever you send a link to doesn't need the extension. Chrome on desktop opens passage links with the passage highlighted, and most other browsers open the right page.

Also included:
• Text on several pages? The extension shows each place in context and asks which one you meant.
• Keyboard shortcut: Alt+Shift+L copies a passage link (change it at chrome://extensions/shortcuts).
• Link to any page by typing its number in the popup.
• Recent links are kept on your device, with Open, Copy and Delete.

It works inside Chrome's own PDF viewer. Nothing is replaced or redirected, so search, printing, forms and links inside PDFs keep working as usual. Works with PDFs opened from the web (http and https).

Privacy: no accounts, no analytics, no servers. When you use it, the extension downloads only the PDF you are linking into, from the site it came from, and reads its text on your device to find the page. Your link history stays on your device.

Uses the open-source PDF.js library by Mozilla to read PDF text.
```

**Category:** `Tools`. `Education` also fits if you mainly expect students and researchers.

**Language:** English.

### Graphic assets

| Field | File |
|---|---|
| Store icon (128×128) | `store-assets/icons/chrome_web_store_icon_128x128.png` |
| Screenshots (1280×800, in this order) | `store-assets/screenshots/01-right-click-menu.png`<br>`02-passage-highlighted.png`<br>`03-quote-pasted.png`<br>`04-page-chooser.png`<br>`05-popup-history.png` |
| Small promo tile (440×280) | `store-assets/promotional-images/small_promo_tile_440x280.png` |
| Marquee promo tile (1400×560) | `store-assets/promotional-images/marquee_promo_tile_1400x560.png` |
| Global promo video | Leave empty |

The screenshots have captions. Uncaptioned versions are in
`store-assets/screenshots/raw/` if you prefer them. All are real captures of
2.0.0 in Chrome on a sample document made for the listing
(`store-assets/screenshot-source/`), served at the documentation domain
`example.org`.

### Additional fields

| Field | Value |
|---|---|
| Official URL | Leave empty (it only lists sites you've verified in Google Search Console) |
| Homepage URL | `https://github.com/dicmitri/PDF-Page-Linker`, if the repository is public; otherwise leave empty |
| Support URL | `https://github.com/dicmitri/PDF-Page-Linker/issues` (public repo), or a support email address |
| Mature content | No |

---

## Privacy practices tab

**Single purpose description:**
```
Copy shareable links to a specific page or passage of a PDF the user is reading in Chrome's PDF viewer, optionally together with the quoted text.
```

**Permission justifications:**

| Permission | Justification to paste |
|---|---|
| `activeTab` | When the user clicks one of the extension's right-click items or presses its keyboard shortcut, the extension downloads the PDF open in that tab and reads its text locally to find the page of the selected text. No access to any site otherwise. |
| `clipboardWrite` | Copies the generated link, or the quote with its link, to the clipboard. |
| `contextMenus` | Adds "Copy link to this page", "Copy link to this passage" and "Copy quote with link" to the right-click menu on selected text. |
| `offscreen` | Runs PDF.js text extraction (which needs a document and a Web Worker) and writes to the clipboard, in a hidden extension page. |
| `scripting` | Reads the selected text from the active tab when the user presses the keyboard shortcut (Chrome passes the selection to right-click menu items but not to shortcuts). |
| `storage` | Saves the user's recent links on their device so they can copy or open them again. |

Host permissions: none requested, so no justification field appears.

**Remote code:** select **"No, I am not using remote code"**. All code,
including PDF.js, is bundled in the package.

**Data usage.** Tick these two data types:

- ☑ **Web history**: the addresses of PDFs the user links to are kept in the
  local link history.
- ☑ **Website content**: the selected text and the PDF's text are read to find
  the page; passage and quote links keep up to 240 characters of the selected
  text in the history.

Leave every other type unticked: personally identifiable information, health,
financial and payment, authentication, personal communications, location, and
user activity.

Tick even though nothing leaves the device. Google's User Data FAQ: "Extensions
are required to disclose how they handle user data, even when data is processed
or stored locally on a user's device and is not transmitted to external servers
or third parties."

**Certifications.** Tick all three:

- ☑ I do not sell or transfer user data to third parties, outside of the approved use cases
- ☑ I do not use or transfer user data for purposes that are unrelated to my item's single purpose
- ☑ I do not use or transfer user data to determine creditworthiness or for lending purposes

**Privacy policy URL** (required, because the extension handles user data):
publish `PRIVACY.html` and paste its URL. The easiest way is GitHub Pages
(repository **Settings → Pages → Deploy from a branch → main / root**), which
serves it at:
```
https://dicmitri.github.io/PDF-Page-Linker/PRIVACY.html
```
GitHub Pages on a free account needs a public repository. Otherwise host the
file anywhere public.

---

## Distribution tab

| Field | Value |
|---|---|
| Payments | Free of charge |
| Visibility | Public |
| Regions | All regions |

---

## Test instructions (for reviewers)

No account or login is needed. Paste into the test instructions field:
```
No login required.
1. Open a public PDF in Chrome, e.g. https://arxiv.org/pdf/1706.03762
2. Select a sentence on any page, right-click, open "PDF Page and Passage Links" and choose "Copy link to this passage". The toolbar badge shows the detected page number.
3. Paste the copied link into a new tab: the PDF opens on that page with the passage highlighted.
4. "Copy link to this page" copies a #page=N link. "Copy quote with link" copies the quote plus link as rich text (paste it into an email or document).
5. Select the words "positional encoding" (they appear on pages 6, 8 and 9) and choose "Copy link to this page": the popup shows each place in context and asks which page you meant. A very common word such as "attention" asks for a longer selection instead.
6. Alt+Shift+L with text selected copies a passage link. The toolbar popup shows recent links and lets you link to a page by number.
The extension only works in PDFs opened over http/https; on normal web pages it says it isn't a PDF.
```

---

## Account tab (one-time)

- Make sure the developer contact email is verified.
- Trader / non-trader declaration (EU): choose whatever applies to you.
  A free personal project is usually "non-trader".

---

## Before you press "Submit for review"

- [ ] PR merged; ZIP built from that commit; ZIP loaded once with **Load unpacked**.
- [ ] The privacy policy URL opens in a private window.
- [ ] Screenshots uploaded in order; both promo tiles uploaded.
- [ ] Privacy tab data types and justifications match this page and `PRIVACY.html`.

## Sources

- Images: https://developer.chrome.com/docs/webstore/images
- Listing fields: https://developer.chrome.com/docs/webstore/cws-dashboard-listing
- Privacy fields: https://developer.chrome.com/docs/webstore/cws-dashboard-privacy
- Updating an item: https://developer.chrome.com/docs/webstore/update
- User data FAQ: https://developer.chrome.com/docs/webstore/program-policies/user-data-faq
- Spam and repetitive content: https://developer.chrome.com/docs/webstore/program-policies/spam-and-abuse
- Categories: https://developer.chrome.com/docs/webstore/best-practices
