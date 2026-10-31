import { expect, test, type Locator, type Page } from "@playwright/test";
import { fitInk, fitState, observeFitAPI } from "./auto-fit-helpers";
import { samples } from "./samples";
import { twoSets } from "./venn-fixtures";

// Minimal measured Obsidian 1.14.5 default-button rule. The old mock omitted
// this selector, whose specificity beats the opener's original class selector.
const hostStyles = `
  .theme-light { --interactive-normal: rgb(228, 228, 228); }
  .theme-dark { --interactive-normal: rgb(51, 51, 51); }
  button:not(.clickable-icon) { background-color: var(--interactive-normal); }
  .markdown-source-view.mod-cm6 *, main * { box-sizing: border-box; }
  .markdown-source-view.mod-cm6 .cm-content > [contenteditable=false] {
    contain: paint !important; overflow: auto;
  }
`;
const fixtures = { flowchart: samples.flowchart, sequence: samples.sequence,
  class: samples.class, er: samples.er, state: samples.state, venn: twoSets };

async function mount(page: Page, mode: "reading" | "live", language: string, source: string) {
  await page.evaluate(async ({ mode, language, source }) => {
    await window.harness.updateSettings({ canvasHeight: 400 });
    if (mode === "reading") window.harness.mount(source, language);
    else {
      window.harness.editors.create("initial-visibility", `Before\n\n\`\`\`${language}\n${source}\n\`\`\`\n\nAfter`);
      document.getElementById("initial-visibility")!.className = "markdown-source-view mod-cm6";
    }
  }, { mode, language, source });
}

async function raster(viewer: Locator) {
  return viewer.locator("canvas.static").evaluate(node => {
    const canvas = node as HTMLCanvasElement;
    const pixels = canvas.getContext("2d")!.getImageData(0, 0, canvas.width, canvas.height).data;
    let hash = 2166136261;
    for (const byte of pixels) hash = Math.imul(hash ^ byte, 16777619);
    return { hash: hash >>> 0, width: canvas.width, height: canvas.height };
  });
}

/** Capture the compositor output, not getImageData() of the diagram canvas.
 * Crop off border, caption and focus outline so unrelated ink cannot pass.
 * Page screenshots deliberately avoid locator screenshot's automatic scrolling.
 */
async function screen(page: Page, viewer: Locator, dark: boolean) {
  const rect = await viewer.locator("canvas.static").boundingBox();
  expect(rect).not.toBeNull();
  const clip = { x: rect!.x + 6, y: rect!.y + 6, width: rect!.width - 12, height: rect!.height - 54 };
  expect(clip.y).toBeGreaterThanOrEqual(0);
  expect(clip.y + clip.height).toBeLessThan(page.viewportSize()!.height);
  const png = await page.screenshot({ clip, scale: "css" });
  const measured = await page.evaluate(async ({ base64, dark }) => {
    const blob = await (await fetch(`data:image/png;base64,${base64}`)).blob();
    const bitmap = await createImageBitmap(blob);
    const canvas = document.createElement("canvas"); canvas.width = bitmap.width; canvas.height = bitmap.height;
    const ctx = canvas.getContext("2d")!; ctx.drawImage(bitmap, 0, 0); bitmap.close();
    const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    let count = 0;
    for (let i = 0; i < pixels.length; i += 4) {
      const values = [pixels[i]!, pixels[i + 1]!, pixels[i + 2]!];
      if (pixels[i + 3]! > 200 && (dark ? Math.min(...values) > 170 : Math.max(...values) < 100)) count++;
    }
    // A stale Light background must not count as all-white Dark diagram ink
    // (or vice versa). This corner lies inside the measured padding margin.
    const background = dark ? 30 : 255;
    const backgroundMatches = [pixels[0]!, pixels[1]!, pixels[2]!]
      .every(value => Math.abs(value - background) <= 2);
    return { count, backgroundMatches };
  }, { base64: png.toString("base64"), dark });
  return { png, ink: measured.backgroundMatches ? measured.count : 0 };
}

for (const mode of ["reading", "live"] as const) {
  for (const language of ["mermaid", "mermaid-excalidraw"]) {
    for (const dark of [false, true]) {
      for (const [fixture, source] of Object.entries(fixtures)) {
        test(`${mode} ${language} ${fixture} ${dark ? "Dark" : "Light"}: screen ink precedes first hover`, async ({ page }, testInfo) => {
          // Exact production JS/CSS: no callback rewriting in this matrix.
          await page.goto("/"); await page.evaluate(() => window.ready);
          await page.mouse.move(0, 0);
          await page.addStyleTag({ content: hostStyles });
          await page.evaluate(dark => window.harness.theme(dark), dark);
          await mount(page, mode, language, source);
          const viewer = page.locator(".mermaid-excalidraw-container");
          await expect(viewer).toHaveAttribute("data-state", "ready");
          await expect.poll(async () => (await fitInk(viewer))?.count ?? 0).toBeGreaterThan(100);
          await page.waitForTimeout(600);
          const opener = viewer.locator(".mermaid-excalidraw-open");
          expect(await opener.evaluate(node => node.matches(":hover"))).toBe(false);
          const beforeRaster = await raster(viewer);
          const beforeScenes = await page.evaluate(() => window.harness.sceneDiagnostics());
          const before = await screen(page, viewer, dark);
          await opener.hover({ position: { x: 200, y: 120 } });
          const after = await screen(page, viewer, dark);
          await testInfo.attach("before-first-hover", { body: before.png, contentType: "image/png" });
          await testInfo.attach("after-first-hover", { body: after.png, contentType: "image/png" });
          expect.soft(before.ink).toBeGreaterThan(100);
          expect.soft(after.ink).toBeGreaterThan(100);
          expect.soft(after.png.equals(before.png)).toBe(true);
          expect(await raster(viewer)).toEqual(beforeRaster);
          expect(await page.evaluate(() => window.harness.sceneDiagnostics())).toEqual(beforeScenes);
          await page.mouse.move(0, 0);
          await opener.focus();
          expect((await screen(page, viewer, dark)).png.equals(before.png)).toBe(true);
          await page.keyboard.press("Enter");
          await expect(page.getByRole("dialog")).toBeVisible();
          await page.keyboard.press("Escape");
          await expect(page.getByRole("dialog")).toHaveCount(0);
          expect((await screen(page, viewer, dark)).png.equals(before.png)).toBe(true);
        });
      }
    }
  }
}

for (const mode of ["reading", "live"] as const) {
  for (const language of ["mermaid", "mermaid-excalidraw"]) {
    test(`${mode} ${language}: public viewport and visible ink survive reveal, resize and theme changes without hover`, async ({ page }) => {
      // This separate diagnostic forwards the existing public API callback;
      // the exact-bundle screenshot matrix above needs no instrumentation.
      await observeFitAPI(page);
      await page.goto("/"); await page.evaluate(() => window.ready);
      await page.mouse.move(0, 0);
      await page.addStyleTag({ content: hostStyles });
      await mount(page, mode, language, samples.class);
      const viewer = page.locator(".mermaid-excalidraw-container");
      await expect.poll(async () => (await fitInk(viewer))?.count ?? 0).toBeGreaterThan(100);
      await page.waitForTimeout(600);
      const before = await fitState(page);
      await viewer.locator(".mermaid-excalidraw-open").hover({ position: { x: 180, y: 100 } });
      expect(await fitState(page)).toEqual(before);
      await page.mouse.move(0, 0);
      for (const dark of [true, false]) {
        await page.evaluate(dark => window.harness.theme(dark), dark);
        await expect.poll(async () => (await screen(page, viewer, dark)).ink).toBeGreaterThan(100);
      }
      await viewer.evaluate(node => { node.style.display = "none"; });
      await expect.poll(async () => (await viewer.boundingBox()) === null).toBe(true);
      await viewer.evaluate(node => { node.style.display = ""; });
      for (const width of [540, 900]) {
        await page.setViewportSize({ width: width + 100, height: 900 });
        await expect.poll(async () => (await screen(page, viewer, false)).ink).toBeGreaterThan(100);
      }
      expect(await viewer.locator(".mermaid-excalidraw-open").evaluate(node => node.matches(":hover"))).toBe(false);
    });
  }
}
