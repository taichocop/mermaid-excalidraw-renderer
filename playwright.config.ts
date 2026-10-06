import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "tests/browser",
  timeout: 90_000,
  workers: 1,
  use: {
    browserName: "chromium",
    channel: process.env.PLAYWRIGHT_CHANNEL || "chrome",
    viewport: { width: 1100, height: 900 },
    baseURL: "http://127.0.0.1:4173",
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  webServer: { command: "npm run test:browser:serve", url: "http://127.0.0.1:4173", reuseExistingServer: false },
});
