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
  announceSentence: true,
  highlightStyle: "background",
  pageTheme: "normal",
  pageLayout: "single",
  fitMode: "width",
  speechRate: 1,
  speechVoice: "",
  autoDelay: 5
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
let pdfDocument;
let documentKey = "";
let documentState = { lastSentence: 0, bookmarks: [], visited: [] };
let sessionStarted = Date.now();
let autoTimer;
let searchResults = [];
let searchCursor = -1;
const canvasJobs = new WeakMap();
const lazyCanvasObserver = new IntersectionObserver((observations) => {
  for (const observation of observations) if (observation.isIntersecting) {
    ensureCanvasRendered(observation.target);
    lazyCanvasObserver.unobserve(observation.target);
  }
}, { rootMargin: "900px" });
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
  document.body.classList.toggle("two-page", preferences.pageLayout === "two");
  document.body.classList.toggle("page-dark", preferences.pageTheme === "dark");
  document.body.classList.toggle("page-sepia", preferences.pageTheme === "sepia");
  document.body.classList.remove("highlight-underline", "highlight-outline", "highlight-ruler");
  if (preferences.highlightStyle !== "background") document.body.classList.add(`highlight-${preferences.highlightStyle}`);
  $("#focus-toggle").setAttribute("aria-pressed", String(preferences.focusDefault));
  $("#shortcut-help").innerHTML = `<kbd>${preferences.nextKey}</kbd> next · <kbd>${preferences.previousKey}</kbd> previous`;
}

async function loadPreferences() {
  preferences = { ...DEFAULTS, ...(await chrome.storage.local.get(DEFAULTS)) };
  applyPreferences();
}

async function loadDocumentState() {
  documentState = { lastSentence: 0, bookmarks: [], visited: [], ...(await chrome.storage.local.get(documentKey))[documentKey] };
  preferences = { ...preferences, ...(documentState.settings || {}) };
  applyPreferences();
}

function saveDocumentState() {
  chrome.storage.local.set({ [documentKey]: documentState });
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

  canvasJobs.set(canvas, () => page.render({
    canvasContext: canvas.getContext("2d", { alpha: false }), viewport,
    transform: outputScale === 1 ? null : [outputScale, 0, 0, outputScale, 0, 0]
  }).promise);
  lazyCanvasObserver.observe(canvas);
  const textContent = await page.getTextContent();
  const textLayer = new TextLayer({ textContentSource: textContent, container: textLayerElement, viewport });
  await textLayer.render();
  await addLinks(page, viewport, pageElement, pdf);
}

async function ensureCanvasRendered(canvas) {
  const job = canvasJobs.get(canvas);
  if (!job) return;
  canvasJobs.delete(canvas);
  await job();
}

async function addLinks(page, viewport, pageElement, pdf) {
  const annotations = await page.getAnnotations();
  const links = annotations.filter((item) => item.subtype === "Link" && (item.url || item.dest));
  if (!links.length) return;
  const layer = document.createElement("div"); layer.className = "linkLayer"; pageElement.append(layer);
  for (const link of links) {
    const [x1, y1, x2, y2] = viewport.convertToViewportRectangle(link.rect);
    const anchor = document.createElement("a");
    Object.assign(anchor.style, { left: `${Math.min(x1,x2)}px`, top: `${Math.min(y1,y2)}px`, width: `${Math.abs(x2-x1)}px`, height: `${Math.abs(y2-y1)}px` });
    anchor.title = link.url || "Go to PDF destination";
    if (link.url) { anchor.href = link.url; anchor.target = "_blank"; anchor.rel = "noreferrer"; }
    else anchor.addEventListener("click", async (event) => { event.preventDefault(); const dest = typeof link.dest === "string" ? await pdf.getDestination(link.dest) : link.dest; const pageIndex = await pdf.getPageIndex(dest[0]); viewer.querySelector(`[data-page="${pageIndex + 1}"]`)?.scrollIntoView({ behavior: "smooth" }); });
    layer.append(anchor);
  }
}

function collectSentences() {
  const records = [];
  for (const page of viewer.querySelectorAll(".page")) {
    const pageNumber = Number(page.dataset.page);
    const walker = document.createTreeWalker(page.querySelector(".textLayer"), NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const node = walker.currentNode;
      const rect = node.parentElement.getBoundingClientRect();
      records.push({ node, page: pageNumber, top: rect.top, left: rect.left, width: rect.width, height: rect.height, direction: node.parentElement.dir || "ltr" });
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
  documentState.lastSentence = activeIndex;
  documentState.visited = [...new Set([...(documentState.visited || []), activeIndex])];
  saveDocumentState();
  updateStats();
  position.textContent = `Sentence ${activeIndex + 1} of ${sentences.length}`;
  status.textContent = `Page ${page} · Sentence ${activeIndex + 1} of ${sentences.length}`;
  if (preferences.announceSentence) {
    liveRegion.textContent = `Page ${page}, sentence ${activeIndex + 1} of ${sentences.length}: ${textForSentence(activeIndex)}`;
  }
  if (requested >= sentences.length) showToast("Wrapped to the first sentence");
  if (requested < 0) showToast("Wrapped to the last sentence");
}

function updateStats() {
  const minutes = Math.max(1, Math.round((Date.now() - sessionStarted) / 60000));
  $("#reading-time").textContent = `${minutes} min`;
  $("#sentences-visited").textContent = documentState.visited?.length || 0;
  const rate = Math.max(1, (documentState.visited?.length || 1) / minutes);
  $("#time-remaining").textContent = `${Math.ceil((sentences.length - Math.max(0, activeIndex)) / rate)} min`;
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
function applyFitMode() {
  const page = viewer.querySelector(".page"); if (!page) return;
  if (preferences.fitMode === "actual") return setZoom(1);
  const widthScale = (window.innerWidth - 40) / page.offsetWidth;
  const pageScale = Math.min(widthScale, (window.innerHeight - 130) / page.offsetHeight);
  setZoom(preferences.fitMode === "page" ? pageScale : widthScale);
}
$("#zoom-out").addEventListener("click", () => setZoom(zoom - .1));
$("#zoom-in").addEventListener("click", () => setZoom(zoom + .1));

$("#focus-toggle").addEventListener("click", (event) => {
  const enabled = !document.body.classList.contains("focus-mode");
  document.body.classList.toggle("focus-mode", enabled);
  event.currentTarget.setAttribute("aria-pressed", String(enabled));
});

$("#speak").addEventListener("click", () => {
  if (speechSynthesis.speaking) {
    if (speechSynthesis.paused) { speechSynthesis.resume(); showToast("Speech resumed"); }
    else { speechSynthesis.pause(); showToast("Speech paused"); }
    return;
  }
  if (activeIndex < 0) activate(0);
  speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(textForSentence(activeIndex));
  utterance.lang = document.documentElement.lang || navigator.language;
  utterance.rate = preferences.speechRate;
  utterance.voice = speechSynthesis.getVoices().find((voice) => voice.name === preferences.speechVoice) || null;
  utterance.onend = () => { if ($("#auto-advance").getAttribute("aria-pressed") === "true") activate(activeIndex + 1); };
  speechSynthesis.speak(utterance);
});

function toggleAutoAdvance() {
  const button = $("#auto-advance");
  const enabled = button.getAttribute("aria-pressed") !== "true";
  button.setAttribute("aria-pressed", String(enabled));
  clearInterval(autoTimer);
  if (enabled) autoTimer = setInterval(() => activate(activeIndex + 1), preferences.autoDelay * 1000);
  showToast(enabled ? "Auto-advance started" : "Auto-advance stopped");
}
$("#auto-advance").addEventListener("click", toggleAutoAdvance);

function renderBookmarks() {
  const panel = $("#bookmarks-panel"); panel.replaceChildren();
  const exportButton = document.createElement("button"); exportButton.textContent = "Export bookmarks and notes"; exportButton.addEventListener("click", exportBookmarks); panel.append(exportButton);
  for (const bookmark of documentState.bookmarks || []) {
    const row = document.createElement("div");
    const go = document.createElement("button"); go.textContent = `${bookmark.index + 1}. ${bookmark.text.slice(0, 80)}`; go.addEventListener("click", () => activate(bookmark.index));
    const note = document.createElement("textarea"); note.placeholder = "Add a note…"; note.value = bookmark.note || ""; note.addEventListener("change", () => { bookmark.note = note.value; saveDocumentState(); });
    const remove = document.createElement("button"); remove.textContent = "Remove"; remove.addEventListener("click", () => { documentState.bookmarks = documentState.bookmarks.filter((item) => item.index !== bookmark.index); saveDocumentState(); renderBookmarks(); });
    row.append(go, note, remove); panel.append(row);
  }
}

function downloadJson(data, filename) { const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }); const link = document.createElement("a"); link.href = URL.createObjectURL(blob); link.download = filename; link.click(); URL.revokeObjectURL(link.href); }
function exportBookmarks() { downloadJson({ document: documentKey, bookmarks: documentState.bookmarks }, "pdf-sentence-bookmarks.json"); }

$("#bookmark").addEventListener("click", () => {
  if (activeIndex < 0) return;
  const existing = documentState.bookmarks.find((item) => item.index === activeIndex);
  if (existing) documentState.bookmarks = documentState.bookmarks.filter((item) => item !== existing);
  else documentState.bookmarks.push({ index: activeIndex, text: textForSentence(activeIndex), note: "" });
  saveDocumentState(); renderBookmarks(); showToast(existing ? "Bookmark removed" : "Sentence bookmarked");
});

function performSearch() {
  const query = $("#search-input").value.trim().toLocaleLowerCase();
  searchResults = query ? sentences.map((_, index) => index).filter((index) => textForSentence(index).toLocaleLowerCase().includes(query)) : [];
  searchCursor = searchResults.length ? 0 : -1;
  $("#search-count").textContent = `${searchResults.length} result${searchResults.length === 1 ? "" : "s"}`;
  if (searchCursor >= 0) activate(searchResults[searchCursor]);
}
function stepSearch(direction) { if (!searchResults.length) return; searchCursor = (searchCursor + direction + searchResults.length) % searchResults.length; $("#search-count").textContent = `${searchCursor + 1} of ${searchResults.length}`; activate(searchResults[searchCursor]); }
$("#search-open").addEventListener("click", () => { $("#search-bar").hidden = false; $("#search-input").focus(); });
$("#search-close").addEventListener("click", () => { $("#search-bar").hidden = true; });
$("#search-input").addEventListener("input", performSearch);
$("#search-next").addEventListener("click", () => stepSearch(1)); $("#search-previous").addEventListener("click", () => stepSearch(-1));

$("#sidebar-open").addEventListener("click", () => { $("#sidebar").hidden = false; }); $("#sidebar-close").addEventListener("click", () => { $("#sidebar").hidden = true; });
document.querySelectorAll("#sidebar [data-panel]").forEach((button) => button.addEventListener("click", () => { document.querySelectorAll("#sidebar > section").forEach((panel) => { panel.hidden = panel.id !== button.dataset.panel; }); }));

async function renderOutline(pdf) {
  const outline = await pdf.getOutline(); const panel = $("#outline-panel"); panel.replaceChildren();
  for (const item of outline || []) { const button = document.createElement("button"); button.textContent = item.title; button.addEventListener("click", async () => { const dest = typeof item.dest === "string" ? await pdf.getDestination(item.dest) : item.dest; if (!dest) return; const pageIndex = await pdf.getPageIndex(dest[0]); viewer.querySelector(`[data-page="${pageIndex + 1}"]`)?.scrollIntoView({ behavior: "smooth" }); }); panel.append(button); }
  if (!outline?.length) panel.textContent = "No document outline.";
}

function renderThumbnails(pdf) {
  const panel = $("#pages-panel"); panel.replaceChildren();
  const jobs = new WeakMap();
  const observer = new IntersectionObserver((items) => { for (const item of items) if (item.isIntersecting) { const job = jobs.get(item.target); jobs.delete(item.target); observer.unobserve(item.target); job?.(); } }, { root: panel, rootMargin: "300px" });
  for (let number = 1; number <= pdf.numPages; number++) {
    const button = document.createElement("button"); const canvas = document.createElement("canvas"); const label = document.createElement("span"); label.textContent = `Page ${number}`; button.append(canvas, label); panel.append(button);
    button.addEventListener("click", () => viewer.querySelector(`[data-page="${number}"]`)?.scrollIntoView({ behavior: "smooth" }));
    jobs.set(canvas, async () => { const page = await pdf.getPage(number); const viewport = page.getViewport({ scale: .22 }); canvas.width = viewport.width; canvas.height = viewport.height; await page.render({ canvasContext: canvas.getContext("2d"), viewport }).promise; }); observer.observe(canvas);
  }
}

const commands = [
  ["Next sentence", () => activate(activeIndex + 1)], ["Previous sentence", () => activate(activeIndex - 1)], ["First sentence", () => activate(0)], ["Last sentence", () => activate(sentences.length - 1)],
  ["Bookmark sentence", () => $("#bookmark").click()], ["Search document", () => $("#search-open").click()], ["Toggle focus mode", () => $("#focus-toggle").click()], ["Toggle auto-advance", toggleAutoAdvance],
  ["Speak sentence", () => $("#speak").click()], ["Enter fullscreen", () => document.documentElement.requestFullscreen()], ["Two-page layout", () => document.body.classList.toggle("two-page")]
  ,["Export bookmarks", exportBookmarks]
];
function renderCommands(query = "") { const list = $("#command-list"); list.replaceChildren(); for (const [name, action] of commands.filter(([name]) => name.toLowerCase().includes(query.toLowerCase()))) { const button = document.createElement("button"); button.type = "button"; button.textContent = name; button.addEventListener("click", () => { $("#command-dialog").close(); action(); }); list.append(button); } }
$("#command-open").addEventListener("click", () => { renderCommands(); $("#command-dialog").showModal(); $("#command-query").focus(); }); $("#command-query").addEventListener("input", (event) => renderCommands(event.target.value));

let touchStartX = 0; viewer.addEventListener("touchstart", (event) => { touchStartX = event.changedTouches[0].clientX; }, { passive: true }); viewer.addEventListener("touchend", (event) => { const delta = event.changedTouches[0].clientX - touchStartX; if (Math.abs(delta) > 70) activate(activeIndex + (delta < 0 ? 1 : -1)); }, { passive: true });

const preferenceFields = {
  highlightColor: "#highlight-color", highlightOpacity: "#highlight-opacity", nextKey: "#next-key",
  previousKey: "#previous-key", smoothScroll: "#smooth-scroll", focusDefault: "#focus-default",
  highContrast: "#high-contrast", reducedMotion: "#reduced-motion", announceSentence: "#announce-sentence",
  highlightStyle: "#highlight-style", pageTheme: "#page-theme", pageLayout: "#page-layout", fitMode: "#fit-mode",
  speechRate: "#speech-rate", autoDelay: "#auto-delay"
  ,speechVoice: "#speech-voice"
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
  documentState.settings = { highlightStyle: preferences.highlightStyle, pageTheme: preferences.pageTheme, pageLayout: preferences.pageLayout, fitMode: preferences.fitMode, highlightColor: preferences.highlightColor, highlightOpacity: preferences.highlightOpacity };
  saveDocumentState();
  applyPreferences();
  applyFitMode();
  showToast("Preferences saved");
});

$("#preferences-export").addEventListener("click", () => {
  downloadJson(preferences, "pdf-sentence-navigator-preferences.json");
});
$("#preferences-import").addEventListener("click", () => $("#preferences-file").click());
$("#preferences-file").addEventListener("change", async (event) => {
  try { preferences = { ...DEFAULTS, ...JSON.parse(await event.target.files[0].text()) }; await chrome.storage.local.set(preferences); populateSettings(); applyPreferences(); showToast("Preferences imported"); }
  catch { showToast("Invalid preferences file"); }
});

async function runOcr() {
  emptyState.hidden = true; status.textContent = "Loading local OCR engine…";
  const { createWorker } = await import("./vendor/ocr/tesseract.esm.min.js");
  const worker = await createWorker("eng", 1, {
    workerPath: chrome.runtime.getURL("vendor/ocr/worker.min.js"), corePath: chrome.runtime.getURL("vendor/ocr/tesseract-core-simd-lstm.wasm.js"),
    langPath: chrome.runtime.getURL("vendor/ocr/"), workerBlobURL: false,
    logger: ({ status: stage, progress: amount }) => { status.textContent = `${stage} ${Math.round((amount || 0) * 100)}%`; }
  });
  for (const page of viewer.querySelectorAll(".page")) {
    const canvas = page.querySelector("canvas"); await ensureCanvasRendered(canvas);
    const result = await worker.recognize(canvas, {}, { blocks: true });
    const layer = page.querySelector(".textLayer");
    for (const block of result.data.blocks || []) for (const paragraph of block.paragraphs || []) for (const line of paragraph.lines || []) for (const word of line.words || []) {
      const span = document.createElement("span"); span.textContent = word.text; const { x0, y0, x1, y1 } = word.bbox;
      Object.assign(span.style, { left: `${x0 / canvas.width * 100}%`, top: `${y0 / canvas.height * 100}%`, width: `${(x1-x0) / canvas.width * 100}%`, height: `${(y1-y0) / canvas.height * 100}%`, fontSize: `${Math.max(8, (y1-y0) / canvas.height * page.clientHeight)}px` }); layer.append(span);
    }
  }
  await worker.terminate(); collectSentences(); toolbar.hidden = !sentences.length; status.textContent = `${sentences.length} OCR sentences`; if (sentences.length) activate(0);
}
$("#run-ocr").addEventListener("click", () => runOcr().catch(showError));

function populateVoices() {
  const select = $("#speech-voice"); const current = select.value; select.replaceChildren(new Option("Browser default", ""));
  for (const voice of speechSynthesis.getVoices()) select.add(new Option(`${voice.name} (${voice.lang})`, voice.name));
  select.value = current || preferences.speechVoice;
}
speechSynthesis.addEventListener("voiceschanged", populateVoices); populateVoices();
window.addEventListener("resize", () => { if (preferences.fitMode !== "actual") applyFitMode(); });

async function start() {
  await loadPreferences();
  const file = new URLSearchParams(location.search).get("file");
  if (!file) throw new Error("No PDF URL was provided.");
  documentKey = `document:${file}`;
  await loadDocumentState();
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
  const pdf = pdfDocument = await loadingTask.promise;
  progress.max = pdf.numPages;
  for (let page = 1; page <= pdf.numPages; page++) {
    status.textContent = `Rendering page ${page} of ${pdf.numPages}…`;
    progress.value = page;
    await renderPage(pdf, page);
  }
  collectSentences();
  await renderOutline(pdf);
  renderThumbnails(pdf);
  renderBookmarks();
  progress.hidden = true;
  if (!sentences.length) {
    status.textContent = "No selectable text found";
    emptyState.hidden = false;
    return;
  }
  toolbar.hidden = false;
  position.textContent = `0 of ${sentences.length} sentences`;
  status.textContent = `${pdf.numPages} pages · ${sentences.length} sentences · press ${preferences.nextKey} to start`;
  applyFitMode();
  if (documentState.lastSentence > 0 && documentState.lastSentence < sentences.length) {
    activate(documentState.lastSentence);
    showToast(`Resumed at sentence ${documentState.lastSentence + 1}`);
  }
}

start().catch(showError);
