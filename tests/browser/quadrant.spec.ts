import { expect, test, type Page } from "@playwright/test";
import { dependencies } from "../../package.json";
import { expectBoundedInk, expectNoMenuChrome } from "./chrome-assertions";
import { quadrant, alternateQuadrant, invalidQuadrant, escapedErrorQuadrant, nativeFlowchart,
  quadrantLabels, alternateLabels } from "./quadrant-fixtures";
import { attachQuadrantEvidence, expectPointPosition, expectQuadrantPixels, preparedSvg, quadrantPixels, svgGeometry } from "./quadrant-assertions";

const errors = new WeakMap<Page, { page: string[]; console: string[] }>();
const readbackWarning = "Canvas2D: Multiple readback operations using getImageData are faster with the willReadFrequently attribute set to true. See: https://html.spec.whatwg.org/multipage/canvas.html#concept-canvas-will-read-frequently";
test.beforeEach(async ({ page }) => {
  const captured = { page: [] as string[], console: [] as string[] };
  errors.set(page, captured);
  page.on("pageerror", (error) => captured.page.push(error.message));
  page.on("console", (message) => {
    // Pixel assertions read the production canvas after upstream created its
    // context. Ignore only Chrome's exact performance advisory, never errors.
    if (message.type() === "warning" && message.text() === readbackWarning) return;
    if (["error", "warning"].includes(message.type())) captured.console.push(message.text());
  });
  await page.route("**/favicon.ico", (route) => route.fulfill({ status: 204 }));
  await page.goto("/"); await page.evaluate(() => window.ready);
});
test.afterEach(async ({ page }, testInfo) => {
  const captured = errors.get(page)!;
  expect(captured.page).toEqual([]);
  if (testInfo.title.includes("invalid isolation")) {
    expect(captured.console).toHaveLength(2);
    for (const message of captured.console) {
      expect(message).toMatch(/^\[Mermaid Excalidraw Renderer\] Conversion failed/);
      expect(message).toContain("Lexical error");
    }
  } else expect(captured.console).toEqual([]);
});

test("official quadrant uses SVG fallback and preserves geometry, every label, points and separators in Light → Dark → Light", async ({ page }, testInfo) => {
  await page.evaluate((source) => window.harness.mount(source, "mermaid"), quadrant);
  await expect(page.locator('[data-state="ready"]')).toHaveCount(1);
  expect(await page.evaluate(() => window.harness.sceneSummaries())).toEqual([{ count: 1, imageFallback: true }]);
  const raw = await page.evaluate(() => window.harness.conversionDiagnostics()[0]!);
  expect(raw.elements).toEqual([{ type: "image", width: expect.any(Number), height: expect.any(Number) }]);
  expect(raw.files).toHaveLength(1);
  expect(raw.files[0]!.mimeType).toBe("image/svg+xml");
  const rawSource = raw.files[0]!.svg!.source;
  const original = await svgGeometry(page, rawSource);
  expect(original.width).toBeGreaterThan(0); expect(original.height).toBeGreaterThan(0);
  expect(raw.elements[0]!.width).toBe(original.width); expect(raw.elements[0]!.height).toBe(original.height);
  expect(original.viewBox!.split(/\s+/).map(Number).every(Number.isFinite)).toBe(true);
  expect(original.labels.map((label) => label.text).sort()).toEqual([...quadrantLabels].sort());
  expect(original.quadrants).toHaveLength(4); expect(original.points).toHaveLength(2); expect(original.lines).toHaveLength(6);
  expectPointPosition(original, "Project A", "Expand"); expectPointPosition(original, "Project B", "Reconsider");
  const a = original.points.find((p) => p.text === "Project A")!, b = original.points.find((p) => p.text === "Project B")!;
  const centerX = (Math.min(...original.quadrants.map((r) => r.x)) + Math.max(...original.quadrants.map((r) => r.x + r.width))) / 2;
  const centerY = (Math.min(...original.quadrants.map((r) => r.y)) + Math.max(...original.quadrants.map((r) => r.y + r.height))) / 2;
  expect(a.x).toBeGreaterThan(centerX); expect(a.y).toBeLessThan(centerY);
  expect(b.x).toBeLessThan(centerX); expect(b.y).toBeGreaterThan(centerY);
  await attachQuadrantEvidence(testInfo, "raw-converter", { dependencies, browser: page.context().browser()?.version(), raw, geometry: original }, rawSource);
  const ids: string[] = [];
  for (const [name, dark] of [["light", false], ["dark", true], ["light-restored", false]] as const) {
    await page.evaluate((dark) => window.harness.theme(dark), dark);
    await expect.poll(() => page.evaluate((dark) => window.harness.viewDiagnostics()[0]?.appearance?.theme === (dark ? "dark" : "light"), dark)).toBe(true);
    const { diagnostic, source } = await preparedSvg(page);
    const normalized = await svgGeometry(page, source);
    expect({ width: normalized.width, height: normalized.height, viewBox: normalized.viewBox,
      labels: normalized.labels, quadrants: normalized.quadrants, lines: normalized.lines, structure: normalized.structure })
      .toEqual({ width: original.width, height: original.height, viewBox: original.viewBox,
        labels: original.labels, quadrants: original.quadrants, lines: original.lines, structure: original.structure });
    expect(normalized.points.map(({ fill: _fill, stroke: _stroke, ...geometry }) => geometry))
      .toEqual(original.points.map(({ fill: _fill, stroke: _stroke, ...geometry }) => geometry));
    const canvas = page.locator("canvas.static");
    try { await expectQuadrantPixels(canvas, normalized, quadrantLabels, dark); }
    finally {
      await attachQuadrantEvidence(testInfo, name, { diagnostic, geometry: normalized,
        pixels: await quadrantPixels(canvas, normalized, dark) }, source);
    }
    await expectBoundedInk(page.locator(".mermaid-excalidraw-container"));
    await expectNoMenuChrome(page.locator(".mermaid-excalidraw-container"));
    ids.push(diagnostic.files[0]!.id);
  }
  expect(ids[0]).not.toBe(ids[1]); expect(ids[2]).toBe(ids[0]);
});

test("distinct quadrant files and scenes coexist with native Flowchart and independent Modal controls", async ({ page }, testInfo) => {
  await page.evaluate(({ first, second, flow }) => {
    window.harness.editors.create("quadrant-tab-host", "Synthetic alpha beta");
    window.harness.keyboardHost.install("window", "quadrant-tab-host");
    window.harness.mount(first); window.harness.mount(second); window.harness.mount(flow);
  }, { first: quadrant, second: alternateQuadrant, flow: nativeFlowchart });
  await expect(page.locator('[data-state="ready"]')).toHaveCount(3);
  expect(await page.evaluate(() => window.harness.sceneSummaries())).toEqual([
    { count: 1, imageFallback: true }, { count: 1, imageFallback: true }, { count: expect.any(Number), imageFallback: false },
  ]);
  const native = await page.evaluate(() => window.harness.conversionDiagnostics()[2]!);
  expect(native.files).toEqual([]); expect(native.elements.length).toBeGreaterThan(1);
  expect(native.elements.some((element) => element.type === "image")).toBe(false);
  const first = await preparedSvg(page, 0), second = await preparedSvg(page, 1);
  expect(first.diagnostic.files[0]!.id).not.toBe(second.diagnostic.files[0]!.id);
  const geometries = [await svgGeometry(page, first.source), await svgGeometry(page, second.source)];
  expectPointPosition(geometries[1]!, "Option C", "Improve"); expectPointPosition(geometries[1]!, "Option D", "Maintain");
  const inline = page.locator("#reading .mermaid-excalidraw-container");
  for (const dark of [false, true, false]) {
    await page.evaluate((dark) => window.harness.theme(dark), dark);
    for (const index of [0, 1]) {
      await expectQuadrantPixels(inline.nth(index).locator("canvas.static"), geometries[index]!, index ? alternateLabels : quadrantLabels, dark);
    }
    const scenes = await page.evaluate(() => window.harness.viewDiagnostics());
    expect(new Set(scenes.slice(0, 2).map((scene) => scene.files[0]!.id)).size).toBe(2);
    await expectBoundedInk(inline.nth(2));
  }
  const opener = page.getByRole("button", { name: "Open enlarged Mermaid diagram" });
  for (const index of [0, 1]) {
    await opener.nth(index).click();
    const modal = page.getByRole("dialog");
    await expect(modal).toHaveCount(1);
    for (const dark of [false, true, false]) {
      await page.evaluate((dark) => window.harness.theme(dark), dark);
      await expectQuadrantPixels(modal.locator("canvas.static"), geometries[index]!, index ? alternateLabels : quadrantLabels, dark);
      for (const inlineIndex of [0, 1]) {
        await expectQuadrantPixels(inline.nth(inlineIndex).locator("canvas.static"), geometries[inlineIndex]!, inlineIndex ? alternateLabels : quadrantLabels, dark);
      }
    }
    await expectNoMenuChrome(modal.locator(".mermaid-excalidraw-container"));
    await modal.getByRole("button", { name: "Zoom in", exact: true }).click();
    await modal.getByRole("button", { name: "Zoom out", exact: true }).click();
    await modal.getByRole("button", { name: "Reset zoom" }).click();
    await expect(modal.getByLabel("Zoom level")).toHaveText("100%");
    await modal.getByRole("button", { name: "Fit to content" }).click();
    await expectQuadrantPixels(modal.locator("canvas.static"), geometries[index]!, index ? alternateLabels : quadrantLabels, false);
    const controls = modal.locator(".mermaid-excalidraw-controls button");
    await expect(controls).toHaveCount(5);
    // The disposable host adds its own Close dialog button. Verify the five
    // plugin controls and public Modal wrap including that host control.
    const tabStops = [modal.getByRole("button", { name: "Close dialog", exact: true }),
      ...Array.from({ length: 5 }, (_, i) => controls.nth(i))];
    await tabStops[0]!.focus();
    for (let i = 1; i <= tabStops.length; i++) {
      await page.keyboard.press("Tab"); await expect(tabStops[i % tabStops.length]!).toBeFocused();
    }
    for (let i = tabStops.length - 1; i >= 0; i--) {
      await page.keyboard.press("Shift+Tab"); await expect(tabStops[i]!).toBeFocused();
    }
    await modal.getByRole("button", { name: "Close preview" }).click();
    await expect(modal).toHaveCount(0); await expect(opener.nth(index)).toBeFocused();
    await expect(page.locator("canvas.static")).toHaveCount(3);
  }
  await attachQuadrantEvidence(testInfo, "multiple-scenes", await page.evaluate(() => window.harness.viewDiagnostics()));
});

test("invalid isolation uses actual parser rejection, text-only errors and adjacent quadrant/native scenes", async ({ page }, testInfo) => {
  await page.evaluate(({ good, bad, escaped, flow }) => {
    window.harness.mount(good); window.harness.mount(bad); window.harness.mount(escaped); window.harness.mount(flow);
  }, { good: quadrant, bad: invalidQuadrant, escaped: escapedErrorQuadrant, flow: nativeFlowchart });
  await expect(page.locator('[data-state="ready"]')).toHaveCount(2);
  await expect(page.locator('[data-state="error"]')).toHaveCount(2);
  const alerts = page.getByRole("alert");
  await expect(alerts.nth(0)).toContainText("Lexical error"); await expect(alerts.nth(1)).toContainText("Lexical error");
  // Mermaid truncates its lexical context and normalizes quotes. The visible
  // '<b' stays text, with no element created from the invalid source.
  await expect(alerts.nth(1)).toContainText("<b");
  await expect(page.locator("#quadrant-injection, [role=alert] b, [role=alert] img, [role=alert] script")).toHaveCount(0);
  const { source } = await preparedSvg(page);
  await expectQuadrantPixels(page.locator("canvas.static").nth(0), await svgGeometry(page, source), quadrantLabels, false);
  await expectBoundedInk(page.locator('[data-state="ready"]').nth(1));
  const scenes = await page.evaluate(() => window.harness.sceneSummaries());
  expect(scenes[0]).toEqual({ count: 1, imageFallback: true }); expect(scenes[1]).toBeNull(); expect(scenes[2]).toBeNull();
  expect(scenes[3]?.imageFallback).toBe(false);
  await attachQuadrantEvidence(testInfo, "invalid-parser-errors", { messages: await alerts.allTextContents(), scenes });
});

test("quadrant narrow/resize and initially hidden/revealed panes retain every label, point and separator", async ({ page }, testInfo) => {
  await page.evaluate((source) => { document.getElementById("reading")!.hidden = true; window.harness.mount(source); }, quadrant);
  await expect(page.locator('[data-state="ready"]')).toHaveCount(1);
  await page.evaluate(() => { document.getElementById("reading")!.hidden = false; });
  const { source } = await preparedSvg(page), geometry = await svgGeometry(page, source);
  const viewer = page.locator("#reading .mermaid-excalidraw-container");
  for (const width of [1100, 340, 760]) {
    await page.setViewportSize({ width, height: 900 });
    await expectQuadrantPixels(viewer.locator("canvas.static"), geometry, quadrantLabels, false);
    await expectBoundedInk(viewer); await expectNoMenuChrome(viewer);
    await attachQuadrantEvidence(testInfo, `width-${width}`, await quadrantPixels(viewer.locator("canvas.static"), geometry, false));
  }
  await page.evaluate(() => window.harness.setViewMode("source"));
  await expect(viewer).toBeHidden();
  await page.evaluate(() => window.harness.setViewMode("preview"));
  await expectQuadrantPixels(viewer.locator("canvas.static"), geometry, quadrantLabels, false);
});

test("quadrant rerender, settings redraw, note switch, clear and unload dispose roots and SVG caches", async ({ page }, testInfo) => {
  await page.evaluate((source) => window.harness.mount(source), quadrant);
  await expect(page.locator('[data-state="ready"]')).toHaveCount(1);
  const first = await preparedSvg(page), geometry = await svgGeometry(page, first.source);
  const viewer = page.locator("#reading .mermaid-excalidraw-container");
  await expectQuadrantPixels(viewer.locator("canvas.static"), geometry, quadrantLabels, false);
  await page.evaluate(() => window.harness.viewDiagnostics(true));
  await page.evaluate(() => window.harness.rerender());
  await expect(page.locator('[data-state="ready"]')).toHaveCount(1);
  await expectQuadrantPixels(viewer.locator("canvas.static"), geometry, quadrantLabels, false);
  expect(await page.evaluate(() => window.harness.retainedViewDiagnostics())).toEqual([
    { root: false, data: false, converted: false, scene: false },
  ]);
  await page.evaluate(() => window.harness.viewDiagnostics(true));
  const before = await preparedSvg(page);
  await page.getByRole("button", { name: "Open enlarged Mermaid diagram" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(1);
  await page.evaluate(() => window.harness.updateSettings({ roughness: 2, canvasHeight: 420, canvasPadding: 48 }));
  await expect.poll(() => viewer.evaluate((el) => el.clientHeight)).toBe(420);
  await expect(page.getByRole("dialog")).toHaveCount(1);
  await expectQuadrantPixels(viewer.locator("canvas.static"), geometry, quadrantLabels, false);
  expect((await preparedSvg(page)).source).toBe(before.source);
  await page.evaluate(() => window.harness.updateSettings({ fontSize: 24 }));
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.locator('[data-state="ready"]')).toHaveCount(1);
  const redraw = await preparedSvg(page);
  expect(redraw.diagnostic.files[0]!.id).not.toBe(before.diagnostic.files[0]!.id);
  await expectQuadrantPixels(viewer.locator("canvas.static"), await svgGeometry(page, redraw.source), quadrantLabels, false);
  await page.evaluate(({ next }) => { window.harness.clear(); window.harness.mount(next); }, { next: alternateQuadrant });
  await expect(page.locator('[data-state="ready"]')).toHaveCount(1);
  const next = await preparedSvg(page);
  await expectQuadrantPixels(viewer.locator("canvas.static"), await svgGeometry(page, next.source), alternateLabels, false);
  expect(next.source).not.toContain("Project A");
  expect((await page.evaluate(() => window.harness.retainedViewDiagnostics())).every((cache) => !cache.root && !cache.data && !cache.converted && !cache.scene)).toBe(true);
  await page.evaluate(() => window.harness.viewDiagnostics(true));
  await page.getByRole("button", { name: "Open enlarged Mermaid diagram" }).click();
  await page.evaluate(() => window.harness.clear());
  await expect(page.locator("canvas, [role=dialog]")).toHaveCount(0);
  expect(await page.evaluate(() => window.harness.hostState().children)).toBe(0);
  expect(await page.evaluate(() => window.harness.viewDiagnostics())).toEqual([]);
  await page.evaluate((source) => { window.harness.mount(source); window.harness.clear(); }, quadrant);
  await page.evaluate((source) => window.harness.mount(source), quadrant);
  await expect(page.locator('[data-state="ready"]')).toHaveCount(1);
  const last = await preparedSvg(page);
  await expectQuadrantPixels(viewer.locator("canvas.static"), await svgGeometry(page, last.source), quadrantLabels, false);
  await page.evaluate(() => window.harness.viewDiagnostics(true));
  await page.getByRole("button", { name: "Open enlarged Mermaid diagram" }).click();
  await page.evaluate(() => window.harness.disable());
  await expect(page.locator("canvas, [role=dialog]")).toHaveCount(0);
  expect(await page.evaluate(() => window.harness.hostState().children)).toBe(0);
  expect(await page.evaluate(() => window.harness.viewDiagnostics())).toEqual([]);
  const disposed = await page.evaluate(() => window.harness.retainedViewDiagnostics());
  expect(disposed.every((cache) => !cache.root && !cache.data && !cache.converted && !cache.scene)).toBe(true);
  await attachQuadrantEvidence(testInfo, "disposed-caches", disposed);
});

test("production SVG normalization keeps generic zero-stroke filled markers and hollow/stroked controls in Light/Dark", async ({ page }, testInfo) => {
  await page.evaluate((source) => window.harness.mount(source), quadrant);
  await expect(page.locator('[data-state="ready"]')).toHaveCount(1);
  for (const dark of [false, true]) {
    await page.evaluate((dark) => window.harness.theme(dark), dark);
    await expect.poll(() => page.evaluate((dark) => window.harness.viewDiagnostics()[0]?.appearance?.theme === (dark ? "dark" : "light"), dark)).toBe(true);
    const { source } = await preparedSvg(page);
    const controls = await page.evaluate(async ({ source, dark }) => {
      // Reuse the stylesheet actually emitted by production normalization.
      // Synthetic controls are decoded as an image; no XML enters the host DOM.
      const parsed = new DOMParser().parseFromString(source, "image/svg+xml");
      const style = parsed.documentElement.lastElementChild!.textContent!;
      const fixture = `<svg xmlns="http://www.w3.org/2000/svg" width="180" height="30"><style>${style}</style>
        <circle cx="15" cy="15" r="8" fill="red" stroke-width="0"/>
        <circle cx="45" cy="15" r="8" fill="red" stroke-width="0px"/>
        <circle cx="75" cy="15" r="8" fill="none" stroke-width="0"/>
        <circle cx="105" cy="15" r="8" fill="none" stroke-width="0px"/>
        <circle cx="135" cy="15" r="8" fill="red" stroke-width="2"/>
        <g fill="none"><circle cx="165" cy="15" r="8" stroke-width="0"/></g></svg>`;
      const image = new Image(); image.src = `data:image/svg+xml;base64,${btoa(fixture)}`; await image.decode();
      const canvas = document.createElement("canvas"); canvas.width = 180; canvas.height = 30;
      const context = canvas.getContext("2d", { willReadFrequently: true })!;
      context.fillStyle = dark ? "#1e1e1e" : "#ffffff"; context.fillRect(0, 0, 180, 30); context.drawImage(image, 0, 0);
      return [15, 45, 75, 105, 135, 165].map((x) => ({
        center: [...context.getImageData(x, 15, 1, 1).data], edge: [...context.getImageData(x, 7, 1, 1).data],
      }));
    }, { source, dark });
    const foreground = dark ? [255, 255, 255, 255] : [0, 0, 0, 255];
    const background = dark ? [30, 30, 30, 255] : [255, 255, 255, 255];
    expect(controls.slice(0, 2).map((control) => control.center)).toEqual([foreground, foreground]);
    expect(controls.slice(2, 4).map((control) => control.center)).toEqual([background, background]);
    expect(controls[4]!.center).toEqual(background); expect(controls[4]!.edge).toEqual(foreground);
    expect(controls[5]!.center).toEqual(background);
    expect(controls[5]!.edge[3]).toBe(255);
    // SVG raster compositing can round a background edge by one channel step.
    for (const [i, channel] of controls[5]!.edge.slice(0, 3).entries()) {
      expect(Math.abs(channel - background[i]!)).toBeLessThanOrEqual(2);
    }
    await attachQuadrantEvidence(testInfo, `generic-circles-${dark ? "dark" : "light"}`, controls);
  }
});
