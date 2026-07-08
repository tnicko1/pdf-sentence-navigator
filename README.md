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

## Install in Chrome

1. Download or clone this repository.
2. Run `npm install` and `npm run build` (the repository also includes the generated `vendor` files after building).
3. Open `chrome://extensions`.
4. Enable **Developer mode**.
5. Select **Load unpacked** and choose this repository folder.
6. For PDFs opened from your computer, open the extension's **Details** and enable **Allow access to file URLs**.

## Test the extension

1. Open a direct `https://…/document.pdf` URL in Chrome. The extension redirects it to its bundled PDF.js viewer. You can also click the extension toolbar icon while a direct PDF URL is open.
2. Wait until the status bar reports how many sentences were found.
3. Press **Tab** to highlight and move to the next sentence.
4. Press **Shift + Tab** to move back.

Use the floating toolbar's gear button to configure visuals, scrolling, accessibility, and keyboard shortcuts. Preferences remain local to Chrome.

Scanned/image-only PDFs need OCR and therefore show “No selectable text found”; this extension intentionally does not upload files for OCR.

## Development

```powershell
npm install
npm run build
npm test
```

`npm run build` copies the pinned PDF.js runtime and its local support assets into `vendor/`. Reload the extension on `chrome://extensions` after changing source files.

## Architecture

Chrome does not allow one extension to inject scripts into Chrome's built-in PDF Viewer extension. The service worker therefore detects direct PDF navigation and opens the same URL in an extension-owned viewer. PDF.js renders the pages and selectable text layer; `Intl.Segmenter` identifies sentence boundaries; the CSS Custom Highlight API marks the active sentence.
