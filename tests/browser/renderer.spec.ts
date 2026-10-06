import { expect, test } from "@playwright/test";
import { samples } from "./samples";

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => window.ready);
});

declare global { interface Window { ready: Promise<void> } }

test("loads the bundled CJS plugin and renders native and SVG fallback types offline", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if ((message.type() === "error" && !message.text().startsWith("Error processing Mermaid diagram:"))
      || /warning/i.test(message.text())) errors.push(message.text());
  });
  await page.route(/^https?:\/\/(?!127\.0\.0\.1)/, (route) => route.abort());
  expect(await page.evaluate(() => window.harness.registeredLanguages())).toEqual(["mermaid-excalidraw"]);
  await page.evaluate(() => window.harness.mountSamples(["flowchart", "sequence", "class", "er", "state", "gantt", "pie", "timeline"]));
  await expect(page.locator('[data-state="ready"]')).toHaveCount(8);
  await expect(page.locator(".mermaid-excalidraw-container .excalidraw" )).toHaveCount(8);
  await expect(page.locator(".mermaid-excalidraw-error")).toHaveCount(0);
  await expect(page.locator('[id^="mermaid-to-excalidraw-"]')).toHaveCount(0);
  expect(errors).toEqual([]);
  expect(await page.evaluate(() => window.harness.sceneSummaries())).toEqual([
    ...Array.from({ length: 2 }, () => ({ count: expect.any(Number), imageFallback: false })),
    ...Array.from({ length: 6 }, () => ({ count: 1, imageFallback: true })),
  ]);
  await page.locator("main").screenshot({ path: "test-results/diagrams-light.png" });
  await page.evaluate(() => window.harness.theme(true));
  await expect(page.locator(".excalidraw.theme--dark")).toHaveCount(8);
  await page.locator("main").screenshot({ path: "test-results/diagrams-dark.png" });
  expect(errors).toEqual([]);
});

test("invalid syntax stays inline and displays untrusted error strings as text", async ({ page }) => {
  await page.evaluate(() => window.harness.mountSamples(["invalid", "flowchart"]));
  await expect(page.locator(".mermaid-excalidraw-error")).toContainText("Mermaid diagram could not be rendered.");
  await expect(page.locator(".mermaid-excalidraw-error-detail")).toContainText("Parse error");
  await expect(page.locator('[data-state="ready"]')).toHaveCount(1);
  await expect(page.locator('[id^="mermaid-to-excalidraw-"]')).toHaveCount(0);
  await page.evaluate(() => window.harness.mount('flowchart TD\nA --> <img src=x onerror="window.pwned=1">'));
  await expect(page.locator('[data-state="error"]')).toHaveCount(2);
  expect(await page.evaluate(() => "pwned" in window)).toBe(false);
  await expect(page.locator(".mermaid-excalidraw-error img")).toHaveCount(0);
  await page.evaluate(() => window.harness.mount(`%%{init: {"securityLevel":"loose"}}%%
flowchart TD
A["<img src=x onerror='window.pwned=1'>"] --> B[safe]`));
  await expect(page.locator('[data-state="ready"]')).toHaveCount(2);
  expect(await page.evaluate(() => "pwned" in window)).toBe(false);
});

test("20 concurrent diagrams have no errors, survive rerendering and clean up after unload", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if ((message.type() === "error" && !message.text().startsWith("Error processing Mermaid diagram:"))
      || /warning/i.test(message.text())) errors.push(message.text());
  });
  await page.evaluate((source) => {
    for (let i = 0; i < 20; i++) window.harness.mount(source);
  }, samples.flowchart);
  await expect(page.locator('[data-state="ready"]')).toHaveCount(20);
  await expect(page.locator(".mermaid-excalidraw-container .excalidraw")).toHaveCount(20);
  expect(await page.evaluate(() => window.harness.sceneSummaries().every((scene) => scene !== null && !scene.imageFallback && scene.count > 0))).toBe(true);
  const ids = await page.locator("[id]").evaluateAll((elements) => elements.map((element) => element.id));
  expect(new Set(ids).size).toBe(ids.length);
  await page.evaluate(() => window.harness.clear());
  await expect(page.locator("canvas")).toHaveCount(0);
  await page.evaluate(() => { window.harness.mountSamples(["sequence", "er"]); });
  await expect(page.locator('[data-state="ready"]')).toHaveCount(2);
  await page.evaluate(() => window.harness.disable());
  await expect(page.locator("canvas")).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("unload cancels pending work, settings update existing canvases, and narrow panes remain bounded", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.evaluate((source) => {
    for (let i = 0; i < 20; i++) window.harness.mount(source);
    window.harness.clear();
  }, samples.sequence);
  await expect(page.locator("canvas")).toHaveCount(0);
  await page.evaluate(() => window.harness.mountSamples(["flowchart"]));
  await expect(page.locator('[data-state="ready"]')).toHaveCount(1);
  await page.evaluate(() => window.harness.updateSettings({ fontSize: 32, maxHeight: 200 }));
  await expect(page.locator('[data-state="ready"]')).toHaveCount(1);
  await expect.poll(() => page.locator(".mermaid-excalidraw-container").evaluate((el) => el.clientHeight)).toBe(200);
  expect(await page.evaluate(() => window.harness.savedSettings())).toEqual({ fontSize: 32, maxHeight: 200 });
  await page.setViewportSize({ width: 380, height: 700 });
  await expect.poll(() => page.locator(".mermaid-excalidraw-container").evaluate((el) => el.clientHeight)).toBe(200);
  await page.evaluate(() => window.harness.clear());
  expect(errors).toEqual([]);
});
