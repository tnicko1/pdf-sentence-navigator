import { getDocument, GlobalWorkerOptions, PasswordResponses, TextLayer } from "./vendor/pdf.min.mjs";
import { addBlockSeparators, buildTextMap, orderTextNodesByPosition, segmentSentences, rangesForSentence } from "./sentence-navigation.js";

GlobalWorkerOptions.workerSrc = chrome.runtime.getURL("vendor/pdf.worker.min.mjs");

const DEFAULTS = {
  highlightColor: "#ffd600",
  highlightOpacity: 60,
  nextKey: "Tab",
  previousKey: "Shift+Tab",
  smoothScroll: true,
  focusDefault: false,
  highContrast: false,
  reducedMotion: false,
  announceSentence: true
};

const $ = (selector) => document.querySelector(selector);
const viewer = $("#viewer");
const status = $("#status");
const position = $("#position");
const toolbar = $("#toolbar");
const errorBox = $("#error");
const emptyState = $("#empty-state");
const progress = $("#loading-progress");
const toast = $("#toast");
const liveRegion = $("#live-region");
const settingsDialog = $("#settings");
const passwordDialog = $("#password-dialog");

let entries = [];
let sentences = [];
let documentText = "";
let activeIndex = -1;
let zoom = 1;
let preferences = { ...DEFAULTS };
let currentLoadingTask;
let previousTimer;
let toastTimer;

function hexToRgbChannels(hex) {
  return `${parseInt(hex.slice(1, 3), 16)} ${parseInt(hex.slice(3, 5), 16)} ${parseInt(hex.slice(5, 7), 16)}`;
}

function applyPreferences() {
  document.documentElement.style.setProperty("--highlight-color", hexToRgbChannels(preferences.highlightColor));
  document.documentElement.style.setProperty("--highlight-opacity", preferences.highlightOpacity / 100);
  document.body.classList.toggle("high-contrast", preferences.highContrast);
  document.body.classList.toggle("reduce-motion", preferences.reducedMotion);
  document.body.classList.toggle("focus-mode", preferences.focusDefault);
  $("#focus-toggle").setAttribute("aria-pressed", String(preferences.focusDefault));
  $("#shortcut-help").innerHTML = `<kbd>${preferences.nextKey}</kbd> next · <kbd>${preferences.previousKey}</kbd> previous`;
}

async function loadPreferences() {
  preferences = { ...DEFAULTS, ...(await chrome.storage.local.get(DEFAULTS)) };
  applyPreferences();
}

function showToast(message) {
  clearTimeout(toastTimer);
  toast.textContent = message;
  toast.hidden = false;
  toastTimer = setTimeout(() => { toast.hidden = true; }, 1400);
}

function classifyError(error) {
  const message = error?.message || String(error);
  if (/password/i.test(message)) return "This PDF is password-protected and could not be unlocked.";
  if (/invalid|malformed|format/i.test(message)) return "This PDF appears malformed or uses unsupported data.";
  if (/missing|404|fetch|network|cors/i.test(message)) return "The PDF could not be downloaded. The server may block extension access.";
  return message;
}

function showError(error) {
  viewer.hidden = true;
  toolbar.hidden = true;
  progress.hidden = true;
  errorBox.hidden = false;
  errorBox.textContent = `Could not open this PDF.\n\n${classifyError(error)}\n\nFor local files, enable “Allow access to file URLs” for this extension in chrome://extensions.`;
  status.textContent = "Failed to load";
}

async function requestPassword(updatePassword, reason) {
  $("#pdf-password").value = "";
  passwordDialog.querySelector("p").textContent = reason === PasswordResponses.INCORRECT_PASSWORD
    ? "That password was incorrect. Try again. It stays in this browser tab."
    : "Enter the PDF password. It stays in this browser tab.";
  passwordDialog.showModal();
  passwordDialog.addEventListener("close", () => {
    if (passwordDialog.returnValue === "submit") updatePassword($("#pdf-password").value);
    else currentLoadingTask?.destroy();
  }, { once: true });
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
  pageElement.setAttribute("aria-label", `Page ${pageNumber}`);
  pageElement.style.width = `${viewport.width}px`;
  pageElement.style.height = `${viewport.height}px`;
  pageElement.style.setProperty("--scale-factor", viewport.scale);
  pageElement.style.setProperty("--user-unit", page.userUnit);
  pageElement.style.setProperty("--total-scale-factor", "calc(var(--scale-factor) * var(--user-unit))");

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
    const walker = document.createTreeWalker(page.querySelector(".textLayer"), NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const node = walker.currentNode;
      const rect = node.parentElement.getBoundingClientRect();
      records.push({ node, page: pageNumber, top: rect.top, left: rect.left, height: rect.height });
    }
  }
  const nodes = orderTextNodesByPosition(records);
  const recordByNode = new Map(records.map((record) => [record.node, record]));
  const map = buildTextMap(addBlockSeparators(nodes, recordByNode));
  entries = map.entries;
  documentText = map.text;
  sentences = segmentSentences(map.text, document.documentElement.lang);
}

function textForSentence(index) {
  const sentence = sentences[index];
  return sentence ? documentText.slice(sentence.start, sentence.end).replace(/\s+/g, " ").trim() : "";
}

function pageForSentence(index) {
  const ranges = rangesForSentence(sentences[index], entries);
  return Number(ranges[0]?.startContainer?.parentElement?.closest(".page")?.dataset.page || 1);
}

function activate(index, { scroll = true } = {}) {
  if (!sentences.length) return;
  const oldRanges = activeIndex >= 0 ? rangesForSentence(sentences[activeIndex], entries) : [];
  const requested = index;
  activeIndex = (index + sentences.length) % sentences.length;
  const ranges = rangesForSentence(sentences[activeIndex], entries);

  clearTimeout(previousTimer);
  if (oldRanges.length) {
    CSS.highlights.set("previous-sentence", new Highlight(...oldRanges));
    previousTimer = setTimeout(() => CSS.highlights.delete("previous-sentence"), 550);
  }
  CSS.highlights.set("active-sentence", new Highlight(...ranges));
  document.querySelectorAll(".page.active-page").forEach((page) => page.classList.remove("active-page"));
  for (const range of ranges) range.startContainer.parentElement?.closest(".page")?.classList.add("active-page");

  if (scroll) ranges[0]?.startContainer?.parentElement?.scrollIntoView({
    behavior: preferences.smoothScroll && !preferences.reducedMotion ? "smooth" : "auto",
    block: "center"
  });
  const page = pageForSentence(activeIndex);
  position.textContent = `Sentence ${activeIndex + 1} of ${sentences.length}`;
  status.textContent = `Page ${page} · Sentence ${activeIndex + 1} of ${sentences.length}`;
  if (preferences.announceSentence) {
    liveRegion.textContent = `Page ${page}, sentence ${activeIndex + 1} of ${sentences.length}: ${textForSentence(activeIndex)}`;
  }
  if (requested >= sentences.length) showToast("Wrapped to the first sentence");
  if (requested < 0) showToast("Wrapped to the last sentence");
}

function jumpPage(direction) {
  if (!sentences.length) return;
  const currentPage = activeIndex < 0 ? 1 : pageForSentence(activeIndex);
  const targetPage = Math.max(1, currentPage + direction);
  const index = sentences.findIndex((_, candidate) => pageForSentence(candidate) >= targetPage);
  activate(index < 0 ? sentences.length - 1 : index);
}

function eventShortcut(event) {
  return `${event.shiftKey ? "Shift+" : ""}${event.key}`;
}

document.addEventListener("keydown", (event) => {
  if (!sentences.length || event.altKey || event.ctrlKey || event.metaKey || event.target.closest("input, select, button, dialog")) return;
  const shortcut = eventShortcut(event);
  if (shortcut === preferences.nextKey || shortcut === preferences.previousKey) {
    event.preventDefault();
    activate(activeIndex + (shortcut === preferences.previousKey ? -1 : 1));
  } else if (event.key === "Home") {
    event.preventDefault(); activate(0);
  } else if (event.key === "End") {
    event.preventDefault(); activate(sentences.length - 1);
  } else if (event.key === "PageDown" || event.key === "PageUp") {
    event.preventDefault(); jumpPage(event.key === "PageDown" ? 1 : -1);
  }
});

viewer.addEventListener("click", (event) => {
  if (!event.target.closest(".textLayer")) return;
  const caret = document.caretPositionFromPoint?.(event.clientX, event.clientY);
  const fallback = document.caretRangeFromPoint?.(event.clientX, event.clientY);
  const node = caret?.offsetNode || fallback?.startContainer;
  const offset = caret?.offset ?? fallback?.startOffset ?? 0;
  const entry = entries.find((candidate) => candidate.node === node);
  if (!entry) return;
  const documentOffset = entry.start + offset;
  const index = sentences.findIndex((sentence) => documentOffset >= sentence.start && documentOffset <= sentence.end);
  if (index >= 0) activate(index, { scroll: false });
});

$("#previous").addEventListener("click", () => activate(activeIndex - 1));
$("#next").addEventListener("click", () => activate(activeIndex + 1));
$("#first").addEventListener("click", () => activate(0));
$("#last").addEventListener("click", () => activate(sentences.length - 1));

function setZoom(value) {
  zoom = Math.max(.6, Math.min(2, Math.round(value * 10) / 10));
  document.documentElement.style.setProperty("--viewer-zoom", zoom);
  $("#zoom-level").textContent = `${Math.round(zoom * 100)}%`;
}
$("#zoom-out").addEventListener("click", () => setZoom(zoom - .1));
$("#zoom-in").addEventListener("click", () => setZoom(zoom + .1));

$("#focus-toggle").addEventListener("click", (event) => {
  const enabled = !document.body.classList.contains("focus-mode");
  document.body.classList.toggle("focus-mode", enabled);
  event.currentTarget.setAttribute("aria-pressed", String(enabled));
});

$("#speak").addEventListener("click", () => {
  if (activeIndex < 0) activate(0);
  speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(textForSentence(activeIndex));
  utterance.lang = document.documentElement.lang || navigator.language;
  speechSynthesis.speak(utterance);
});

const preferenceFields = {
  highlightColor: "#highlight-color", highlightOpacity: "#highlight-opacity", nextKey: "#next-key",
  previousKey: "#previous-key", smoothScroll: "#smooth-scroll", focusDefault: "#focus-default",
  highContrast: "#high-contrast", reducedMotion: "#reduced-motion", announceSentence: "#announce-sentence"
};

function populateSettings() {
  for (const [key, selector] of Object.entries(preferenceFields)) {
    const field = $(selector);
    if (field.type === "checkbox") field.checked = preferences[key];
    else field.value = preferences[key];
  }
}

$("#settings-open").addEventListener("click", () => { populateSettings(); settingsDialog.showModal(); });
$("#settings-reset").addEventListener("click", () => { preferences = { ...DEFAULTS }; populateSettings(); });
settingsDialog.addEventListener("close", async () => {
  if (settingsDialog.returnValue !== "save") return;
  for (const [key, selector] of Object.entries(preferenceFields)) {
    const field = $(selector);
    preferences[key] = field.type === "checkbox" ? field.checked : field.type === "range" ? Number(field.value) : field.value;
  }
  await chrome.storage.local.set(preferences);
  applyPreferences();
  showToast("Preferences saved");
});

async function start() {
  await loadPreferences();
  const file = new URLSearchParams(location.search).get("file");
  if (!file) throw new Error("No PDF URL was provided.");
  const loadingTask = currentLoadingTask = getDocument({
    url: file,
    cMapUrl: chrome.runtime.getURL("vendor/cmaps/"),
    cMapPacked: true,
    standardFontDataUrl: chrome.runtime.getURL("vendor/standard_fonts/"),
    wasmUrl: chrome.runtime.getURL("vendor/wasm/")
  });
  loadingTask.onPassword = requestPassword;
  loadingTask.onProgress = ({ loaded, total }) => {
    if (total) { progress.max = total; progress.value = loaded; }
  };
  const pdf = await loadingTask.promise;
  progress.max = pdf.numPages;
  for (let page = 1; page <= pdf.numPages; page++) {
    status.textContent = `Rendering page ${page} of ${pdf.numPages}…`;
    progress.value = page;
    await renderPage(pdf, page);
  }
  collectSentences();
  progress.hidden = true;
  if (!sentences.length) {
    status.textContent = "No selectable text found";
    emptyState.hidden = false;
    return;
  }
  toolbar.hidden = false;
  position.textContent = `0 of ${sentences.length} sentences`;
  status.textContent = `${pdf.numPages} pages · ${sentences.length} sentences · press ${preferences.nextKey} to start`;
}

start().catch(showError);
