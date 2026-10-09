import { expect, test } from "@playwright/test";

// All sinks are disposable stubs. No system clipboard, file picker or existing
// browser storage is accessed. The real production bundle supplies the viewer.
test("view-only blocks copy/export, dialogs, storage and file/network actions while retaining navigation", async ({ page }, testInfo) => {
  await page.addInitScript(() => {
    const calls: string[] = [];
    Object.assign(window, { viewOnlyCalls: calls });
    Object.defineProperty(navigator, "clipboard", { value: {
      writeText: async () => { calls.push("clipboard.writeText"); },
      write: async () => { calls.push("clipboard.write"); },
      readText: async () => { calls.push("clipboard.readText"); return "Disposable fixture"; },
      read: async () => { calls.push("clipboard.read"); return []; },
    } });
    document.execCommand = (command) => { calls.push(`execCommand.${command}`); return true; };
    for (const method of ["getItem", "setItem", "removeItem"] as const) {
      Storage.prototype[method] = function () { calls.push(`storage.${method}`); return null; };
    }
    for (const method of ["showOpenFilePicker", "showSaveFilePicker", "showDirectoryPicker"]) {
      Reflect.set(window, method, async () => { calls.push(method); throw new Error("Disposable file sink"); });
    }
  });
  const requests: string[] = [], downloads: string[] = [], errors: string[] = [];
  page.on("download", download => downloads.push(download.suggestedFilename()));
  page.on("pageerror", error => errors.push(error.message));
  await page.goto("/");
  await page.evaluate(() => window.ready);
  await page.route("**/*", route => { requests.push(route.request().url()); return route.abort(); });
  await page.evaluate(() => {
    window.harness.mountSamples(["flowchart"], "mermaid");
    window.harness.mountSamples(["class"]);
  });
  await expect(page.locator('[data-state="ready"]')).toHaveCount(2);
  await page.evaluate(() => document.fonts.load("20px Virgil"));
  // Require actual scene ink rather than relying only on conversion completion.
  await expect.poll(() => page.locator("canvas.static").evaluateAll(canvases => canvases.every(node => {
    const canvas = node as HTMLCanvasElement;
    return canvas.width > 0 && canvas.height > 0 && canvas.getContext("2d")!.getImageData(0, 0, canvas.width, canvas.height).data
      .some((value, i) => i % 4 === 0 && value < 200);
  }))).toBe(true);
  for (const opener of await page.getByRole("button", { name: "Open enlarged Mermaid diagram" }).all()) {
    if (await page.getByRole("dialog").count()) await page.getByRole("button", { name: "Close preview" }).click();
    await opener.click();
    await expect(page.getByRole("dialog")).toHaveCount(1);
    const canvas = page.getByRole("dialog").locator("canvas.interactive");
    await canvas.click();
    const events = await canvas.evaluate(node => {
      const dt = new DataTransfer();
      dt.setData("text/plain", "Synthetic fixture only");
      const results: Record<string, boolean> = {};
      for (const type of ["copy", "cut", "paste"]) {
        // Exercise both canvas events and native Edit-menu document dispatch.
        for (const target of [node, node.ownerDocument]) {
          const event = new ClipboardEvent(type, { bubbles: true, cancelable: true, clipboardData: dt });
          target.dispatchEvent(event);
          results[`${type}-${target === node ? "canvas" : "document"}`] = event.defaultPrevented;
        }
      }
      results.clipboardDataUnchanged = dt.getData("text/plain") === "Synthetic fixture only";
      const drop = new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: dt });
      node.dispatchEvent(drop); results.drop = drop.defaultPrevented;
      const touch = new PointerEvent("pointerdown", { bubbles: true, cancelable: true, pointerType: "touch", pointerId: 99 });
      node.dispatchEvent(touch); results.touchLongPress = touch.defaultPrevented;
      node.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, pointerType: "touch", pointerId: 99 }));
      return results;
    });
    expect(Object.values(events).every(Boolean)).toBe(true);
    await canvas.click({ button: "right" });
    await expect(page.locator(".context-menu")).toHaveCount(0);
    for (const shortcut of ["Control+Shift+E", "Meta+Shift+E", "Shift+Alt+c", "Control+/", "Control+Shift+p", "?", "Control+o", "Control+s", "Control+v"]) {
      await page.keyboard.press(shortcut);
      await expect(page.getByRole("dialog")).toHaveCount(1);
    }
    // Navigation still reaches the actual upstream canvas.
  }
  const viewer = page.locator(".mermaid-excalidraw-enlarged");
  const zoomIn = viewer.getByRole("button", { name: "Zoom in", exact: true });
  const reset = viewer.getByLabel("Zoom level");
  const zoomBefore = await reset.textContent();
  await zoomIn.click();
  await expect(reset).not.toHaveText(zoomBefore!);
  const keyboardBefore = await reset.textContent();
  await zoomIn.focus(); await page.keyboard.press("Enter");
  await expect(reset).not.toHaveText(keyboardBefore!);
  await expect(page.getByRole("dialog")).toHaveCount(1);
  const canvas = viewer.locator("canvas.interactive");
  await canvas.click();
  for (const code of ["Equal", "NumpadAdd", "Minus", "NumpadSubtract"]) {
    const zoom = Number((await reset.textContent())!.replace("%", ""));
    // Synthetic physical key codes cover numpad/layout variants consistently
    // across CI and macOS; assert real upstream zoom, not dispatch alone.
    await canvas.evaluate((node, code) => node.dispatchEvent(new KeyboardEvent("keydown", {
      key: code === "Equal" || code === "NumpadAdd" ? "+" : "_", code, shiftKey: true, bubbles: true, cancelable: true,
    })), code);
    if (code === "Equal" || code === "NumpadAdd") await expect.poll(async () => Number((await reset.textContent())!.replace("%", ""))).toBeGreaterThan(zoom);
    else await expect.poll(async () => Number((await reset.textContent())!.replace("%", ""))).toBeLessThan(zoom);
  }
  for (const code of ["Digit0", "Numpad0"]) {
    await canvas.evaluate(node => node.dispatchEvent(new KeyboardEvent("keydown", {
      key: "+", code: "Equal", shiftKey: true, bubbles: true, cancelable: true,
    })));
    await expect(reset).not.toHaveText("100%");
    await canvas.evaluate((node, code) => node.dispatchEvent(new KeyboardEvent("keydown", {
      key: code === "Digit0" ? ")" : "0", code, shiftKey: true, bubbles: true, cancelable: true,
    })), code);
    await expect(reset).toHaveText("100%");
  }
  const pixels = () => viewer.locator("canvas.static").evaluate(node => {
    const canvas = node as HTMLCanvasElement;
    const data = canvas.getContext("2d")!.getImageData(0, 0, canvas.width, canvas.height).data;
    let hash = 2166136261;
    for (const byte of data) hash = Math.imul(hash ^ byte, 16777619);
    return hash >>> 0;
  });
  const panBefore = await pixels();
  await canvas.evaluate(node => node.scrollIntoView({ block: "center" }));
  await canvas.hover({ position: { x: 100, y: 100 } });
  const box = (await canvas.boundingBox())!;
  await page.mouse.move(box.x + 100, box.y + 100); await page.mouse.down();
  await page.mouse.move(box.x + 200, box.y + 130, { steps: 5 }); await page.mouse.up();
  await expect.poll(pixels).not.toBe(panBefore);
  const wheelBefore = await pixels();
  await page.mouse.wheel(0, -200);
  await page.waitForTimeout(200);
  expect(await pixels()).toBe(wheelBefore);
  await viewer.getByRole("button", { name: "Fit to content" }).click();
  await viewer.getByRole("button", { name: "Close preview" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  // Outside the viewer, clipboard event propagation/default behavior survives.
  const outside = await page.evaluate(() => {
    const input = document.createElement("textarea"); document.body.append(input); input.focus();
    const event = new ClipboardEvent("copy", { bubbles: true, cancelable: true });
    input.dispatchEvent(event); input.remove(); return event.defaultPrevented;
  });
  expect(outside).toBe(false);
  await page.evaluate(() => window.harness.disable());
  await expect(page.locator("canvas")).toHaveCount(0);
  const afterUnload = await page.evaluate(() => {
    const event = new ClipboardEvent("copy", { bubbles: true, cancelable: true }); document.dispatchEvent(event); return event.defaultPrevented;
  });
  expect(afterUnload).toBe(false);
  const calls = await page.evaluate(() => Reflect.get(window, "viewOnlyCalls") as string[]);
  expect(calls).toEqual([]); expect(requests).toEqual([]); expect(downloads).toEqual([]); expect(errors).toEqual([]);
  await testInfo.attach("view-only-disposable-sinks", { body: JSON.stringify({ calls, requests, downloads, outside, afterUnload }), contentType: "application/json" });
});

test("inline SVG colors are stripped in detached XML and a foreign window without losing layout", async ({ page }) => {
  await page.goto("/"); await page.evaluate(() => window.ready);
  const result = await page.evaluate(() => {
    const source = '<svg xmlns="http://www.w3.org/2000/svg"><rect width="20" style="fill:red;stroke:blue;opacity:0.5"/><foreignObject><div xmlns="http://www.w3.org/1999/xhtml" style="color:red;background:blue;font-size:18px">Fixture</div></foreignObject></svg>';
    const iframe = document.createElement("iframe"); document.body.append(iframe);
    const foreign = iframe.contentWindow!;
    // The native app installs the same helpers in each window. Fixture only.
    const ForeignNode = Reflect.get(foreign, "Node") as typeof Node;
    ForeignNode.prototype.instanceOf = Node.prototype.instanceOf;
    const ForeignParser = Reflect.get(foreign, "DOMParser") as typeof DOMParser;
    const documents = [new DOMParser().parseFromString(source, "image/svg+xml"), new ForeignParser().parseFromString(source, "image/svg+xml")];
    const globalCheck = documents[1]!.querySelector("rect") instanceof SVGElement;
    const values = documents.map(doc => {
      window.harness.stripInlineColors(doc.documentElement);
      const rect = doc.querySelector("rect") as SVGElement;
      const html = doc.querySelector("div") as HTMLElement;
      return { detached: doc.defaultView === null, fill: rect.style.fill, stroke: rect.style.stroke, opacity: rect.style.opacity,
        color: html.style.color, background: html.style.background, fontSize: html.style.fontSize, width: rect.getAttribute("width"),
        namespace: rect.namespaceURI, htmlNamespace: html.namespaceURI };
    });
    iframe.remove(); return { globalCheck, values };
  });
  expect(result.globalCheck).toBe(false);
  expect(result.values).toEqual(Array.from({ length: 2 }, () => ({ detached: true, fill: "", stroke: "", opacity: "0.5", color: "", background: "", fontSize: "18px", width: "20", namespace: "http://www.w3.org/2000/svg", htmlNamespace: "http://www.w3.org/1999/xhtml" })));
});

test("Live Preview shares the viewer boundary while CM6 source editing and disposal remain intact", async ({ page }) => {
  await page.addInitScript(() => {
    Object.assign(window, { lpClipboardCalls: [] });
    const called = () => (Reflect.get(window, "lpClipboardCalls") as string[]).push("clipboard");
    Object.defineProperty(navigator, "clipboard", { value: {
      writeText: async () => { called(); }, write: async () => { called(); },
      readText: async () => { called(); return "Fixture"; }, read: async () => { called(); return []; },
    } });
    document.execCommand = () => { called(); return true; };
  });
  await page.goto("/"); await page.evaluate(() => window.ready);
  const doc = "Before\n\n```mermaid\nflowchart LR\nA[Disposable]-->B[Fixture]\n```\n\nAfter";
  await page.evaluate(doc => window.harness.editors.create("boundary-editor", doc), doc);
  const editor = page.locator("#boundary-editor");
  await expect(editor.locator('[data-state="ready"]')).toHaveCount(1);
  const before = await page.evaluate(() => window.harness.editors.snapshot("boundary-editor"));
  await editor.getByRole("button", { name: "Open enlarged Mermaid diagram" }).click();
  const modal = page.getByRole("dialog");
  const canvas = modal.locator("canvas.interactive");
  await canvas.click();
  const blocked = await canvas.evaluate(node => {
    const data = new DataTransfer(); data.setData("text/plain", "Disposable");
    const event = new ClipboardEvent("copy", { bubbles: true, cancelable: true, clipboardData: data });
    node.ownerDocument.dispatchEvent(event);
    return event.defaultPrevented && data.getData("text/plain") === "Disposable";
  });
  expect(blocked).toBe(true);
  await canvas.click({ button: "right" });
  await expect(page.locator(".context-menu")).toHaveCount(0);
  await page.keyboard.press("?"); await expect(page.getByRole("dialog")).toHaveCount(1);
  const reset = modal.getByLabel("Zoom level");
  const zoom = await reset.textContent();
  await modal.getByRole("button", { name: "Zoom in", exact: true }).click();
  await expect(reset).not.toHaveText(zoom!);
  expect(await page.evaluate(() => window.harness.editors.snapshot("boundary-editor"))).toEqual(before);
  await modal.getByRole("button", { name: "Close preview" }).click();
  await page.evaluate(() => {
    const h = window.harness.editors; h.select("boundary-editor", [[0, 0]]);
    h.view("boundary-editor").focus();
  });
  const outside = await page.evaluate(() => {
    const node = window.harness.editors.view("boundary-editor").contentDOM;
    const event = new KeyboardEvent("keydown", { key: "q", code: "KeyQ", bubbles: true, cancelable: true });
    node.dispatchEvent(event); return event.defaultPrevented;
  });
  expect(outside).toBe(false);
  await page.keyboard.type("Edited ");
  expect((await page.evaluate(() => window.harness.editors.snapshot("boundary-editor"))).doc).toBe(`Edited ${doc}`);
  await page.evaluate(() => window.harness.editors.destroy("boundary-editor"));
  await expect(page.locator("canvas")).toHaveCount(0);
  expect(await page.evaluate(() => Reflect.get(window, "lpClipboardCalls"))).toEqual([]);
});
