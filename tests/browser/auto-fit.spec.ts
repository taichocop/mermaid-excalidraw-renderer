import { expect, test } from "@playwright/test";
import { observeFitAPI, fitState, fitInk, expectFit, nativeContentInk } from "./auto-fit-helpers";
import { expectNoMenuChrome } from "./chrome-assertions";
import { samples } from "./samples";
import { quadrant } from "./quadrant-fixtures";

const small = 'flowchart LR\n A["入力"] --> B["検証"] --> C["保存"]';
const chain = (direction: string, length: number) => `flowchart ${direction}\n` +
  Array.from({ length: length - 1 }, (_, i) => ` N${i}["処理 ${i}"] --> N${i + 1}["処理 ${i + 1}"]`).join("\n");

test.beforeEach(async ({ page }) => {
  await observeFitAPI(page);
  await page.goto("/"); await page.evaluate(() => window.ready);
  await page.evaluate(async () => { await document.fonts.load("20px Virgil"); await document.fonts.ready; });
});

for (const language of ["mermaid", "mermaid-excalidraw"]) {
  test(`${language}: small Japanese scene grows, full labels/arrows fit, Reset stays centered 100%`, async ({ page }, info) => {
    await page.evaluate(({ small, language }) => window.harness.mount(small, language), { small, language });
    const inline = page.locator(".mermaid-excalidraw-container").first();
    const before = await expectFit(page, inline, 0, 3);
    expect(before.zoom).toBeGreaterThan(1);
    expect(before.height).toBe(600);
    const content = await nativeContentInk(page, 0);
    expect(content.filter(e => e.type === "text").map(e => e.text)).toEqual(["入力", "検証", "保存"]);
    expect(content.filter(e => e.type === "arrow")).toHaveLength(2);
    expect(content.every(e => e.ink > 20)).toBe(true);
    expect(content.filter(e => e.type === "arrow").every(e => e.shaftInk! > 5 && e.headInk! > 5)).toBe(true);
    await expectNoMenuChrome(inline);
    await inline.getByRole("button").click();
    const modal = page.getByRole("dialog"), viewer = modal.locator(".mermaid-excalidraw-enlarged");
    const initial = await expectFit(page, viewer, 1, 4);
    expect(initial.zoom).toBeGreaterThan(before.zoom);
    const controlsBox = (await modal.locator(".mermaid-excalidraw-controls").boundingBox())!;
    const canvasBox = (await viewer.locator(".mermaid-excalidraw-canvas").boundingBox())!;
    expect(controlsBox.y + controlsBox.height).toBeLessThanOrEqual(canvasBox.y + 1);
    await modal.getByRole("button", { name: "Reset zoom", exact: true }).click();
    await expect.poll(async () => (await fitState(page, 1))?.zoom).toBe(1);
    const reset = (await fitState(page, 1))!;
    expect((reset.projected.left + reset.projected.right) / 2).toBeCloseTo(reset.width / 2, 0);
    expect((reset.projected.top + reset.projected.bottom) / 2).toBeCloseTo(reset.height / 2, 0);
    await modal.getByRole("button", { name: "Fit to content", exact: true }).click();
    const fitted = await expectFit(page, viewer, 1, 4);
    expect(fitted.zoom).toBeGreaterThan(1);
    await expectNoMenuChrome(viewer);
    await info.attach("fit-measurements", { body: JSON.stringify({ before, initial, reset, fitted,
      inlineInk: await fitInk(inline), modalInk: await fitInk(viewer), controlsBox, canvasBox, content }), contentType: "application/json" });
  });
}

for (const fixture of [
  { name: "tiny capped", source: 'flowchart LR\n A["小"]', grows: true },
  { name: "large/wide", source: chain("LR", 25), grows: false },
  { name: "very tall", source: chain("TB", 25), grows: false },
  { name: "square", source: 'flowchart TB\n A[Start] --> B[Left] & C[Right]\n B & C --> D[End]', grows: true },
  { name: "native Sequence", source: samples.sequence, grows: true },
  { name: "Pie SVG", source: samples.pie },
  { name: "Quadrant SVG", source: quadrant },
]) {
  test(`${fixture.name}: width and height constrain real scene fit and canvas ink`, async ({ page }, info) => {
    await page.evaluate(source => window.harness.mount(source), fixture.source);
    const inline = page.locator(".mermaid-excalidraw-container").first();
    const state = await expectFit(page, inline, 0, 3);
    if (fixture.grows === true) expect(state.zoom).toBeGreaterThan(1);
    if (fixture.grows === false) expect(state.zoom).toBeLessThan(1);
    if (fixture.name === "tiny capped") expect(state.zoom).toBe(3);
    await inline.getByRole("button").click();
    const viewer = page.locator(".mermaid-excalidraw-enlarged");
    const modal = await expectFit(page, viewer, 1, 4);
    if (fixture.name === "tiny capped") expect(modal.zoom).toBe(4);
    await info.attach("scene-fit", { body: JSON.stringify({ inline: state, modal,
      ink: await fitInk(viewer), svg: await page.evaluate(() => window.harness.conversionDiagnostics()[0]) }), contentType: "application/json" });
  });
}

test("resize wide/narrow/wide refits once settled; hidden and zero-height panes recover", async ({ page }) => {
  const errors: string[] = []; page.on("pageerror", e => errors.push(e.message));
  await page.evaluate(source => {
    document.querySelector<HTMLElement>("main")!.style.display = "none";
    window.harness.mount(source);
  }, small);
  await expect(page.locator('[data-state="ready"]')).toHaveCount(1);
  await expect.poll(async () => (await fitState(page))?.zoom).toBe(1);
  await page.evaluate(() => document.querySelector<HTMLElement>("main")!.style.display = "block");
  const inline = page.locator(".mermaid-excalidraw-container").first();
  const wide = await expectFit(page, inline, 0, 3);
  await page.evaluate(() => document.querySelector<HTMLElement>("main")!.style.width = "300px");
  await expect.poll(async () => (await fitState(page))?.width).toBe(300);
  const narrow = await expectFit(page, inline, 0, 3);
  expect(narrow.width).toBe(300); expect(narrow.zoom).toBeLessThan(wide.zoom);
  await page.evaluate(() => document.querySelector<HTMLElement>("main")!.style.width = "900px");
  await expect.poll(async () => (await fitState(page))?.width).toBe(900);
  await expectFit(page, inline, 0, 3);
  await inline.getByRole("button").click();
  const viewer = page.locator(".mermaid-excalidraw-enlarged");
  await expectFit(page, viewer, 1, 4);
  await viewer.evaluate(e => { e.style.minHeight = "0"; e.style.height = "37px"; });
  await page.waitForTimeout(150);
  const hidden = (await fitState(page, 1))!;
  expect(Number.isFinite(hidden.zoom)).toBe(true); expect(hidden.zoom).toBeGreaterThan(0);
  await viewer.evaluate(e => { e.style.height = "600px"; });
  await expectFit(page, viewer, 1, 4);
  // Same-size notifications must not override manual navigation or loop.
  await page.getByRole("button", { name: "Zoom out", exact: true }).click();
  const manual = (await fitState(page, 1))!;
  await viewer.evaluate(e => { e.style.width = `${e.getBoundingClientRect().width}px`; });
  await page.waitForTimeout(300);
  expect(await fitState(page, 1)).toEqual(manual);
  expect(errors).toEqual([]);
});

test("theme, roughness and unrelated settings preserve manual zoom/pan; meaningful resize and explicit Fit refit", async ({ page }) => {
  await page.evaluate(source => window.harness.mount(source), small);
  const inline = page.locator(".mermaid-excalidraw-container").first();
  await expectFit(page, inline, 0, 3); await inline.getByRole("button").click();
  const viewer = page.locator(".mermaid-excalidraw-enlarged");
  await expectFit(page, viewer, 1, 4);
  await page.getByRole("button", { name: "Zoom out", exact: true }).click();
  const box = (await viewer.locator("canvas.interactive").boundingBox())!;
  const beforePan = (await fitState(page, 1))!;
  await page.mouse.move(box.x + 150, box.y + 100); await page.mouse.down();
  await page.mouse.move(box.x + 215, box.y + 140, { steps: 8 }); await page.mouse.up();
  await expect.poll(async () => (await fitState(page, 1))?.scrollX).not.toBe(beforePan.scrollX);
  const manual = (await fitState(page, 1))!;
  for (const dark of [true, false]) {
    await page.evaluate(dark => window.harness.theme(dark), dark);
    await page.waitForTimeout(150);
    expect(await fitState(page, 1)).toEqual(manual);
  }
  await page.evaluate(() => window.harness.updateSettings({ roughness: 2 }));
  await page.waitForTimeout(150); expect(await fitState(page, 1)).toEqual(manual);
  await page.evaluate(() => window.harness.updateSettings({ maxHeight: 700, canvasHeight: 700 }));
  await page.waitForTimeout(150); expect(await fitState(page, 1)).toEqual(manual);
  await page.setViewportSize({ width: 600, height: 500 });
  await expect.poll(async () => (await fitState(page, 1))?.width).toBeLessThan(600);
  await expectFit(page, viewer, 1, 4);
  await page.setViewportSize({ width: 1100, height: 900 });
  await expect.poll(async () => (await fitState(page, 1))?.width).toBeGreaterThan(900);
  await expectFit(page, viewer, 1, 4);
  await page.getByRole("button", { name: "Reset zoom", exact: true }).click();
  await expect(page.getByLabel("Zoom level")).toHaveText("100%");
  await page.getByRole("button", { name: "Fit to content", exact: true }).click();
  await expectFit(page, viewer, 1, 4);
  await page.evaluate(() => window.harness.updateSettings({ fontSize: 24 }));
  await expect(page.getByRole("dialog")).toHaveCount(0);
  // Reconversion intentionally closes the old preview, then fits the new scene.
  await expect.poll(() => page.locator('[data-state="ready"]').count()).toBe(1);
  await expectFit(page, inline, 2, 3);
});


test("minimum padding leaves measured inline caption clear of tall diagram ink", async ({ page }, info) => {
  await page.evaluate(async () => {
    await window.harness.updateSettings({ canvasPadding: 16 });
    window.harness.mount('flowchart TB\n A["Very long node label"] --> B["Very long node label"] --> C["Very long node label"]');
  });
  const inline = page.locator(".mermaid-excalidraw-container").first();
  await expectFit(page, inline, 0, 3, 16);
  const evidence = [];
  for (const roughness of [0, 1, 2]) {
    const before = await inline.locator("canvas.static").evaluate(c => (c as HTMLCanvasElement).toDataURL());
    await page.evaluate(roughness => window.harness.updateSettings({ roughness }), roughness);
    await expect.poll(() => inline.locator("canvas.static").evaluate(c => (c as HTMLCanvasElement).toDataURL())).not.toBe(before);
    const state = await expectFit(page, inline, 0, 3, 16);
    const ink = (await fitInk(inline))!;
    const canvas = (await inline.locator("canvas.static").boundingBox())!;
    const caption = (await inline.locator(".mermaid-excalidraw-open span").boundingBox())!;
    expect(ink.bottom + canvas.y).toBeLessThan(caption.y);
    evidence.push({ roughness, state, ink, canvas, caption });
  }
  await info.attach("inline-caption-clearance", { body: JSON.stringify(evidence), contentType: "application/json" });
});


test("revealed SVG viewers recover late dimension commits without fitting stale viewport bounds", async ({ page }) => {
  await page.evaluate(() => {
    document.querySelector<HTMLElement>("main")!.style.display = "none";
    window.harness.mountSamples(["class", "er", "state"]);
  });
  await expect(page.locator('[data-state="ready"]')).toHaveCount(3);
  await page.evaluate(() => document.querySelector<HTMLElement>("main")!.style.display = "");
  const viewers = page.locator(".mermaid-excalidraw-container");
  for (let index = 0; index < 3; index++) await expectFit(page, viewers.nth(index), index, 3);
  await page.evaluate(() => document.querySelector<HTMLElement>("main")!.style.display = "none");
  await expect(page.locator("main")).toBeHidden();
  await page.evaluate(() => {
    const main = document.querySelector<HTMLElement>("main")!;
    main.style.width = "300px";
    main.style.display = "";
    window.harness.theme(true);
  });
  for (let index = 0; index < 3; index++) {
    await expect.poll(async () => (await fitState(page, index))?.width).toBe(300);
    await expectFit(page, viewers.nth(index), index, 3);
  }
  // Reproduce a delayed host/upstream measurement commit through the public
  // scene API. DOM dimensions stay 300px; the viewer must synchronize before fit.
  await page.evaluate(() => {
    for (const api of window.fitApis) api.updateScene({ appState: { width: 900, height: 600 } });
  });
  for (let index = 0; index < 3; index++) {
    await expect.poll(async () => (await fitState(page, index))?.width).toBe(300);
    await expectFit(page, viewers.nth(index), index, 3);
  }
});
