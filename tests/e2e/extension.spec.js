import { test, expect, chromium } from "@playwright/test";
import path from "node:path";

test("loads a PDF at 100% and navigates complete sentences", async () => {
  const extensionPath = path.resolve(".");
  const context = await chromium.launchPersistentContext("", {
    channel: "chrome",
    headless: false,
    args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`]
  });
  try {
    let [worker] = context.serviceWorkers();
    if (!worker) worker = await context.waitForEvent("serviceworker");
    const extensionId = new URL(worker.url()).host;
    const page = await context.newPage();
    const pdf = encodeURIComponent("http://127.0.0.1:4173/sample.pdf");
    await page.goto(`chrome-extension://${extensionId}/viewer.html?file=${pdf}`);
    await expect(page.locator("#toolbar")).toBeVisible({ timeout: 30_000 });
    await expect(page.locator("#zoom-level")).toHaveText("100%");
    await page.keyboard.press("Tab");
    await expect(page.locator("#position")).toContainText("Sentence 1 of");
    expect(await page.evaluate(() => CSS.highlights.get("active-sentence")?.size)).toBeGreaterThan(0);
  } finally {
    await context.close();
  }
});
