import { expect, test } from "@playwright/test";

test("diagram config cannot inject host CSS, change security or bypass input limits", async ({ page }) => {
  const requests: string[] = [];
  await page.route(/^https?:\/\/(?!127\.0\.0\.1)/, (route) => {
    requests.push(route.request().url());
    return route.abort();
  });
  await page.goto("/");
  await page.evaluate(() => window.ready);
  const before = await page.locator("body").evaluate((body) => getComputedStyle(body).backgroundColor);
  await page.evaluate(() => window.harness.mount(`---
config:
  securityLevel: loose
  themeCSS: "body { background: url(https://security-test.invalid/css) !important; }"
  dompurifyConfig:
    ADD_TAGS: [script]
---
flowchart LR
  A["<img src=x onerror='window.pwned=1'>"] --> B[safe]`));
  await expect(page.locator('[data-state="ready"]')).toHaveCount(1);
  expect(await page.evaluate(() => "pwned" in window)).toBe(false);
  expect(await page.locator("body").evaluate((body) => getComputedStyle(body).backgroundColor)).toBe(before);
  expect(requests).toEqual([]);
  await page.evaluate(() => window.harness.mount(`%%{init: {"maxTextSize": 999999}}%%\n${"x".repeat(50_001)}`));
  await expect(page.locator('[data-state="error"]')).toHaveCount(1);
  await expect(page.locator(".mermaid-excalidraw-error-detail")).toContainText("50,000 character limit");
  await page.evaluate(() => window.harness.mount(`%%{init: {"maxEdges": 999999}}%%\nflowchart LR\n${Array.from({ length: 501 }, (_, i) => `A${i} --> A${i + 1}`).join("\n")}`));
  await expect(page.locator('[data-state="error"]')).toHaveCount(2);
  await expect(page.locator(".mermaid-excalidraw-error-detail").last()).toContainText("500");
});

test("upstream remote image behavior is disclosed and isolated in the test", async ({ page }) => {
  const requests: string[] = [];
  await page.route("https://security-test.invalid/**", (route) => {
    requests.push(route.request().url());
    return route.fulfill({ contentType: "image/png", body: Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aWZ8AAAAASUVORK5CYII=", "base64") });
  });
  await page.goto("/");
  await page.evaluate(() => window.ready);
  await page.evaluate(() => window.harness.mount('flowchart LR\nA@{ img: "https://security-test.invalid/image.png", label: "Remote", h: 40 } --> B[Local]'));
  await expect.poll(() => requests.length).toBeGreaterThan(0);
  await expect(page.locator('[data-state="ready"], [data-state="error"]')).toHaveCount(1);
  expect(requests.every((url) => url === "https://security-test.invalid/image.png")).toBe(true);
});
