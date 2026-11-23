#!/usr/bin/env node
// Real-browser accuracy test for page detection.
//
// For each test PDF it opens a page in Chrome's own PDF viewer, makes real
// mouse selections (short / medium / long), reads back exactly what Chrome
// selected, runs the extension's locator on it, and checks the detected page.
// It then opens each generated passage link to confirm Chrome lands on that page
// and highlights the passage.
//
// Requirements: Node 18+, `npm i -D playwright` (or a global install) and a
// Chromium that Playwright can launch with extensions (headed; on Linux run
// under `xvfb-run -a`).
//
//   node tests/browser/accuracy.cjs            # all PDFs
//   ONLY=irs-p17.pdf node tests/browser/accuracy.cjs
//
// The PDFs are downloaded once into tests/browser/.pdfs/ (git-ignored).

const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { chromium } = require("playwright");

const HERE = __dirname;
const EXTENSION = path.resolve(HERE, "../..");
const HELPER = path.join(HERE, "selection-reader");
const PDF_DIR = path.join(HERE, ".pdfs");
const RESULTS_DIR = path.join(HERE, "results");
const PORT = 8765;
const BASE = `http://127.0.0.1:${PORT}`;

// name, source URL, pages to sample
const DOCUMENTS = [
  ["arxiv-1706.03762.pdf", "https://arxiv.org/pdf/1706.03762", [2, 6, 10]],
  ["arxiv-1810.04805.pdf", "https://arxiv.org/pdf/1810.04805", [3, 5, 9]],
  ["arxiv-2005.14165.pdf", "https://arxiv.org/pdf/2005.14165", [7, 33, 61]],
  ["irs-p17.pdf", "https://www.irs.gov/pub/irs-pdf/p17.pdf", [12, 60, 118]]
];

// Drag boxes as fractions of the visible page: [name, x1, y1, x2, y2].
const SELECTIONS = [
  ["short", 0.0, 0.30, 0.45, 0.30],
  ["medium", 0.0, 0.42, 0.45, 0.50],
  ["long", 0.0, 0.58, 0.88, 0.85]
];
// Drags must start on text; try a few start points.
const START_OFFSETS = [[0.12, 0], [0.16, 9], [0.20, -7], [0.26, 15]];
const HIGHLIGHT_RGB = [233, 210, 253]; // Chrome's text-fragment highlight on white

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function ensurePdfs(documents) {
  fs.mkdirSync(PDF_DIR, { recursive: true });
  for (const [name, url] of documents) {
    const file = path.join(PDF_DIR, name);
    if (!fs.existsSync(file)) {
      console.log(`downloading ${url}`);
      const response = await fetch(url);
      if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
      fs.writeFileSync(file, Buffer.from(await response.arrayBuffer()));
    }
  }
}

// Serves the PDFs. With ?cors=1 it allows credentialed CORS so the locator can
// be called from an extension tab (real clicks use the activeTab grant instead).
function startServer() {
  const server = http.createServer((request, response) => {
    const url = new URL(request.url, BASE);
    const file = path.join(PDF_DIR, path.basename(url.pathname));
    if (!fs.existsSync(file)) {
      response.writeHead(404).end();
      return;
    }
    const headers = { "Content-Type": "application/pdf" };
    if (url.searchParams.get("cors") === "1" && request.headers.origin) {
      headers["Access-Control-Allow-Origin"] = request.headers.origin;
      headers["Access-Control-Allow-Credentials"] = "true";
    }
    response.writeHead(200, headers);
    fs.createReadStream(file).pipe(response);
  });
  return new Promise(resolve => server.listen(PORT, "127.0.0.1", () => resolve(server)));
}

// Pixel helpers run inside the extension page (PDF pages block data: images).
async function analyzeScreenshot(helperPage, viewer, mode) {
  const png = (await viewer.screenshot()).toString("base64");
  return helperPage.evaluate(async ([b64, mode, rgb]) => {
    const image = new Image();
    image.src = `data:image/png;base64,${b64}`;
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = image.width;
    canvas.height = image.height;
    const context = canvas.getContext("2d");
    context.drawImage(image, 0, 0);
    if (mode === "page-rect") {
      const white = (x, y) => {
        const d = context.getImageData(x, y, 1, 1).data;
        return d[0] > 250 && d[1] > 250 && d[2] > 250;
      };
      let left = -1;
      let right = -1;
      for (let x = 300; x < image.width - 20; x += 1) {
        let found = false;
        for (let y = 380; y < 440 && !found; y += 6) found = white(x, y);
        if (found) {
          if (left < 0) left = x;
          right = x;
        }
      }
      let top = -1;
      for (let y = 56; y < 300 && top < 0; y += 1) if (white(left + 3, y)) top = y;
      return { left, right, top, bottom: image.height };
    }
    const data = context.getImageData(300, 56, image.width - 320, image.height - 56).data;
    let highlight = 0;
    for (let i = 0; i < data.length; i += 4) {
      if (Math.abs(data[i] - rgb[0]) < 6 && Math.abs(data[i + 1] - rgb[1]) < 6 && Math.abs(data[i + 2] - rgb[2]) < 6) {
        highlight += 1;
      }
    }
    return { highlight, pageBox: Array.from(context.getImageData(430, 14, 40, 28).data) };
  }, [png, mode, HIGHLIGHT_RGB]);
}

const boxDifference = (a, b) => a.reduce((sum, value, i) => sum + Math.abs(value - b[i]), 0) / a.length;

async function readSelection(viewer) {
  await viewer.evaluate(() => {
    delete document.documentElement.dataset.probeSelection;
    window.postMessage({ __probe: "getSelection" }, "*");
  });
  await sleep(500);
  const raw = await viewer.evaluate(() => document.documentElement.dataset.probeSelection);
  return raw ? JSON.parse(raw).text : "";
}

async function dragSelect(viewer, rect, [x1base, y1, x2, y2]) {
  const width = rect.right - rect.left;
  const height = rect.bottom - rect.top;
  for (const [dx, dy] of START_OFFSETS) {
    const x1 = x1base + dx;
    await viewer.mouse.click(rect.left + 4, rect.top + 30); // clear the old selection
    await sleep(600);
    await viewer.mouse.move(rect.left + x1 * width, rect.top + y1 * height + dy);
    await viewer.mouse.down();
    await viewer.mouse.move(rect.left + ((x1 + x2) / 2) * width, rect.top + ((y1 + y2) / 2) * height, { steps: 6 });
    await viewer.mouse.move(rect.left + x2 * width, rect.top + y2 * height + dy, { steps: 6 });
    await viewer.mouse.up();
    await sleep(400);
    const text = await readSelection(viewer);
    if (text.trim().length >= 2) return text;
  }
  return "";
}

async function main() {
  const documents = process.env.ONLY ? DOCUMENTS.filter(([name]) => name === process.env.ONLY) : DOCUMENTS;
  await ensurePdfs(documents);
  fs.mkdirSync(RESULTS_DIR, { recursive: true });
  const server = await startServer();
  const context = await chromium.launchPersistentContext("", {
    headless: false,
    viewport: { width: 1280, height: 800 },
    args: [`--disable-extensions-except=${EXTENSION},${HELPER}`, `--load-extension=${EXTENSION},${HELPER}`]
  });
  const rows = [];
  try {
    let worker = context.serviceWorkers().find(w => w.url().endsWith("/background.js"));
    while (!worker) {
      worker = await context.waitForEvent("serviceworker");
      if (!worker.url().endsWith("/background.js")) worker = null;
    }
    const extensionId = new URL(worker.url()).host;
    const helperPage = await context.newPage();
    await helperPage.goto(`chrome-extension://${extensionId}/offscreen.html`);
    const viewer = await context.newPage();
    await viewer.bringToFront();

    for (const [name, , pages] of documents) {
      const settle = fs.statSync(path.join(PDF_DIR, name)).size > 2_500_000 ? 6000 : 4000;
      for (const pageNumber of pages) {
        await viewer.goto("about:blank");
        await viewer.goto(`${BASE}/${name}#page=${pageNumber}`);
        await sleep(settle);
        const rect = await analyzeScreenshot(helperPage, viewer, "page-rect");
        const reference = await analyzeScreenshot(helperPage, viewer, "pixels");

        const samples = [];
        for (const [size, ...box] of SELECTIONS) {
          const selection = await dragSelect(viewer, rect, box);
          if (!selection) {
            samples.push({ name, pageNumber, size, verdict: "no-selection" });
            continue;
          }
          const result = await helperPage.evaluate(async ([url, text]) => {
            const { locate } = await import("./locate.js");
            try {
              return await locate(url, text);
            } catch (error) {
              return { status: "error", code: error.code, message: error.message, candidates: [] };
            }
          }, [`${BASE}/${name}?cors=1`, selection]);
          const found = result.candidates.map(c => c.page);
          let verdict = result.status;
          if (result.status === "found") verdict = found[0] === pageNumber ? "correct" : "WRONG";
          if (result.status === "ambiguous") verdict = found.includes(pageNumber) ? "ambiguous-ok" : "ambiguous-WRONG";
          samples.push({
            name, pageNumber, size, verdict, method: result.method, ms: result.ms,
            selectionLength: selection.length, selection, found,
            directive: result.candidates.find(c => c.page === pageNumber)?.directive
          });
        }

        for (const sample of samples) {
          if (!sample.directive) continue;
          await viewer.goto("about:blank");
          await viewer.goto(`${BASE}/${name}#page=${pageNumber}:~:${sample.directive}`);
          await sleep(settle + 500);
          const after = await analyzeScreenshot(helperPage, viewer, "pixels");
          sample.highlightPixels = after.highlight;
          sample.landedOnPage = boxDifference(after.pageBox, reference.pageBox) < 6;
          if (!after.highlight) {
            await viewer.screenshot({ path: path.join(RESULTS_DIR, `no-highlight-${name}-p${pageNumber}-${sample.size}.png`) });
          }
        }

        for (const sample of samples) {
          rows.push(sample);
          console.log([
            sample.name, `p${sample.pageNumber}`, sample.size, sample.verdict, sample.method || "",
            sample.selectionLength ? `${sample.selectionLength} chars` : "",
            sample.ms !== undefined ? `${sample.ms} ms` : "",
            sample.highlightPixels !== undefined ? `link: highlight=${sample.highlightPixels > 0} on-page=${sample.landedOnPage}` : ""
          ].join(" | "));
        }
      }
    }
  } finally {
    await context.close();
    server.close();
  }

  fs.writeFileSync(path.join(RESULTS_DIR, "results.json"), JSON.stringify(rows, null, 2));
  const tested = rows.filter(row => row.verdict !== "no-selection");
  const count = verdict => tested.filter(row => row.verdict === verdict).length;
  const links = tested.filter(row => row.highlightPixels !== undefined);
  console.log("\nsummary");
  console.log(`  selections tested: ${tested.length} (skipped ${rows.length - tested.length} drags that selected nothing)`);
  console.log(`  correct page: ${count("correct")}, ambiguous incl. true page: ${count("ambiguous-ok")}`);
  console.log(`  wrong: ${count("WRONG") + count("ambiguous-WRONG")}, not found: ${count("not-found")}, errors: ${count("error")}`);
  console.log(`  passage links on the right page: ${links.filter(r => r.landedOnPage).length}/${links.length}`);
  console.log(`  passage links highlighted (white background only): ${links.filter(r => r.highlightPixels > 0).length}/${links.length}`);
  process.exitCode = count("WRONG") + count("ambiguous-WRONG") > 0 ? 1 : 0;
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
