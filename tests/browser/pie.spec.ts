import { expect, test, type JSHandle, type Locator, type Page } from "@playwright/test";
import type { DiagramMount } from "../../src/renderer/DiagramMount";
import type { ViewSceneCache } from "../../src/renderer/ExcalidrawView";
import { expectBoundedInk, expectNoMenuChrome } from "./chrome-assertions";
import { expectPie, watchErrors, type PieExpectation } from "./pie-assertions";
import { samples } from "./samples";

const showData = `pie showData
  title Work Distribution
  "Development": 70
  "Research": 20
  "Other": 10`;
const noShowData = showData.replace("pie showData", "pie");
const secondPie = `pie showData
  title Roadmap
  "Planning": 60
  "Delivery": 25
  "Support": 15`;
const zero = `pie showData
  title Zero Included
  "Development": 70
  "Research": 20
  "Zero": 0`;
const negative = `pie showData
  title Negative Value
  "Development": 70
  "Negative": -20`;
const nonnumeric = `pie showData
  title Invalid Value
  "Development": 70
  "Other": nope`;
const flowchart = "flowchart LR\nA[Native] --> B[Neighbor]";

const work: PieExpectation = { title: "Work Distribution",
  legend: ["Development [70]", "Research [20]", "Other [10]"],
  percentages: ["70%", "20%", "10%"], sections: 3, descending: true };
const plainWork: PieExpectation = { ...work, legend: ["Development", "Research", "Other"] };
const roadmap: PieExpectation = { title: "Roadmap", legend: ["Planning [60]", "Delivery [25]", "Support [15]"],
  percentages: ["60%", "25%", "15%"], sections: 3, descending: true };
const usage: PieExpectation = { title: "Usage", legend: ["Work", "Rest"], percentages: ["70%", "30%"], sections: 2 };
const zeroIncluded: PieExpectation = { title: "Zero Included",
  legend: ["Development [70]", "Research [20]", "Zero [0]"], percentages: ["78%", "22%"], sections: 2 };
const themes = [false, true, false] as const;

type PieObservation = Awaited<ReturnType<typeof expectPie>>;
type HeldMounts = JSHandle<{ mount: DiagramMount; signal: AbortSignal | null }[]>;

// Retain only Plugin-owned mount handles, never upstream objects. The signals
// are captured before disposal so clearing controller alone cannot pass.
async function holdMounts(page: Page): Promise<HeldMounts> {
  return page.evaluateHandle(() => window.harness.mountHandles().map(mount => {
    const controller: unknown = Reflect.get(mount, "controller");
    if (controller !== null && !(controller instanceof AbortController)) throw new Error("Invalid mount controller");
    return { mount, signal: controller?.signal ?? null };
  }));
}

async function expectDisposed(handles: HeldMounts, count: number) {
  const snapshot = await handles.evaluate(entries => entries.map(({ mount, signal }) => {
    const value: unknown = Reflect.get(mount, "sceneCache");
    if (typeof value !== "object" || value === null) throw new Error("Missing mount scene cache");
    const cache = value as ViewSceneCache;
    return { disposed: Reflect.get(mount, "disposed") === true,
      rootCleared: Reflect.get(mount, "root") === null,
      controllerCleared: Reflect.get(mount, "controller") === null,
      aborted: signal?.aborted === true, dataCleared: mount.data === null,
      convertedCleared: cache.converted === undefined, sceneCleared: cache.scene === undefined,
      canvases: mount.containerEl.querySelectorAll("canvas").length };
  }));
  expect(snapshot).toHaveLength(count);
  expect(snapshot).toEqual(Array.from({ length: count }, () => ({ disposed: true, rootCleared: true,
    controllerCleared: true, aborted: true, dataCleared: true, convertedCleared: true,
    sceneCleared: true, canvases: 0 })));
}

async function holdPreview(page: Page) {
  const handle = await page.evaluateHandle(() => window.harness.previewHandle());
  expect(await handle.evaluate(preview => preview !== null && Reflect.get(preview, "root") !== null
    && Reflect.get(preview, "viewer") !== null)).toBe(true);
  return handle;
}

async function expectPreviewDisposed(handle: Awaited<ReturnType<typeof holdPreview>>, page: Page) {
  expect(await handle.evaluate(preview => {
    if (!preview) throw new Error("Missing retained preview");
    return { rootCleared: Reflect.get(preview, "root") === null,
      viewerCleared: Reflect.get(preview, "viewer") === null,
      ownerWindowCleared: Reflect.get(preview, "ownerWindow") === null,
      canvases: preview.contentEl.querySelectorAll("canvas").length };
  })).toEqual({ rootCleared: true, viewerCleared: true, ownerWindowCleared: true, canvases: 0 });
  expect(await page.evaluate(() => window.harness.previewHandle())).toBeNull();
}

function expectSameTransform(a: PieObservation, b: PieObservation) {
  expect(Math.abs(a.pixels.registration.scale - b.pixels.registration.scale)).toBeLessThan(0.03);
  expect(Math.abs(a.pixels.registration.x - b.pixels.registration.x)).toBeLessThan(4);
  expect(Math.abs(a.pixels.registration.y - b.pixels.registration.y)).toBeLessThan(4);
}

function expectCentered(observation: PieObservation) {
  const { registration, width, height } = observation.pixels;
  // Registration maps intrinsic SVG image pixels into the actual canvas.
  // Center the complete fallback image, including its off-center legend.
  expect(Math.abs(registration.x + observation.geometry.width * registration.scale / 2 - width / 2)).toBeLessThan(4);
  expect(Math.abs(registration.y + observation.geometry.height * registration.scale / 2 - height / 2)).toBeLessThan(4);
}

async function pan(page: Page, viewer: Locator) {
  const box = await viewer.locator("canvas.interactive").boundingBox();
  if (!box) throw new Error("Missing interactive canvas bounds");
  await page.mouse.move(box.x + 150, box.y + 100); await page.mouse.down();
  await page.mouse.move(box.x + 220, box.y + 145, { steps: 6 }); await page.mouse.up();
}

test.beforeEach(async ({ page }) => {
  await page.goto("/"); await page.evaluate(() => window.ready);
});

for (const language of ["mermaid", "mermaid-excalidraw"] as const) {
  test(`${language}: showData adds absolute legend values while percentages and sectors remain`, async ({ page }) => {
    const assertErrors = watchErrors(page);
    await page.evaluate(({ showData, noShowData, language }) => {
      window.harness.mount(showData, language); window.harness.mount(noShowData, language);
    }, { showData, noShowData, language });
    const viewers = page.locator(".mermaid-excalidraw-container");
    await expect(viewers).toHaveCount(2);
    let previous: [PieObservation, PieObservation] | null = null;
    let lightIds: string[] = [];
    for (const dark of themes) {
      await page.evaluate(dark => window.harness.theme(dark), dark);
      const values = await expectPie(page, showData, work, viewers.nth(0), dark);
      const plain = await expectPie(page, noShowData, plainWork, viewers.nth(1), dark);
      expect(values.fileId).not.toBe(plain.fileId);
      expect(values.rawFileId).not.toBe(plain.rawFileId);
      expect(values.rawGeometry.geometry.filter(node => node.tag === "path"))
        .toEqual(plain.rawGeometry.geometry.filter(node => node.tag === "path"));
      expect(values.geometry.paths.map(path => path.inside)).toEqual(plain.geometry.paths.map(path => path.inside));
      expect(values.pixels.texts.filter(text => text.kind === "legend").map(text => text.digits.map(digit => digit.text).join("")))
        .toEqual(["70", "20", "10"]);
      expect(plain.pixels.texts.filter(text => text.kind === "legend").map(text => text.digits)).toEqual([[], [], []]);
      if (previous) {
        expect(values.rawGeometry).toEqual(previous[0].rawGeometry);
        expect(plain.rawGeometry).toEqual(previous[1].rawGeometry);
        expect(values.fileId).not.toBe(previous[0].fileId);
        expect(plain.fileId).not.toBe(previous[1].fileId);
      } else lightIds = [values.fileId, plain.fileId];
      previous = [values, plain];
    }
    expect(previous!.map(observation => observation.fileId)).toEqual(lightIds);
    assertErrors();
  });
}

test("existing Usage Pie retains title, labels and percentage pixels across open-note themes", async ({ page }) => {
  const assertErrors = watchErrors(page);
  await page.evaluate(source => window.harness.mount(source), samples.pie);
  let first: PieObservation | null = null;
  for (const dark of themes) {
    await page.evaluate(dark => window.harness.theme(dark), dark);
    const observation = await expectPie(page, samples.pie, usage, undefined, dark);
    if (first) expect(observation.rawGeometry).toEqual(first.rawGeometry);
    else first = observation;
  }
  assertErrors();
});

test("zero is accepted with its legend and digit but no zero sector or percentage", async ({ page }) => {
  const assertErrors = watchErrors(page);
  await page.evaluate(source => window.harness.mount(source), zero);
  for (const dark of themes) {
    await page.evaluate(dark => window.harness.theme(dark), dark);
    const observation = await expectPie(page, zero, zeroIncluded, undefined, dark);
    expect(observation.geometry.paths[0]!.inside).toBeGreaterThan(observation.geometry.paths[1]!.inside * 2);
    expect(observation.pixels.texts.find(text => text.text === "Zero [0]")!.digits.map(digit => digit.text)).toEqual(["0"]);
    expect(observation.geometry.texts.map(text => text.text)).not.toContain("0%");
  }
  assertErrors();
});

test("two different Pies and native Flowchart isolate upstream negative and nonnumeric errors", async ({ page }) => {
  const assertErrors = watchErrors(page, 2);
  await page.evaluate(sources => sources.forEach(source => window.harness.mount(source, "mermaid")),
    [showData, secondPie, flowchart, negative, nonnumeric]);
  const viewers = page.locator(".mermaid-excalidraw-container");
  await expect(viewers).toHaveCount(5);
  await expect(viewers.filter({ has: page.getByRole("alert") })).toHaveCount(2);
  for (const [index, message] of [[3, /invalid value: -20.*Negative values are not allowed/s], [4, /nope|NUMBER_PIE/]] as const) {
    const viewer = viewers.nth(index), alert = viewer.getByRole("alert");
    await expect(viewer).toHaveAttribute("data-state", "error");
    await expect(alert.locator("strong")).toHaveText("Mermaid diagram could not be rendered.");
    await expect(alert.locator("pre")).toContainText(message);
    await expect(alert.locator("pre > *, svg, img, script, iframe")).toHaveCount(0);
    await expect(viewer.locator("canvas")).toHaveCount(0);
  }
  for (const dark of themes) {
    await page.evaluate(dark => window.harness.theme(dark), dark);
    const first = await expectPie(page, showData, work, viewers.nth(0), dark);
    const second = await expectPie(page, secondPie, roadmap, viewers.nth(1), dark);
    expect(first.rawFileId).not.toBe(second.rawFileId); expect(first.fileId).not.toBe(second.fileId);
    const scenes = await page.evaluate(() => window.harness.sceneDiagnostics());
    expect(scenes).toHaveLength(5);
    const native = scenes.find(scene => scene.source === flowchart)!;
    expect(native.raw!.elements.length).toBeGreaterThan(1);
    expect(native.raw!.elements.every(element => element.type !== "image")).toBe(true);
    expect(Object.values(native.raw!.files ?? {})).toHaveLength(0);
    expect(Object.values(native.normalized!.files)).toHaveLength(0);
    expect((await page.evaluate(source => window.harness.mountedScenes().find(scene => scene.source === source), flowchart))!.labels)
      .toEqual(expect.arrayContaining(["Native", "Neighbor"]));
    for (const source of [negative, nonnumeric]) expect(scenes.find(scene => scene.source === source))
      .toMatchObject({ state: "error", raw: null, normalized: null });
    await expectBoundedInk(viewers.nth(2));
    await expect.poll(() => viewers.nth(2).locator("canvas.static").evaluate((node, dark) => {
      if (!(node instanceof HTMLCanvasElement) || !node.width || !node.height) return false;
      const data = node.getContext("2d", { willReadFrequently: true })!.getImageData(0, 0, node.width, node.height).data;
      const background = dark ? 30 : 255;
      if (![...data.slice(0, 3)].every(channel => channel === background)) return false;
      let foreground = 0;
      for (let i = 0; i < data.length; i += 4) {
        const r = data[i]!, g = data[i + 1]!, b = data[i + 2]!;
        if (data[i + 3]! > 200 && Math.max(r, g, b) - Math.min(r, g, b) <= 5
          && (dark ? r - background > 16 : background - r > 16)) foreground++;
      }
      return foreground > 100;
    }, dark)).toBe(true);
  }
  assertErrors();
});

test("narrow pane, resize and settings redraw retain current Pie content and SVG geometry", async ({ page }) => {
  const assertErrors = watchErrors(page);
  await page.evaluate(source => window.harness.mount(source), showData);
  const first = await expectPie(page, showData, work);
  const originalData = await page.evaluateHandle(() => window.harness.mountHandles()[0]!.data);
  try {
    for (const roughness of [0, 2, 1]) {
      await page.evaluate(roughness => window.harness.updateSettings({ roughness }), roughness);
      const observation = await expectPie(page, showData, work);
      expect(observation.rawFileId).toBe(first.rawFileId);
      expect(observation.rawGeometry).toEqual(first.rawGeometry);
      expect(observation.geometry.geometry).toEqual(first.geometry.geometry);
      expect(await originalData.evaluate(data => window.harness.mountHandles()[0]!.data === data)).toBe(true);
      expect(await page.evaluate(() => {
        const cache = Reflect.get(window.harness.mountHandles()[0]!, "sceneCache") as ViewSceneCache;
        return cache.scene?.roughness;
      })).toBe(roughness);
    }
    await page.evaluate(() => window.harness.updateSettings({ canvasHeight: 360, canvasPadding: 16 }));
    for (const width of [320, 760, 1100]) {
      await page.setViewportSize({ width, height: 900 });
      const observation = await expectPie(page, showData, work);
      if (width === 320) expect(observation.pixels.registration.scale).toBeLessThan(first.pixels.registration.scale * 0.9);
      expect(observation.rawGeometry).toEqual(first.rawGeometry);
      await expect.poll(() => page.locator(".mermaid-excalidraw-container").evaluate(node => node.clientHeight)).toBe(360);
      await expectNoMenuChrome(page.locator(".mermaid-excalidraw-container"));
    }
    const opener = page.getByRole("button", { name: "Open enlarged Mermaid diagram" });
    await opener.click(); await expect(page.getByRole("dialog")).toHaveCount(1);
    await page.evaluate(() => window.harness.updateSettings({ fontSize: 28, canvasPadding: 64 }));
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expectPie(page, showData, work);
    expect(await originalData.evaluate(data => window.harness.mountHandles()[0]!.data === data)).toBe(false);
    expect(await page.evaluate(() => window.harness.savedSettings())).toMatchObject({ fontSize: 28, roughness: 1, canvasHeight: 360, canvasPadding: 64 });
    await page.evaluate(() => window.harness.theme(true));
    await expectPie(page, showData, work, undefined, true);
  } finally { await originalData.dispose(); }
  assertErrors();
});

test("note switch, remount and disable/re-enable dispose owned roots, scenes and BinaryFiles", async ({ page }) => {
  const assertErrors = watchErrors(page);
  await page.evaluate(({ showData, secondPie }) => {
    window.harness.mount(showData); window.harness.mount(secondPie);
  }, { showData, secondPie });
  await expectPie(page, showData, work);
  await expectPie(page, secondPie, roadmap, page.locator(".mermaid-excalidraw-container").nth(1));
  await page.getByRole("button", { name: "Open enlarged Mermaid diagram" }).first().click();
  const old = await holdMounts(page);
  const oldPreview = await holdPreview(page);
  try {
    await page.evaluate(() => window.harness.clear());
    await expectDisposed(old, 2);
    await expectPreviewDisposed(oldPreview, page);
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.locator("canvas")).toHaveCount(0);
    expect(await page.evaluate(() => window.harness.sceneDiagnostics())).toEqual([]);
    expect((await page.evaluate(() => window.harness.hostState())).children).toBe(0);
    await page.evaluate(source => window.harness.mount(source), samples.pie);
    await expectPie(page, samples.pie, usage);
    const beforeRerender = await holdMounts(page);
    try {
      await page.evaluate(() => window.harness.rerender());
      await expectDisposed(beforeRerender, 1);
      await expectPie(page, samples.pie, usage);
    } finally { await beforeRerender.dispose(); }
    const beforeDisable = await holdMounts(page);
    try {
      await page.getByRole("button", { name: "Open enlarged Mermaid diagram" }).click();
      await page.evaluate(() => { window.harness.setViewMode("source"); window.harness.disable(); });
      await expectDisposed(beforeDisable, 1);
      await expect(page.getByRole("dialog")).toHaveCount(0);
      await expect(page.locator("canvas")).toHaveCount(0);
      expect(await page.evaluate(() => window.harness.sceneDiagnostics())).toEqual([]);
      expect((await page.evaluate(() => window.harness.hostState())).previewInvalidated).toBe(true);
      await page.evaluate(() => window.harness.enable());
      await expect(page.locator("canvas")).toHaveCount(0);
      await page.evaluate(() => window.harness.setViewMode("preview"));
      await expectPie(page, samples.pie, usage);
      expect(await page.evaluate(() => window.harness.mountHandles().length)).toBe(1);
      expect((await page.evaluate(() => window.harness.hostState())).children).toBe(1);
    } finally { await beforeDisable.dispose(); }
    await expectDisposed(old, 2);
  } finally { await old.dispose(); await oldPreview.dispose(); }
  assertErrors();
});

test("clearing queued Pies aborts pending conversions before a replacement scene is registered", async ({ page }) => {
  const assertErrors = watchErrors(page);
  const cancelled = await page.evaluateHandle(({ showData, secondPie, usageSource }) => {
    const h = window.harness;
    h.mount(showData); h.mount(secondPie);
    const entries = h.mountHandles().map(mount => {
      const controller: unknown = Reflect.get(mount, "controller");
      if (!(controller instanceof AbortController)) throw new Error("Expected pending controller");
      return { mount, signal: controller.signal };
    });
    h.clear(); h.mount(usageSource);
    return entries;
  }, { showData, secondPie, usageSource: samples.pie });
  try {
    await expectPie(page, samples.pie, usage);
    await expectDisposed(cancelled, 2);
    expect(await page.evaluate(() => window.harness.sceneDiagnostics().map(scene => scene.source))).toEqual([samples.pie]);
    await expect(page.locator("canvas.static")).toHaveCount(1);
    await expect(page.getByRole("alert")).toHaveCount(0);
  } finally { await cancelled.dispose(); }
  assertErrors();
});

test("inline Pie remains passive while wheel scrolls the note and drag leaves the scene unchanged", async ({ page }) => {
  const assertErrors = watchErrors(page);
  await page.evaluate(({ showData, secondPie }) => {
    window.harness.mount(showData); window.harness.mount(secondPie);
  }, { showData, secondPie });
  const viewer = page.locator(".mermaid-excalidraw-container").first();
  await expectPie(page, showData, work, viewer);
  await expect(viewer.locator(".mermaid-excalidraw-passive")).toHaveAttribute("inert", "");
  await expect(viewer.locator(".mermaid-excalidraw-passive")).toHaveAttribute("aria-hidden", "true");
  await expect(viewer.getByRole("group", { name: "Diagram navigation" })).toHaveCount(0);
  await expectNoMenuChrome(viewer);
  const sources = await page.evaluate(() => window.harness.hostState().blocks);
  await page.evaluate(() => {
    Object.assign(document.querySelector("main")!.style, { overflow: "auto", height: "700px", width: "800px" });
    document.getElementById("reading")!.style.width = "1100px";
  });
  const before = await expectPie(page, showData, work, viewer);
  await viewer.hover({ position: { x: 300, y: 250 } });
  await page.mouse.wheel(0, 180);
  await expect.poll(() => page.locator("main").evaluate(node => node.scrollTop)).toBeGreaterThan(0);
  await page.mouse.wheel(160, 0);
  await expect.poll(() => page.locator("main").evaluate(node => node.scrollLeft)).toBeGreaterThan(0);
  expectSameTransform(before, await expectPie(page, showData, work, viewer));
  await page.locator("main").evaluate(node => { node.scrollTop = 0; node.scrollLeft = 0; });
  const box = await viewer.boundingBox();
  if (!box) throw new Error("Missing inline bounds");
  await page.mouse.move(box.x + 150, box.y + 150); await page.mouse.down();
  await page.mouse.move(box.x + 220, box.y + 195, { steps: 6 }); await page.mouse.up();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expectSameTransform(before, await expectPie(page, showData, work, viewer));
  const prevented = await viewer.getByRole("button", { name: "Open enlarged Mermaid diagram" }).evaluate(node => [0, 1].map(deltaMode => {
    const event = new WheelEvent("wheel", { deltaY: 4.25, deltaX: 2.5, deltaMode, bubbles: true, cancelable: true });
    node.dispatchEvent(event); return event.defaultPrevented;
  }));
  expect(prevented).toEqual([false, false]);
  expect(await page.evaluate(() => window.harness.hostState().blocks)).toEqual(sources);
  assertErrors();
});

test("both Pie previews retain five plugin controls, host focus cycle, themes, Fit and centered Reset", async ({ page }) => {
  test.setTimeout(180_000);
  const assertErrors = watchErrors(page);
  await page.evaluate(({ showData, secondPie }) => {
    window.harness.mount(showData); window.harness.mount(secondPie);
    const input = document.createElement("input"); input.id = "pie-outside-modal"; document.body.append(input);
  }, { showData, secondPie });
  const sources = await page.evaluate(() => window.harness.hostState().blocks);
  for (const [index, source, expectation] of [[0, showData, work], [1, secondPie, roadmap]] as const) {
    const inline = page.locator(".mermaid-excalidraw-container").nth(index);
    await expectPie(page, source, expectation, inline);
    const opener = inline.getByRole("button", { name: "Open enlarged Mermaid diagram" });
    await opener.focus(); await page.keyboard.press(index === 0 ? "Enter" : "Space");
    const modal = page.getByRole("dialog", { name: "Mermaid diagram preview" });
    await expect(modal).toHaveCount(1);
    const viewer = modal.locator(".mermaid-excalidraw-enlarged");
    const preview = await holdPreview(page);
    const group = modal.getByRole("group", { name: "Diagram navigation" });
    await expect(group.getByRole("button")).toHaveCount(5);
    const controls = [modal.getByRole("button", { name: "Close dialog", exact: true }),
      group.getByRole("button", { name: "Zoom out", exact: true }), group.getByRole("button", { name: "Zoom in", exact: true }),
      group.getByRole("button", { name: "Fit to content", exact: true }), group.getByRole("button", { name: "Reset zoom", exact: true }),
      group.getByRole("button", { name: "Close preview", exact: true })];
    for (const width of [1100, 600]) {
      await page.setViewportSize({ width, height: 900 });
      await expectPie(page, source, expectation, viewer);
      await expectNoMenuChrome(viewer);
      await controls[0]!.focus();
      for (let i = 1; i <= controls.length; i++) {
        await page.keyboard.press("Tab"); await expect(controls[i % controls.length]!).toBeFocused();
        await expect(page.locator("#pie-outside-modal")).not.toBeFocused();
      }
      for (let i = controls.length - 1; i >= 0; i--) {
        await page.keyboard.press("Shift+Tab"); await expect(controls[i]!).toBeFocused();
      }
    }
    await page.setViewportSize({ width: 1100, height: 900 });
    for (const dark of themes) {
      await page.evaluate(dark => window.harness.theme(dark), dark);
      await expectPie(page, source, expectation, viewer, dark);
      await expectNoMenuChrome(viewer);
    }
    const fitted = await expectPie(page, source, expectation, viewer);
    const level = modal.getByLabel("Zoom level");
    const fitLevel = await level.textContent();
    await controls[2]!.click();
    await expect(level).not.toHaveText(fitLevel!);
    const zoomed = await expectPie(page, source, expectation, viewer);
    expect(zoomed.pixels.registration.scale).toBeGreaterThan(fitted.pixels.registration.scale * 1.1);
    await pan(page, viewer);
    const panned = await expectPie(page, source, expectation, viewer);
    expect(Math.abs(panned.pixels.registration.x - zoomed.pixels.registration.x)).toBeGreaterThan(30);
    await controls[3]!.focus(); await page.keyboard.press("Enter");
    await expect(level).toHaveText(fitLevel!);
    expectSameTransform(fitted, await expectPie(page, source, expectation, viewer));
    await controls[4]!.click(); await expect(level).toHaveText("100%");
    const centered = await expectPie(page, source, expectation, viewer);
    expectCentered(centered);
    for (const [direction, value, activation] of [[1, "83%", "pointer"], [2, "120%", "keyboard"]] as const) {
      await controls[direction]!.click(); await expect(level).toHaveText(value);
      await pan(page, viewer);
      await expectPie(page, source, expectation, viewer);
      if (activation === "pointer") await controls[4]!.click();
      else { await controls[4]!.focus(); await page.keyboard.press("Space"); }
      await expect(level).toHaveText("100%");
      const reset = await expectPie(page, source, expectation, viewer);
      expectCentered(reset); expectSameTransform(centered, reset);
    }
    if (index === 0) { await controls[5]!.focus(); await page.keyboard.press("Space"); }
    else await page.keyboard.press("Escape");
    await expect(modal).toHaveCount(0); await expect(opener).toBeFocused();
    await expectPreviewDisposed(preview, page); await preview.dispose();
    await expectPie(page, source, expectation, inline);
    expect(await page.evaluate(() => window.harness.hostState().blocks)).toEqual(sources);
  }
  assertErrors();
});
