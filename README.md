# PDF Sentence Navigator

A Chrome Manifest V3 extension for keyboard navigation between sentences in PDF documents.

- **Tab** moves to the next sentence.
- **Shift + Tab** moves to the previous sentence.
- The active sentence is highlighted in the document.
- All PDF parsing and sentence segmentation happen locally in Chrome. No document text is sent to an external service.

## Reader features

- Floating controls for first, previous, next, and last sentence
- Sentence and page progress
- Zoom controls and optional focus mode
- Configurable highlight color and opacity
- Click any rendered sentence to activate it
- Customizable next/previous keyboard shortcuts
- `Home` / `End` for the first/last sentence
- `Page Up` / `Page Down` for page-level navigation
- High-contrast and reduced-motion preferences
- Screen-reader position announcements
- Browser text-to-speech for the active sentence
- Preferences persisted locally with `chrome.storage`

Version 2 also includes per-document resume state, bookmarks with notes, local export, document search, reading statistics, auto-advance, pause/resume speech with voice and speed controls, page thumbnails, PDF outlines and links, a command palette, dark/sepia page modes, fit and two-page layouts, touch gestures, RTL/vertical text ordering, lazy canvas/thumbnail rendering, and optional bundled English OCR for scanned PDFs.

OCR runs entirely inside the extension using bundled Tesseract WebAssembly and language data. It can be CPU-intensive on long scanned documents.

## Install in Chrome

1. Download or clone this repository.
2. Open `chrome://extensions`.
3. Enable **Developer mode**.
4. Select **Load unpacked** and choose the cloned repository folder—the folder containing `manifest.json`.
5. For PDFs opened from your computer, open the extension's **Details** and enable **Allow access to file URLs**.

No installation command or build step is required for normal use. The repository already contains the generated `vendor/` directory with PDF.js, fonts, WebAssembly modules, and the optional local OCR runtime.

## Test the extension

1. Open a direct `https://…/document.pdf` URL in Chrome. The extension redirects it to its bundled PDF.js viewer. You can also click the extension toolbar icon while a direct PDF URL is open.
2. Wait until the status bar reports how many sentences were found.
3. Press **Tab** to highlight and move to the next sentence.
4. Press **Shift + Tab** to move back.

Use the floating toolbar's gear button to configure visuals, scrolling, accessibility, and keyboard shortcuts. Preferences remain local to Chrome.

For scanned/image-only PDFs, select **Run local English OCR** from the empty-document screen. OCR is performed inside the extension and can take time on large documents.

## Development

```powershell
npm install
npm run build
npm test
npm run test:e2e
```

These commands are for contributors only:

- `npm install` installs development dependencies.
- `npm run build` refreshes the committed PDF.js and Tesseract assets in `vendor/`.
- `npm test` runs unit tests.
- `npm run test:e2e` loads the unpacked extension in Chrome and tests it with a real PDF fixture.

Reload the extension on `chrome://extensions` after changing source files.

## Architecture

Chrome does not allow one extension to inject scripts into Chrome's built-in PDF Viewer extension. The service worker therefore detects direct PDF navigation and opens the same URL in an extension-owned viewer. PDF.js renders the pages and selectable text layer; `Intl.Segmenter` identifies sentence boundaries; the CSS Custom Highlight API marks the active sentence.
