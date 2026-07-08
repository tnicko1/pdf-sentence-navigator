const VIEWER_URL = chrome.runtime.getURL("viewer.html");

function isPdfUrl(url) {
  if (!url || url.startsWith(VIEWER_URL) || url.startsWith("chrome://")) return false;
  try {
    const parsed = new URL(url);
    return /\.pdf$/i.test(parsed.pathname) || parsed.searchParams.get("type") === "application/pdf";
  } catch {
    return false;
  }
}

function viewerUrl(pdfUrl) {
  return `${VIEWER_URL}?file=${encodeURIComponent(pdfUrl)}`;
}

chrome.webNavigation.onBeforeNavigate.addListener(({ tabId, frameId, url }) => {
  if (frameId === 0 && isPdfUrl(url)) {
    chrome.tabs.update(tabId, { url: viewerUrl(url) });
  }
});

chrome.action.onClicked.addListener((tab) => {
  if (tab.id && isPdfUrl(tab.url)) {
    chrome.tabs.update(tab.id, { url: viewerUrl(tab.url) });
  }
});
