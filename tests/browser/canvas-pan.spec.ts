import { expect, test, type Locator, type Page } from "@playwright/test";
import { fitState, observeFitAPI } from "./auto-fit-helpers";

async function inkBounds(viewer: Locator) {
  return viewer.locator("canvas.static").evaluate(node => {
    // React can create an adopted canvas in the importing window's realm.
    const canvas = node as HTMLCanvasElement;
    const pixels = canvas.getContext("2d")!.getImageData(0, 0, canvas.width, canvas.height).data;
    let left = canvas.width, top = canvas.height, right = -1, bottom = -1;
    for (let i = 0; i < pixels.length; i += 4) {
      if (pixels[i + 3]! > 200 && Math.abs(pixels[i]! - pixels[0]!) > 16) {
        const x = (i / 4) % canvas.width, y = Math.floor(i / 4 / canvas.width);
        left = Math.min(left, x); right = Math.max(right, x);
        top = Math.min(top, y); bottom = Math.max(bottom, y);
      }
    }
    const scale = canvas.width / canvas.getBoundingClientRect().width;
    return { left: left / scale, top: top / scale, right: right / scale, bottom: bottom / scale };
  });
}

async function openPreview(page: Page, foreign: boolean, source = "flowchart LR\nA[Anchor] --> B[Pan] --> C[Preview]") {
  await observeFitAPI(page);
  await page.goto("/"); await page.evaluate(() => window.ready);
  await page.evaluate(({ foreign, source }) => {
    window.harness.useAdoptedModals();
    if (foreign) window.harness.mountInFrame(source);
    else window.harness.mount(source);
  }, { foreign, source });
  const root = foreign ? page.frameLocator("#popout-fixture") : page;
  await expect(root.locator('[data-state="ready"]')).toHaveCount(1);
  const opener = root.getByRole("button", { name: "Open enlarged Mermaid diagram" });
  await opener.click();
  const viewer = root.locator(".mermaid-excalidraw-enlarged");
  await viewer.getByRole("button", { name: "Reset zoom", exact: true }).click();
  await expect.poll(async () => (await fitState(page, 1))?.zoom).toBe(1);
  await expect.poll(async () => (await inkBounds(viewer)).right).toBeGreaterThan(0);
  await page.waitForTimeout(100);
  return { viewer, opener, canvas: viewer.locator("canvas.interactive") };
}

for (const scenario of [
  { name: "main mouse", foreign: false, pen: false, button: "left" },
  { name: "foreign adopted Modal mouse", foreign: true, pen: false, button: "left" },
  { name: "foreign middle mouse", foreign: true, pen: false, button: "middle" },
  { name: "foreign SVG pen", foreign: true, pen: true, button: "left" },
] as const) test(`${scenario.name} pan moves actual ink exactly once`, async ({ page }, info) => {
  const { viewer, canvas } = await openPreview(page, scenario.foreign,
    scenario.pen ? "classDiagram\nclass Fixture {\n +String name\n}" : undefined);
  const state = (await fitState(page, 1))!, ink = await inkBounds(viewer);
  const note = await canvas.evaluate(node => ({ x: node.ownerDocument.defaultView!.scrollX,
    y: node.ownerDocument.defaultView!.scrollY }));
  const box = (await canvas.boundingBox())!;
  if (scenario.pen) {
    const cdp = await page.context().newCDPSession(page);
    try {
      await cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", x: box.x + 120, y: box.y + 100,
        button: "left", buttons: 1, clickCount: 1, pointerType: "pen" });
      await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: box.x + 180, y: box.y + 130,
        button: "left", buttons: 1, pointerType: "pen" });
      await cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: box.x + 180, y: box.y + 130,
        button: "left", buttons: 0, clickCount: 1, pointerType: "pen" });
    } finally { await cdp.detach(); }
  } else {
    await page.mouse.move(box.x + 120, box.y + 100); await page.mouse.down({ button: scenario.button });
    await page.mouse.move(box.x + 180, box.y + 130, { steps: 8 }); await page.mouse.up({ button: scenario.button });
  }
  await expect.poll(async () => (await inkBounds(viewer)).left - ink.left).toBeCloseTo(60, 0);
  await expect.poll(async () => (await inkBounds(viewer)).top - ink.top).toBeCloseTo(30, 0);
  const after = (await fitState(page, 1))!;
  expect(after.zoom).toBe(state.zoom);
  expect(after.scrollX - state.scrollX).toBeCloseTo(60, 5);
  expect(after.scrollY - state.scrollY).toBeCloseTo(30, 5);
  expect(await canvas.evaluate(node => ({ x: node.ownerDocument.defaultView!.scrollX,
    y: node.ownerDocument.defaultView!.scrollY }))).toEqual(note);
  await page.mouse.move(box.x + 210, box.y + 150);
  expect(await fitState(page, 1)).toEqual(after);
  await info.attach("foreign-pan-public-state-and-ink", { body: JSON.stringify({ state, after, ink,
    inkAfter: await inkBounds(viewer) }), contentType: "application/json" });
});

test("foreign pan cancels on capture loss, blur, close and pagehide without stale movement", async ({ page }) => {
  const { viewer, opener, canvas } = await openPreview(page, true);
  const box = (await canvas.boundingBox())!;
  for (const reason of ["capture", "blur"] as const) {
    await canvas.evaluate(node => node.ownerDocument.addEventListener("pointerdown", event => {
      Reflect.set(node, "testPanId", (event as PointerEvent).pointerId);
    }, { capture: true, passive: true, once: true }));
    await page.mouse.move(box.x + 120, box.y + 100); await page.mouse.down();
    await page.mouse.move(box.x + 140, box.y + 110, { steps: 2 });
    const before = await fitState(page, 1);
    await canvas.evaluate((node, reason) => {
      if (reason === "capture") node.releasePointerCapture(Reflect.get(node, "testPanId") as number);
      else {
        const win = node.ownerDocument.defaultView!;
        const EventConstructor = Reflect.get(win, "Event") as typeof Event;
        win.dispatchEvent(new EventConstructor("blur"));
      }
    }, reason);
    await page.mouse.move(box.x + 180, box.y + 130, { steps: 4 }); await page.mouse.up();
    expect(await fitState(page, 1)).toEqual(before);
  }
  await page.mouse.move(box.x + 120, box.y + 100); await page.mouse.down();
  await page.keyboard.press("Escape"); await expect(viewer).toHaveCount(0);
  await expect(opener).toBeFocused();
  const disposed = await fitState(page, 1);
  await page.mouse.move(box.x + 180, box.y + 130); await page.mouse.up();
  expect(await fitState(page, 1)).toEqual(disposed);
  await opener.click();
  await expect(viewer).toHaveCount(1);
  await viewer.getByRole("button", { name: "Reset zoom" }).click();
  await expect.poll(async () => (await fitState(page, 2))?.zoom).toBe(1);
  const freshBox = (await canvas.boundingBox())!;
  await page.mouse.move(freshBox.x + 120, freshBox.y + 100); await page.mouse.down();
  await canvas.evaluate(node => {
    const win = node.ownerDocument.defaultView!;
    const EventConstructor = Reflect.get(win, "Event") as typeof Event;
    win.dispatchEvent(new EventConstructor("pagehide"));
  });
  await expect(viewer).toHaveCount(0);
  const hidden = await fitState(page, 2);
  await page.mouse.move(freshBox.x + 180, freshBox.y + 130); await page.mouse.up();
  expect(await fitState(page, 2)).toEqual(hidden);
  await page.evaluate(() => window.harness.disable());
  await expect(page.frameLocator("#popout-fixture").locator("canvas")).toHaveCount(0);
});

for (const foreign of [false, true]) test(`${foreign ? "foreign" : "main"}: rejected right-button pan over a native link stays inert and error-free`, async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  const { canvas } = await openPreview(page, foreign,
    'flowchart LR\nA[Linked] --> B[Other]\nclick A "./target"');
  const link = await page.evaluate(() => {
    const api = window.fitApis[1]!, s = api.getAppState();
    const element = api.getSceneElements().find(e => e.link)!;
    return { link: element.link, x: (element.x + element.width / 2 + s.scrollX) * s.zoom.value,
      y: (element.y + element.height / 2 + s.scrollY) * s.zoom.value };
  });
  expect(link.link).toBeTruthy();
  await canvas.hover({ position: link });
  await expect(canvas).toHaveCSS("cursor", "pointer");
  const before = await fitState(page, 1), url = page.url();
  // This is the first canvas down: upstream has no previous down event.
  await canvas.click({ position: link, button: "right" });
  expect(errors).toEqual([]);
  expect(await fitState(page, 1)).toEqual(before);
  expect(page.url()).toBe(url);
  expect(page.context().pages()).toHaveLength(1);
});
