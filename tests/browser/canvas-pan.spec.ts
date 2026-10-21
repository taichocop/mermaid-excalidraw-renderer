import { expect, test, type Locator, type Page } from "@playwright/test";
import { expectFit, fitState, observeFitAPI } from "./auto-fit-helpers";

async function cursorState(canvas: Locator) {
  return canvas.evaluate(node => ({
    value: (node as HTMLElement).style.getPropertyValue("cursor"),
    priority: (node as HTMLElement).style.getPropertyPriority("cursor"),
    computed: node.ownerDocument.defaultView!.getComputedStyle(node).cursor,
  }));
}

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
  { name: "main middle mouse", foreign: false, pen: false, button: "middle" },
  { name: "main SVG pen", foreign: false, pen: true, button: "left" },
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
  await page.mouse.move(box.x + 120, box.y + 100);
  const cursorBefore = await cursorState(canvas);
  if (scenario.pen) {
    const cdp = await page.context().newCDPSession(page);
    try {
      await cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", x: box.x + 120, y: box.y + 100,
        button: "left", buttons: 1, clickCount: 1, pointerType: "pen" });
      await expect(canvas).toHaveCSS("cursor", "grabbing");
      await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: box.x + 180, y: box.y + 130,
        button: "left", buttons: 1, pointerType: "pen" });
      await cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: box.x + 180, y: box.y + 130,
        button: "left", buttons: 0, clickCount: 1, pointerType: "pen" });
    } finally { await cdp.detach(); }
  } else {
    await page.mouse.down({ button: scenario.button });
    await expect(canvas).toHaveCSS("cursor", "grabbing");
    await page.mouse.move(box.x + 180, box.y + 130, { steps: 8 }); await page.mouse.up({ button: scenario.button });
  }
  expect(await cursorState(canvas)).toEqual(cursorBefore);
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
    inkAfter: await inkBounds(viewer), cursorBefore, cursorAfter: await cursorState(canvas) }), contentType: "application/json" });
});

for (const foreign of [false, true]) test(`${foreign ? "foreign" : "main"} pan cancels on pointercancel, capture loss, blur, Escape and pagehide without stale movement`, async ({ page }) => {
  const { viewer, opener, canvas } = await openPreview(page, foreign);
  const box = (await canvas.boundingBox())!;
  for (const reason of ["pointercancel", "capture", "blur"] as const) {
    await canvas.evaluate(node => node.ownerDocument.addEventListener("pointerdown", event => {
      Reflect.set(node, "testPanId", (event as PointerEvent).pointerId);
    }, { capture: true, passive: true, once: true }));
    await page.mouse.move(box.x + 120, box.y + 100);
    const cursorBefore = await cursorState(canvas);
    await page.mouse.down();
    await expect(canvas).toHaveCSS("cursor", "grabbing");
    await page.mouse.move(box.x + 140, box.y + 110, { steps: 2 });
    const before = await fitState(page, 1);
    await canvas.evaluate((node, reason) => {
      if (reason === "capture") node.releasePointerCapture(Reflect.get(node, "testPanId") as number);
      else if (reason === "pointercancel") {
        const PointerConstructor = Reflect.get(node.ownerDocument.defaultView!, "PointerEvent") as typeof PointerEvent;
        node.dispatchEvent(new PointerConstructor("pointercancel", { pointerId: Reflect.get(node, "testPanId") as number,
          pointerType: "mouse", bubbles: true, cancelable: true }));
      } else {
        const win = node.ownerDocument.defaultView!;
        const EventConstructor = Reflect.get(win, "Event") as typeof Event;
        win.dispatchEvent(new EventConstructor("blur"));
      }
    }, reason);
    // Native lostpointercapture is delivered at the next pointer dispatch.
    if (reason === "capture") await page.mouse.move(box.x + 140, box.y + 110);
    if (reason === "capture") await expect(canvas).not.toHaveCSS("cursor", "grabbing");
    else expect(await cursorState(canvas)).toEqual(cursorBefore);
    await page.mouse.move(box.x + 180, box.y + 130, { steps: 4 }); await page.mouse.up();
    expect(await fitState(page, 1)).toEqual(before);
  }
  await page.mouse.move(box.x + 120, box.y + 100);
  const retained = await canvas.elementHandle(), cursorBeforeClose = await cursorState(canvas);
  await page.mouse.down();
  await expect(canvas).toHaveCSS("cursor", "grabbing");
  await page.keyboard.press("Escape"); await expect(viewer).toHaveCount(0);
  await expect(opener).toBeFocused();
  expect(await retained!.evaluate(node => ({ value: (node as HTMLElement).style.getPropertyValue("cursor"),
    priority: (node as HTMLElement).style.getPropertyPriority("cursor") }))).toEqual({
    value: cursorBeforeClose.value, priority: cursorBeforeClose.priority,
  });
  await retained!.dispose();
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
  const root = foreign ? page.frameLocator("#popout-fixture") : page;
  await expect(root.locator("canvas")).toHaveCount(0);
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

for (const foreign of [false, true]) test(`${foreign ? "foreign" : "main"}: cursor helper overrides inline cursors and restores their values and priorities`, async ({ page }, info) => {
  const { canvas } = await openPreview(page, foreign);
  const box = (await canvas.boundingBox())!;
  const evidence = [];
  for (const [value, priority] of [["", ""], ["default", ""], ["grab", ""], ["pointer", ""],
    ["crosshair", ""], ["pointer", "important"]]) {
    await page.mouse.move(box.x + 120, box.y + 100);
    await canvas.evaluate((node, cursor) => {
      (node as HTMLElement).style.setProperty("cursor", cursor.value!, cursor.priority);
      node.classList.add("other-plugin-fixture");
    }, { value, priority });
    const before = await cursorState(canvas);
    await page.mouse.down();
    await expect(canvas).toHaveCSS("cursor", "grabbing");
    const during = await cursorState(canvas);
    await page.mouse.move(box.x + 140, box.y + 110, { steps: 2 });
    await page.mouse.up();
    expect(await cursorState(canvas)).toEqual(before);
    await expect(canvas).toHaveClass(/other-plugin-fixture/);
    evidence.push({ before, during, after: await cursorState(canvas) });
  }
  await info.attach("cursor-values-priorities-and-ownership", { body: JSON.stringify(evidence), contentType: "application/json" });
});

test("normal class specificity cannot override the upstream canvas inline cursor", async ({ page }, info) => {
  const { canvas } = await openPreview(page, false);
  const observed = await canvas.evaluate(node => {
    const style = node.ownerDocument.createElement("style");
    style.textContent = ".mermaid-excalidraw-modal .mermaid-excalidraw-enlarged .mermaid-excalidraw-canvas canvas.interactive.cursor-probe { cursor: grabbing; }";
    node.ownerDocument.head.append(style);
    node.classList.add("cursor-probe");
    const before = (node as HTMLElement).style.getPropertyValue("cursor");
    const values = ["default", "grab", "pointer", "crosshair"].map(value => {
      (node as HTMLElement).style.setProperty("cursor", value);
      return { inline: value, classOnlyComputed: node.ownerDocument.defaultView!.getComputedStyle(node).cursor };
    });
    (node as HTMLElement).style.setProperty("cursor", before);
    node.classList.remove("cursor-probe"); style.remove();
    return { upstreamInline: before, values };
  });
  for (const value of observed.values) expect(value.classOnlyComputed).toBe(value.inline);
  await info.attach("class-specificity-versus-upstream-inline", { body: JSON.stringify(observed), contentType: "application/json" });
});

for (const reason of ["Close", "replacement", "disable"] as const) test(`${reason}: disposing an active pan restores the retained canvas and removes its listeners`, async ({ page }) => {
  const { viewer, opener, canvas } = await openPreview(page, false);
  if (reason === "replacement") {
    await page.evaluate(() => window.harness.mount("flowchart LR\nX[Replacement] --> Y[Preview]"));
    await expect(page.locator('[data-state="ready"]')).toHaveCount(2);
  }
  const box = (await canvas.boundingBox())!;
  await page.mouse.move(box.x + 120, box.y + 100);
  const before = await cursorState(canvas), retained = await canvas.elementHandle();
  const container = await viewer.elementHandle();
  await page.mouse.down(); await expect(canvas).toHaveCSS("cursor", "grabbing");
  await page.mouse.move(box.x + 140, box.y + 110, { steps: 2 });
  if (reason === "Close") await viewer.getByRole("button", { name: "Close preview", exact: true }).evaluate(node => (node as HTMLButtonElement).click());
  else if (reason === "replacement") await page.getByRole("button", { name: "Open enlarged Mermaid diagram" }).nth(1).evaluate(node => (node as HTMLButtonElement).click());
  else await page.evaluate(() => window.harness.disable());
  expect(await retained!.evaluate(node => ({ value: (node as HTMLElement).style.getPropertyValue("cursor"),
    priority: (node as HTMLElement).style.getPropertyPriority("cursor") }))).toEqual({ value: before.value, priority: before.priority });
  const disposed = await fitState(page, 1);
  await page.mouse.move(box.x + 180, box.y + 130); await page.mouse.up();
  expect(await fitState(page, 1)).toEqual(disposed);
  // The retained plugin-owned root has no active gesture or capture listener.
  expect(await container!.evaluate(node => {
    const canvas = node.ownerDocument.createElement("canvas");
    const wrapper = node.ownerDocument.createElement("div"); wrapper.className = "mermaid-excalidraw-canvas";
    wrapper.append(canvas); node.append(wrapper);
    const event = new PointerEvent("pointerdown", { pointerType: "mouse", pointerId: 91, isPrimary: true,
      button: 0, buttons: 1, clientX: 10, clientY: 10, bubbles: true, cancelable: true });
    canvas.dispatchEvent(event); return event.defaultPrevented;
  })).toBe(false);
  if (reason === "Close") await expect(opener).toBeFocused();
  if (reason === "replacement") {
    await expect(page.getByRole("dialog")).toHaveCount(1);
    const current = page.locator(".mermaid-excalidraw-enlarged canvas.interactive");
    const replacement = page.locator(".mermaid-excalidraw-enlarged");
    // A replacement scene can still be applying its initial fit. Establish a
    // ready public viewport before measuring a new gesture's displacement.
    await expectFit(page, replacement, 3, 4);
    await replacement.getByRole("button", { name: "Reset zoom", exact: true }).click();
    await expect.poll(async () => (await fitState(page, 3))?.zoom).toBe(1);
    const currentBox = (await current.boundingBox())!, state = (await fitState(page, 3))!;
    await page.mouse.move(currentBox.x + 120, currentBox.y + 100); await page.mouse.down();
    await expect(current).toHaveCSS("cursor", "grabbing");
    await page.mouse.move(currentBox.x + 150, currentBox.y + 120, { steps: 3 }); await page.mouse.up();
    const after = (await fitState(page, 3))!;
    expect((after.scrollX - state.scrollX) * state.zoom).toBeCloseTo(30, 4);
    expect((after.scrollY - state.scrollY) * state.zoom).toBeCloseTo(20, 4);
  }
  if (reason === "disable") {
    await expect(page.locator("canvas")).toHaveCount(0);
    await page.evaluate(async () => { await window.harness.enable(); window.harness.rerender(); });
    await expect(page.locator('[data-state="ready"]')).toHaveCount(1);
    await page.getByRole("button", { name: "Open enlarged Mermaid diagram" }).click();
    await expect(page.locator(".mermaid-excalidraw-enlarged canvas.interactive")).not.toHaveCSS("cursor", "grabbing");
  }
  await retained!.dispose(); await container!.dispose();
});

for (const foreign of [false, true]) test(`${foreign ? "foreign" : "main"}: a later cursor owner is preserved when pan ends`, async ({ page }) => {
  const { canvas } = await openPreview(page, foreign), box = (await canvas.boundingBox())!;
  await page.mouse.move(box.x + 120, box.y + 100);
  await canvas.evaluate(node => (node as HTMLElement).style.setProperty("cursor", "pointer"));
  await page.mouse.down(); await expect(canvas).toHaveCSS("cursor", "grabbing");
  await canvas.evaluate(node => {
    (node as HTMLElement).style.setProperty("cursor", "crosshair", "important");
    node.classList.add("other-plugin-fixture");
  });
  await page.mouse.up();
  expect(await cursorState(canvas)).toEqual({ value: "crosshair", priority: "important", computed: "crosshair" });
  await expect(canvas).toHaveClass(/other-plugin-fixture/);
});

test("foreign adopted canvas owns capture and focus in its document; importing-window events stay inert", async ({ page }) => {
  const { canvas } = await openPreview(page, true), box = (await canvas.boundingBox())!;
  await canvas.evaluate(node => node.ownerDocument.addEventListener("pointerdown", event => {
    Reflect.set(node, "testPanId", (event as PointerEvent).pointerId);
  }, { capture: true, passive: true, once: true }));
  await page.mouse.move(box.x + 120, box.y + 100); await page.mouse.down();
  await expect(canvas).toHaveCSS("cursor", "grabbing");
  const ownership = await canvas.evaluate(node => ({
    frame: node.ownerDocument.defaultView!.frameElement?.id,
    focused: node.ownerDocument.activeElement === node.closest(".excalidraw[tabindex]"),
    pointer: Reflect.get(node, "testPanId") as number,
  }));
  expect(ownership.frame).toBe("popout-fixture"); expect(ownership.focused).toBe(true);
  const before = (await fitState(page, 1))!;
  await page.evaluate(pointerId => {
    for (const type of ["pointermove", "pointerup"]) window.dispatchEvent(new PointerEvent(type, {
      pointerId, pointerType: "mouse", buttons: type === "pointermove" ? 1 : 0,
      clientX: 500, clientY: 500, bubbles: true, cancelable: true,
    }));
    window.dispatchEvent(new Event("blur"));
  }, ownership.pointer);
  expect(await fitState(page, 1)).toEqual(before);
  await expect(canvas).toHaveCSS("cursor", "grabbing");
  await page.mouse.move(box.x + 150, box.y + 120, { steps: 3 });
  const after = (await fitState(page, 1))!;
  expect((after.scrollX - before.scrollX) * before.zoom).toBeCloseTo(30, 5);
  expect((after.scrollY - before.scrollY) * before.zoom).toBeCloseTo(20, 5);
  await page.mouse.up(); await expect(canvas).not.toHaveCSS("cursor", "grabbing");
});
