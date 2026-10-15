import { expect, test, type Locator, type Page, type TestInfo } from "@playwright/test";
import { expectFit, fitInk, fitState, observeFitAPI } from "./auto-fit-helpers";
import { samples } from "./samples";
import { twoSets } from "./venn-fixtures";

const fixture = "flowchart LR\nA[Anchor] --> B[Zoom] --> C[Preview]";

test.beforeEach(async ({ page }) => {
  await observeFitAPI(page);
  await page.goto("/"); await page.evaluate(() => window.ready);
  await page.evaluate(async () => { await document.fonts.load("20px Virgil"); await document.fonts.ready; });
});

async function openPreview(page: Page, source = fixture) {
  await page.evaluate(source => {
    const main = document.querySelector<HTMLElement>("main")!;
    Object.assign(main.style, { overflow: "auto", height: "700px", width: "800px" });
    document.body.style.minHeight = "2200px";
    document.getElementById("reading")!.style.width = "1100px";
    window.harness.mount(source);
  }, source);
  const inline = page.locator(".mermaid-excalidraw-container").first();
  await expect(inline).toHaveAttribute("data-state", "ready");
  await expectFit(page, inline, 0, 3);
  await page.evaluate(() => window.harness.mount("flowchart TB\nA[Additional note content] --> B[Allows note scrolling]"));
  await expect(page.locator('[data-state="ready"]')).toHaveCount(2);
  await inline.getByRole("button").click();
  const viewer = page.locator(".mermaid-excalidraw-enlarged");
  await expectFit(page, viewer, 2, 4);
  await page.evaluate(() => {
    const main = document.querySelector("main")!; main.scrollTop = 120; main.scrollLeft = 70;
    window.scrollTo(0, 180);
  });
  return { viewer, canvas: viewer.locator("canvas.interactive"), index: 2 };
}

async function noteScroll(page: Page) {
  return page.evaluate(() => ({ x: window.scrollX, y: window.scrollY,
    mainX: document.querySelector("main")!.scrollLeft, mainY: document.querySelector("main")!.scrollTop }));
}

async function dispatchWheel(target: Locator, deltaY: number, deltaMode = 0, ctrlKey = false, deltaX = 0) {
  return target.evaluate((node, init) => {
    const rect = node.getBoundingClientRect();
    const event = new WheelEvent("wheel", { ...init, clientX: rect.x + rect.width / 2,
      clientY: rect.y + rect.height / 2, bubbles: true, cancelable: true });
    node.dispatchEvent(event); return event.defaultPrevented;
  }, { deltaY, deltaMode, ctrlKey, deltaX });
}

test("modal wheel changes actual zoom and ink while the background note stays still", async ({ page }, info) => {
  const { viewer, canvas, index } = await openPreview(page);
  const before = (await fitState(page, index))!, inkBefore = (await fitInk(viewer))!, note = await noteScroll(page);
  await canvas.hover({ position: { x: before.width / 2, y: before.height / 2 } });
  await page.mouse.wheel(0, -100);
  await expect.poll(async () => (await fitState(page, index))?.zoom).toBeGreaterThan(before.zoom);
  await expect.poll(async () => {
    const ink = (await fitInk(viewer))!;
    return Math.abs((ink.right - ink.left) - (inkBefore.right - inkBefore.left));
  }).toBeGreaterThan(10);
  const up = (await fitState(page, index))!, inkUp = (await fitInk(viewer))!;
  expect(await noteScroll(page)).toEqual(note);
  await page.mouse.wheel(0, 100);
  await expect.poll(async () => (await fitState(page, index))?.zoom).toBeLessThan(up.zoom);
  await expect.poll(async () => {
    const ink = (await fitInk(viewer))!;
    return Math.abs((ink.right - ink.left) - (inkUp.right - inkUp.left));
  }).toBeGreaterThan(10);
  expect(await noteScroll(page)).toEqual(note);
  await info.attach("modal-wheel-public-api-and-render", { body: JSON.stringify({ before, up,
    down: await fitState(page, index), inkBefore, inkUp, inkDown: await fitInk(viewer), note }), contentType: "application/json" });
});

test("controls and header contain wheel without zoom; canvas horizontal wheel stays inert", async ({ page }) => {
  const { viewer, canvas, index } = await openPreview(page);
  const before = await fitState(page, index), note = await noteScroll(page);
  const modal = page.getByRole("dialog");
  for (const target of [viewer.getByRole("button", { name: "Zoom in", exact: true }),
    viewer.getByRole("button", { name: "Fit to content", exact: true }),
    viewer.getByRole("button", { name: "Reset zoom", exact: true }),
    viewer.getByRole("button", { name: "Close preview", exact: true }),
    modal.locator(".modal-title"), modal.locator(".modal-close-button")]) {
    await target.hover(); await page.mouse.wheel(0, -100);
    await page.waitForTimeout(50);
    expect(await fitState(page, index)).toEqual(before);
    expect(await noteScroll(page)).toEqual(note);
    await expect(modal).toHaveCount(1);
  }
  expect(await dispatchWheel(canvas, 0, 0, false, 100)).toBe(true);
  expect(await fitState(page, index)).toEqual(before);
  // The host keeps ownership of targets outside the plugin viewer.
  const outsidePrevented = await page.locator("main").evaluate(node => {
    const event = new WheelEvent("wheel", { deltaY: 100, bubbles: true, cancelable: true });
    node.dispatchEvent(event); return event.defaultPrevented;
  });
  expect(outsidePrevented).toBe(false);
});

test("pixel, line and page wheels keep direction and per-event bounds; zoom limits stay finite", async ({ page }) => {
  const { viewer, canvas, index } = await openPreview(page);
  const reset = viewer.getByRole("button", { name: "Reset zoom", exact: true });
  for (const [deltaMode, magnitude] of [[0, 0.5], [0, 100000], [1, 1], [2, 1]] as const) {
    await reset.click(); await expect.poll(async () => (await fitState(page, index))?.zoom).toBe(1);
    expect(await dispatchWheel(canvas, -magnitude, deltaMode)).toBe(true);
    await expect.poll(async () => (await fitState(page, index))?.zoom).toBeGreaterThan(1);
    const up = (await fitState(page, index))!.zoom;
    expect(up).toBeLessThanOrEqual(1.2 + 1e-10);
    await dispatchWheel(canvas, magnitude, deltaMode);
    await expect.poll(async () => (await fitState(page, index))?.zoom).toBeCloseTo(1, 8);
  }
  for (const [direction, expected] of [[-100, 30], [100, 0.1]] as const) {
    await canvas.evaluate((node, deltaY) => {
      const box = node.getBoundingClientRect();
      for (let i = 0; i < 55; i++) node.dispatchEvent(new WheelEvent("wheel", { deltaY,
        clientX: box.x + box.width / 2, clientY: box.y + box.height / 2, bubbles: true, cancelable: true }));
    }, direction);
    await expect.poll(async () => (await fitState(page, index))?.zoom).toBe(expected);
    const state = (await fitState(page, index))!;
    expect([state.zoom, state.scrollX, state.scrollY].every(Number.isFinite)).toBe(true);
  }
});

test("one synchronous ctrl-wheel burst accumulates every event once at moving pointer anchors", async ({ page }, info) => {
  const { viewer, canvas, index } = await openPreview(page);
  await viewer.getByRole("button", { name: "Reset zoom", exact: true }).click();
  await expect.poll(async () => (await fitState(page, index))?.zoom).toBe(1);
  const before = (await fitState(page, index))!;
  const burst = await canvas.evaluate((node, index) => {
    const box = node.getBoundingClientRect(), api = window.fitApis[index]!;
    const states = [];
    for (let i = 0; i < 20; i++) {
      const x = 130 + i * 12, y = 90 + i * 7;
      const event = new WheelEvent("wheel", { deltaY: -5, ctrlKey: true, clientX: box.x + x,
        clientY: box.y + y, bubbles: true, cancelable: true });
      node.dispatchEvent(event);
      const s = api.getAppState(); states.push({ x: event.clientX - box.x, y: event.clientY - box.y,
        zoom: s.zoom.value, scrollX: s.scrollX, scrollY: s.scrollY });
    }
    return states;
  }, index);
  let expected: { zoom: number; scrollX: number; scrollY: number } = {
    zoom: before.zoom, scrollX: before.scrollX, scrollY: before.scrollY };
  for (const state of burst) {
    const next = expected.zoom * Math.exp(5 * Math.log(1.2) / 100);
    expected = { zoom: next, scrollX: expected.scrollX + state.x / next - state.x / expected.zoom,
      scrollY: expected.scrollY + state.y / next - state.y / expected.zoom };
    expect(state.zoom).toBeCloseTo(expected.zoom, 10);
    expect(state.scrollX).toBeCloseTo(expected.scrollX, 8);
    expect(state.scrollY).toBeCloseTo(expected.scrollY, 8);
  }
  await expect.poll(async () => (await fitState(page, index))?.zoom).toBeCloseTo(1.2, 10);
  await info.attach("synchronous-wheel-public-state", { body: JSON.stringify({ before, burst, expected,
    after: await fitState(page, index) }), contentType: "application/json" });
});

async function expectAnchoredInk(page: Page, info: TestInfo) {
  const { viewer, canvas, index } = await openPreview(page);
  const evidence = [];
  for (const corner of ["top-left", "bottom-right"] as const) {
    await viewer.getByRole("button", { name: "Reset zoom", exact: true }).click();
    await expect.poll(async () => (await fitState(page, index))?.zoom).toBe(1);
    await expect.poll(async () => (await fitInk(viewer))?.count ?? 0).toBeGreaterThan(100);
    // Wait for the rendered scale to catch up with the public state before
    // selecting a visible, stable outer-ink landmark.
    await page.waitForTimeout(100);
    const ink = (await fitInk(viewer))!, before = (await fitState(page, index))!;
    const requestedAnchor = corner === "top-left" ? { x: ink.left + 6, y: ink.top + 6 }
      : { x: ink.right - 6, y: ink.bottom - 6 };
    await canvas.evaluate(node => {
      node.ownerDocument.addEventListener("wheel", event => {
        const box = node.getBoundingClientRect();
        Reflect.set(node, "observedWheelAnchor", { x: event.clientX - box.x, y: event.clientY - box.y });
      }, { capture: true, passive: true, once: true });
    });
    await canvas.hover({ position: requestedAnchor }); await page.mouse.wheel(0, -100);
    const anchor = await canvas.evaluate(node => Reflect.get(node, "observedWheelAnchor") as { x: number; y: number });
    expect(Math.abs(anchor.x - requestedAnchor.x)).toBeLessThan(1);
    expect(Math.abs(anchor.y - requestedAnchor.y)).toBeLessThan(1);
    await expect.poll(async () => (await fitState(page, index))?.zoom).toBeGreaterThan(before.zoom);
    const after = (await fitState(page, index))!, ratio = after.zoom / before.zoom;
    const predicted = { left: anchor.x + (ink.left - anchor.x) * ratio,
      right: anchor.x + (ink.right - anchor.x) * ratio,
      top: anchor.y + (ink.top - anchor.y) * ratio,
      bottom: anchor.y + (ink.bottom - anchor.y) * ratio };
    await expect.poll(async () => {
      const rendered = (await fitInk(viewer))!;
      return Math.max(...(["left", "right", "top", "bottom"] as const).map(edge => Math.abs(rendered[edge] - predicted[edge])));
    }).toBeLessThan(4);
    expect(anchor.x / after.zoom - after.scrollX).toBeCloseTo(anchor.x / before.zoom - before.scrollX, 7);
    expect(anchor.y / after.zoom - after.scrollY).toBeCloseTo(anchor.y / before.zoom - before.scrollY, 7);
    evidence.push({ corner, anchor, before, after, ink, predicted, rendered: await fitInk(viewer) });
  }
  const maxInkDrift = Math.max(...evidence.flatMap(entry => (["left", "right", "top", "bottom"] as const)
    .map(edge => Math.abs(entry.rendered![edge] - entry.predicted[edge]))));
  console.log("wheel anchor ink evidence", JSON.stringify({ devicePixelRatio: await page.evaluate(() => window.devicePixelRatio), maxInkDrift }));
  await info.attach("pointer-anchor-ink-landmarks", { body: JSON.stringify(evidence), contentType: "application/json" });
}

test("off-center wheel anchors preserve actual ink landmarks in CSS pixels", async ({ page }, info) => {
  await expectAnchoredInk(page, info);
});

test.describe("high-density canvas", () => {
  test.use({ deviceScaleFactor: 2 });
  test("off-center anchors preserve ink at DPR 2 with the note scrolled", async ({ page }, info) => {
    expect(await page.evaluate(() => window.devicePixelRatio)).toBe(2);
    await expectAnchoredInk(page, info);
  });
});

test("wheel navigation survives Fit, Reset, theme updates, buttons, mouse pan and pen pan", async ({ page }) => {
  const { viewer, canvas, index } = await openPreview(page);
  const fitted = (await fitState(page, index))!;
  await dispatchWheel(canvas, 100);
  await expect.poll(async () => (await fitState(page, index))?.zoom).toBeLessThan(fitted.zoom);
  await viewer.getByRole("button", { name: "Fit to content", exact: true }).click();
  await expectFit(page, viewer, index, 4);
  await dispatchWheel(canvas, -100);
  await viewer.getByRole("button", { name: "Reset zoom", exact: true }).click();
  await expect.poll(async () => (await fitState(page, index))?.zoom).toBe(1);
  await dispatchWheel(canvas, -100);
  await expect.poll(async () => (await fitState(page, index))?.zoom).toBeCloseTo(1.2, 8);
  for (const dark of [true, false]) {
    const manual = await fitState(page, index);
    await page.evaluate(dark => window.harness.theme(dark), dark);
    await page.waitForTimeout(100);
    expect(await fitState(page, index)).toEqual(manual);
    await dispatchWheel(canvas, 5, 0, true);
    await expect.poll(async () => (await fitState(page, index))?.zoom).toBeLessThan(manual!.zoom);
    await viewer.getByRole("button", { name: "Zoom in", exact: true }).click();
    await expect.poll(async () => (await fitState(page, index))?.zoom).toBeGreaterThan(manual!.zoom);
  }
  const box = (await canvas.boundingBox())!;
  const mouseBefore = (await fitState(page, index))!;
  await page.mouse.move(box.x + 130, box.y + 100); await page.mouse.down();
  await page.mouse.move(box.x + 200, box.y + 140, { steps: 5 }); await page.mouse.up();
  await expect.poll(async () => (await fitState(page, index))?.scrollX).not.toBe(mouseBefore.scrollX);
  const penBefore = (await fitState(page, index))!;
  // Trusted browser/CDP pen input is regression evidence, never physical input evidence.
  const cdp = await page.context().newCDPSession(page);
  try {
    await cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", x: box.x + 180, y: box.y + 130,
      button: "left", buttons: 1, clickCount: 1, pointerType: "pen" });
    await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: box.x + 230, y: box.y + 160,
      button: "left", buttons: 1, pointerType: "pen" });
    await cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: box.x + 230, y: box.y + 160,
      button: "left", buttons: 0, clickCount: 1, pointerType: "pen" });
    await expect.poll(async () => (await fitState(page, index))?.scrollX).not.toBe(penBefore.scrollX);
  } finally { await cdp.detach(); }
});

for (const [name, source] of [["Sequence", samples.sequence], ["Class SVG", samples.class],
  ["Pie SVG", samples.pie], ["Venn SVG", twoSets]] as const) {
  test(`${name}: scene viewport wheel zoom changes rendered ink`, async ({ page }) => {
    const { viewer, canvas, index } = await openPreview(page, source);
    await viewer.getByRole("button", { name: "Reset zoom", exact: true }).click();
    await expect.poll(async () => (await fitState(page, index))?.zoom).toBe(1);
    await page.waitForTimeout(100);
    const before = (await fitState(page, index))!, ink = (await fitInk(viewer))!;
    await dispatchWheel(canvas, -80, 0, true);
    await expect.poll(async () => (await fitState(page, index))?.zoom).toBeGreaterThan(before.zoom);
    await expect.poll(async () => {
      const next = (await fitInk(viewer))!;
      return Math.abs((next.right - next.left) - (ink.right - ink.left));
    }).toBeGreaterThan(5);
    await viewer.getByRole("button", { name: "Fit to content", exact: true }).click();
    await expectFit(page, viewer, index, 4);
  });
}

test("replacement removes old canvas wheel listeners and never doubles the new preview zoom", async ({ page }) => {
  const { canvas, index } = await openPreview(page);
  const retained = await canvas.elementHandle();
  const retainedRoot = await page.locator(".mermaid-excalidraw-modal").elementHandle();
  // The second note's opener replaces the active preview through the renderer.
  await page.getByRole("button", { name: "Open enlarged Mermaid diagram" }).nth(1).evaluate(node => (node as HTMLButtonElement).click());
  await expect(page.getByRole("dialog")).toHaveCount(1);
  const viewer = page.locator(".mermaid-excalidraw-enlarged"), current = viewer.locator("canvas.interactive");
  await expectFit(page, viewer, 3, 4);
  const disposedState = await page.evaluate(index => {
    const state = window.fitApis[index]!.getAppState();
    return { zoom: state.zoom.value, scrollX: state.scrollX, scrollY: state.scrollY };
  }, index);
  const prevented = await retained!.evaluate(node => {
    const event = new WheelEvent("wheel", { deltaY: -100, bubbles: true, cancelable: true });
    node.dispatchEvent(event); return event.defaultPrevented;
  });
  expect(prevented).toBe(false);
  expect(await retainedRoot!.evaluate(node => {
    const event = new WheelEvent("wheel", { deltaY: -100, bubbles: true, cancelable: true });
    node.dispatchEvent(event); return event.defaultPrevented;
  })).toBe(false);
  expect(await page.evaluate(index => {
    const state = window.fitApis[index]!.getAppState();
    return { zoom: state.zoom.value, scrollX: state.scrollX, scrollY: state.scrollY };
  }, index)).toEqual(disposedState);
  const before = (await fitState(page, 3))!;
  await dispatchWheel(current, -100, 0, true);
  await expect.poll(async () => (await fitState(page, 3))?.zoom).toBeCloseTo(before.zoom * 1.2, 8);
  await page.keyboard.press("Escape"); await expect(page.getByRole("dialog")).toHaveCount(0);
  await retained!.dispose();
  await retainedRoot!.dispose();
});
