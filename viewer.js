import { getDocument, GlobalWorkerOptions, TextLayer } from "./vendor/pdf.min.mjs";
import { buildTextMap, orderTextNodesByPosition, segmentSentences, rangesForSentence } from "./sentence-navigation.js";

GlobalWorkerOptions.workerSrc = chrome.runtime.getURL("vendor/pdf.worker.min.mjs");

const viewer = document.querySelector("#viewer");
const status = document.querySelector("#status");
const errorBox = document.querySelector("#error");
let entries = [];
let sentences = [];
let activeIndex = -1;

function showError(error) {
  viewer.hidden = true;
  errorBox.hidden = false;
  errorBox.textContent = `Could not open this PDF.\n\n${error?.message || error}\n\nFor local files, enable “Allow access to file URLs” for this extension in chrome://extensions.`;
  status.textContent = "Failed to load";
}

async function renderPage(pdf, pageNumber) {
  const page = await pdf.getPage(pageNumber);
  const baseViewport = page.getViewport({ scale: 1 });
  const available = Math.max(320, Math.min(window.innerWidth - 32, 1100));
  const scale = Math.min(1.6, available / baseViewport.width);
  const viewport = page.getViewport({ scale });
  const outputScale = Math.min(window.devicePixelRatio || 1, 2);
  const pageElement = document.createElement("section");
  pageElement.className = "page";
  pageElement.dataset.page = pageNumber;
  pageElement.style.width = `${viewport.width}px`;
  pageElement.style.height = `${viewport.height}px`;

  const canvas = document.createElement("canvas");
  canvas.width = Math.floor(viewport.width * outputScale);
  canvas.height = Math.floor(viewport.height * outputScale);
  canvas.style.width = `${viewport.width}px`;
  canvas.style.height = `${viewport.height}px`;
  pageElement.append(canvas);

  const textLayerElement = document.createElement("div");
  textLayerElement.className = "textLayer";
  pageElement.append(textLayerElement);
  viewer.append(pageElement);

  const renderTask = page.render({
    canvasContext: canvas.getContext("2d", { alpha: false }),
    viewport,
    transform: outputScale === 1 ? null : [outputScale, 0, 0, outputScale, 0, 0]
  });
  const textContent = await page.getTextContent();
  const textLayer = new TextLayer({ textContentSource: textContent, container: textLayerElement, viewport });
  await Promise.all([renderTask.promise, textLayer.render()]);
}

function collectSentences() {
  const records = [];
  for (const page of viewer.querySelectorAll(".page")) {
    const pageNumber = Number(page.dataset.page);
    const textLayer = page.querySelector(".textLayer");
    const walker = document.createTreeWalker(textLayer, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const node = walker.currentNode;
      const rect = node.parentElement.getBoundingClientRect();
      records.push({
        node,
        page: pageNumber,
        top: rect.top,
        left: rect.left,
        height: rect.height
      });
    }
  }
  const nodes = orderTextNodesByPosition(records);
  const map = buildTextMap(nodes);
  entries = map.entries;
  sentences = segmentSentences(map.text, document.documentElement.lang);
}

function activate(index) {
  if (!sentences.length) return;
  activeIndex = (index + sentences.length) % sentences.length;
  const ranges = rangesForSentence(sentences[activeIndex], entries);
  CSS.highlights.set("active-sentence", new Highlight(...ranges));
  const target = ranges[0]?.startContainer?.parentElement;
  target?.scrollIntoView({ behavior: "smooth", block: "center" });
  status.textContent = `Sentence ${activeIndex + 1} of ${sentences.length}`;
}

document.addEventListener("keydown", (event) => {
  if (event.key !== "Tab" || event.altKey || event.ctrlKey || event.metaKey || !sentences.length) return;
  event.preventDefault();
  activate(activeIndex + (event.shiftKey ? -1 : 1));
});

async function start() {
  const file = new URLSearchParams(location.search).get("file");
  if (!file) throw new Error("No PDF URL was provided.");
  const loadingTask = getDocument({ url: file, cMapUrl: chrome.runtime.getURL("vendor/cmaps/"), cMapPacked: true, standardFontDataUrl: chrome.runtime.getURL("vendor/standard_fonts/"), wasmUrl: chrome.runtime.getURL("vendor/wasm/") });
  const pdf = await loadingTask.promise;
  for (let page = 1; page <= pdf.numPages; page++) {
    status.textContent = `Rendering page ${page} of ${pdf.numPages}…`;
    await renderPage(pdf, page);
  }
  collectSentences();
  status.textContent = sentences.length ? `${sentences.length} sentences · press Tab to start` : "No selectable text found";
}

start().catch(showError);
