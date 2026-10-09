import { browserPort } from "./tests/browser/port.mjs";
import { defineConfig } from "@playwright/test";

const url = `http://127.0.0.1:${browserPort()}`;

export default defineConfig({
  testDir: "tests/browser",
  timeout: 90_000,
  workers: 1,
  use: {
    browserName: "chromium",
    channel: process.env.PLAYWRIGHT_CHANNEL || "chrome",
    viewport: { width: 1100, height: 900 },
    baseURL: url,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  webServer: { command: "npm run test:browser:serve", url, reuseExistingServer: false },
});
