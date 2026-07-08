import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 60_000,
  workers: 1,
  use: { trace: "retain-on-failure", screenshot: "only-on-failure" },
  webServer: {
    command: "python -m http.server 4173 --directory tests/fixtures",
    url: "http://127.0.0.1:4173",
    reuseExistingServer: true
  }
});
