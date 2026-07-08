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
    const page = await context.newPage();
    await page.goto("http://127.0.0.1:4173/sample.pdf");
    await expect(page.locator("#toolbar")).toBeVisible({ timeout: 30_000 });
    await expect(page.locator("#zoom-level")).toHaveText("100%");
    await page.keyboard.press("Tab");
    await expect(page.locator("#position")).toContainText("Sentence 1 of");
    expect(await page.evaluate(() => CSS.highlights.get("active-sentence")?.size)).toBeGreaterThan(0);
  } finally {
    await context.close();
  }
});
