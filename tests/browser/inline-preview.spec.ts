import { expect, test, type Locator } from "@playwright/test";

async function pixels(viewer: Locator) {
  return viewer.locator("canvas.static").evaluate(node => {
    const canvas = node as HTMLCanvasElement;
    const data = canvas.getContext("2d")!.getImageData(0, 0, canvas.width, canvas.height).data;
    let hash = 2166136261;
    for (const byte of data) hash = Math.imul(hash ^ byte, 16777619);
    return hash >>> 0;
  });
}

async function expectInk(viewer: Locator) {
  await expect.poll(() => viewer.locator("canvas.static").evaluate(node => {
    const c = node as HTMLCanvasElement;
    if (!c.width || !c.height) return 0;
    const data = c.getContext("2d")!.getImageData(0, 0, c.width, c.height).data;
    let ink = 0;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3]! > 200 && Math.abs(data[i]! - data[0]!) > 16) ink++;
    }
    return ink;
  })).toBeGreaterThan(100);
}

test("inline wheel reaches the note without changing the diagram", async ({ page }, testInfo) => {
  await page.goto("/"); await page.evaluate(() => window.ready);
  await page.evaluate(() => {
    const main = document.querySelector("main")!;
    Object.assign(main.style, { overflow: "auto", height: "700px", width: "800px" });
    const reading = document.getElementById("reading")!;
    reading.style.width = "1100px";
    window.harness.mountSamples(["flowchart", "sequence"]);
  });
  const viewer = page.locator(".mermaid-excalidraw-container").first();
  await expect(viewer).toHaveAttribute("data-state", "ready");
  await expectInk(viewer);
  // Wait for initial fonts/fit/paint to settle, then observe actual scene pixels.
  await page.waitForTimeout(1000);
  const before = await pixels(viewer);
  await viewer.hover({ position: { x: 300, y: 250 } });
  await page.mouse.wheel(0, 180);
  await page.waitForTimeout(300);
  const vertical = await page.locator("main").evaluate(node => node.scrollTop);
  const afterVertical = await pixels(viewer);
  await page.mouse.wheel(160, 0);
  await page.waitForTimeout(300);
  const horizontal = await page.locator("main").evaluate(node => node.scrollLeft);
  const afterHorizontal = await pixels(viewer);
  const evidence = { before, afterVertical, afterHorizontal, vertical, horizontal };
  console.log("inline wheel evidence", JSON.stringify(evidence));
  await testInfo.attach("inline-wheel", { body: JSON.stringify(evidence), contentType: "application/json" });
  expect(vertical).toBeGreaterThan(0);
  expect(horizontal).toBeGreaterThan(0);
  expect(afterVertical).toBe(before);
  expect(afterHorizontal).toBe(before);
});

for (const language of ["mermaid", "mermaid-excalidraw"]) {
  for (const fixture of ["flowchart", "sequence", "class", "er", "state", "blockSimple"] as const) {
    test(`${language} ${fixture}: enlargement shares scene, controls, theme and focus`, async ({ page }) => {
      const errors: string[] = [];
      page.on("pageerror", error => errors.push(error.message));
      await page.goto("/"); await page.evaluate(() => window.ready);
      await page.evaluate(({ fixture, language }) => window.harness.mountSamples([fixture], language), { fixture, language });
      const inline = page.locator(".mermaid-excalidraw-container").first();
      const opener = inline.getByRole("button", { name: "Open enlarged Mermaid diagram" });
      await expect(inline).toHaveAttribute("data-state", "ready");
      await expect(inline.locator(".mermaid-excalidraw-passive")).toHaveAttribute("inert", "");
      await expect(inline.getByRole("button", { name: "Zoom in" })).toHaveCount(0);
      await page.waitForTimeout(700);
      const before = await pixels(inline);
      const sources = await page.evaluate(() => window.harness.hostState().blocks);
      await opener.focus();
      await page.keyboard.press(fixture === "sequence" ? "Space" : "Enter");
      const modal = page.getByRole("dialog", { name: "Mermaid diagram preview" });
      await expect(modal).toHaveCount(1);
      const viewer = modal.locator(".mermaid-excalidraw-enlarged");
      await expectInk(viewer);
      await page.waitForTimeout(700);
      const level = modal.getByLabel("Zoom level");
      const initial = await level.textContent();
      await modal.getByRole("button", { name: "Zoom in", exact: true }).focus();
      await page.keyboard.press("Enter");
      await expect(level).not.toHaveText(initial!);
      await modal.getByRole("button", { name: "Zoom out", exact: true }).focus();
      await page.keyboard.press("Space");
      await expect(level).toHaveText(initial!);
      await modal.getByRole("button", { name: "Reset zoom" }).click();
      await expect(level).toHaveText("100%");
      const panBefore = await pixels(viewer);
      const canvas = viewer.locator("canvas.interactive");
      const box = (await canvas.boundingBox())!;
      await page.mouse.move(box.x + 150, box.y + 100); await page.mouse.down();
      await page.mouse.move(box.x + 260, box.y + 160, { steps: 8 }); await page.mouse.up();
      await expect.poll(() => pixels(viewer)).not.toBe(panBefore);
      await modal.getByRole("button", { name: "Fit to content" }).focus();
      await page.keyboard.press("Enter");
      await expect(level).toHaveText(initial!);
      for (const dark of [true, false]) {
        await page.evaluate(dark => window.harness.theme(dark), dark);
        await expect.poll(() => viewer.locator("canvas.static").evaluate(node => {
          const c = node as HTMLCanvasElement;
          return [...c.getContext("2d")!.getImageData(0, 0, 1, 1).data].slice(0, 3);
        })).toEqual(dark ? [30, 30, 30] : [255, 255, 255]);
      }
      await page.setViewportSize({ width: 800, height: 700 });
      await expect(viewer).toBeVisible();
      await page.setViewportSize({ width: 1100, height: 900 });
      await modal.getByRole("button", { name: "Close preview" }).focus();
      await page.keyboard.press("Space");
      await expect(modal).toHaveCount(0);
      await expect(opener).toBeFocused();
      await expect.poll(() => pixels(inline)).toBe(before);
      expect(await page.evaluate(() => window.harness.hostState().blocks)).toEqual(sources);
      expect(errors).toEqual([]);
    });
  }
}

// Exercise the bundled React button handler from committed non-100% states.
// Returning to the initial zoom before Reset can hide a queued-update race.
for (const source of [
  "flowchart LR\nA[Reset] --> B[Centered]",
  "classDiagram\nclass Reset {\n +String centered\n}",
]) {
  test(`Reset zoom commits centered 100% from below and above 100%: ${source.split("\n")[0]}`, async ({ page }, testInfo) => {
    await page.goto("/"); await page.evaluate(() => window.ready);
    await page.evaluate(source => window.harness.mount(source), source);
    const inline = page.locator(".mermaid-excalidraw-container").first();
    await expect(inline).toHaveAttribute("data-state", "ready");
    await inline.getByRole("button", { name: "Open enlarged Mermaid diagram" }).click();
    const modal = page.getByRole("dialog");
    const viewer = modal.locator(".mermaid-excalidraw-enlarged");
    const level = modal.getByLabel("Zoom level");
    const reset = modal.getByRole("button", { name: "Reset zoom", exact: true });
    await expectInk(viewer);
    await expect(level).toHaveText("100%"); // Small fixtures fit without scaling.
    await page.waitForTimeout(700); // Let initial resize/fit finish before sampling.
    await reset.click();
    await expect(level).toHaveText("100%");
    await page.waitForTimeout(200);
    const centered = await pixels(viewer);
    const evidence: { beforeReset: string | null; afterReset: string | null; centeredPixels: number }[] = [];
    for (const [direction, expected, activation] of [
      ["Zoom out", "83%", "pointer"], ["Zoom in", "120%", "keyboard"],
    ] as const) {
      await modal.getByRole("button", { name: direction, exact: true }).click();
      await expect(level).toHaveText(expected);
      const canvas = viewer.locator("canvas.interactive");
      const box = (await canvas.boundingBox())!;
      await page.mouse.move(box.x + 150, box.y + 100); await page.mouse.down();
      await page.mouse.move(box.x + 250, box.y + 160, { steps: 8 }); await page.mouse.up();
      await expect.poll(() => pixels(viewer)).not.toBe(centered);
      const beforeReset = await level.textContent();
      expect(beforeReset).not.toBe("100%");
      if (activation === "pointer") await reset.click();
      else { await reset.focus(); await page.keyboard.press("Space"); }
      await expect(level).toHaveText("100%");
      // Same original scene pixels require restoration of center as well as scale.
      await expect.poll(() => pixels(viewer)).toBe(centered);
      evidence.push({ beforeReset, afterReset: await level.textContent(), centeredPixels: await pixels(viewer) });
    }
    await testInfo.attach("reset-from-non-100-zoom", { body: JSON.stringify(evidence), contentType: "application/json" });
    await page.keyboard.press("Escape");
    await expect(modal).toHaveCount(0);
  });
}

test("passive drag/trackpad-like events preserve scene and note input; modal wheel cannot scroll the note", async ({ page }) => {
  await page.goto("/"); await page.evaluate(() => window.ready);
  await page.evaluate(() => window.harness.mountSamples(["flowchart", "sequence"]));
  const inline = page.locator(".mermaid-excalidraw-container").first();
  await expect(inline).toHaveAttribute("data-state", "ready");
  await page.waitForTimeout(700);
  const before = await pixels(inline);
  const box = (await inline.boundingBox())!;
  await page.mouse.move(box.x + 150, box.y + 100); await page.mouse.down();
  await page.mouse.move(box.x + 260, box.y + 160, { steps: 8 }); await page.mouse.up();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(await pixels(inline)).toBe(before);
  const prevented = await inline.getByRole("button").evaluate(node => {
    return [0, 1].map(deltaMode => {
      const event = new WheelEvent("wheel", { deltaY: 4.25, deltaX: 2.5, deltaMode, bubbles: true, cancelable: true });
      node.dispatchEvent(event); return event.defaultPrevented;
    });
  });
  expect(prevented).toEqual([false, false]); // Synthetic defaults do not prove OS gestures.
  const opener = inline.getByRole("button");
  await opener.click();
  const modal = page.getByRole("dialog");
  await page.waitForTimeout(700);
  const notePosition = await page.evaluate(() => ({ x: window.scrollX, y: window.scrollY }));
  const enlarged = modal.locator(".mermaid-excalidraw-enlarged");
  const previewBefore = await pixels(enlarged);
  await enlarged.locator("canvas.interactive").hover({ position: { x: 200, y: 100 } });
  await page.mouse.wheel(80, 200);
  await page.waitForTimeout(200);
  expect(await pixels(enlarged)).toBe(previewBefore);
  expect(await page.evaluate(() => ({ x: window.scrollX, y: window.scrollY }))).toEqual(notePosition);
  await page.keyboard.press("Escape");
  await expect(modal).toHaveCount(0);
  await expect(opener).toBeFocused();
  expect(await pixels(inline)).toBe(before);
});

test("one modal per renderer closes on OFF, note switch, pending reconversion and disable/re-enable", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto("/"); await page.evaluate(() => window.ready);
  await page.evaluate(() => {
    window.harness.mountSamples(["flowchart", "class"], "mermaid");
    window.harness.mountSamples(["sequence"]);
  });
  await expect(page.locator('[data-state="ready"]')).toHaveCount(3);
  const open = async (index = 0) => {
    await page.getByRole("button", { name: "Open enlarged Mermaid diagram" }).nth(index).click();
    await expect(page.getByRole("dialog")).toHaveCount(1);
  };
  await open();
  await page.getByRole("button", { name: "Open enlarged Mermaid diagram" }).first().evaluate(node => {
    for (let i = 0; i < 5; i++) (node as HTMLButtonElement).click();
  });
  await expect(page.getByRole("dialog")).toHaveCount(1);
  await page.getByRole("button", { name: "Open enlarged Mermaid diagram" }).nth(1).evaluate(node => (node as HTMLButtonElement).click());
  await expect(page.getByRole("dialog")).toHaveCount(1);
  await page.evaluate(() => window.harness.updateSettings({ renderStandardMermaid: false }));
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Open enlarged Mermaid diagram" })).toHaveCount(1);
  await expect(page.locator(".standard-mermaid")).toHaveCount(2);
  await open();
  await page.evaluate(() => window.harness.updateSettings({ fontSize: 28 }));
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.locator('[data-state="ready"]')).toHaveCount(1);
  await open();
  await page.evaluate(() => window.harness.clear());
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.locator("canvas")).toHaveCount(0);
  await page.evaluate(() => window.harness.mountSamples(["er"]));
  await expect(page.locator('[data-state="ready"]')).toHaveCount(1);
  await open();
  await page.evaluate(() => window.harness.disable());
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.locator("canvas")).toHaveCount(0);
  await page.evaluate(() => window.harness.enable());
  await expect(page.locator('[data-state="ready"]')).toHaveCount(1);
  await open();
  await page.locator(".modal-bg").click({ position: { x: 5, y: 5 } });
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("real CM6: Modal activation preserves selection, source editing/IME and owner destruction close it", async ({ page }) => {
  await page.goto("/"); await page.evaluate(() => window.ready);
  const doc = "Before\n\n```mermaid\nflowchart LR\nA[Original]-->B\n```\n\nAfter";
  await page.evaluate(doc => window.harness.editors.create("modal-editor", doc), doc);
  const editor = page.locator("#modal-editor");
  await expect(editor.locator('[data-state="ready"]')).toHaveCount(1);
  const before = await page.evaluate(() => window.harness.editors.snapshot("modal-editor"));
  await editor.getByRole("button", { name: "Open enlarged Mermaid diagram" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(1);
  expect(await page.evaluate(() => window.harness.editors.snapshot("modal-editor"))).toEqual(before);
  await page.keyboard.press("Escape");
  await expect(editor.getByRole("button")).toBeFocused();
  await editor.getByRole("button").click();
  await page.evaluate(() => window.harness.editors.select("modal-editor", [[8, 8]]));
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(editor.locator(".mermaid-excalidraw-container")).toHaveCount(0);
  await page.evaluate(() => {
    const h = window.harness.editors, doc = h.snapshot("modal-editor").doc;
    h.composition("modal-editor", true);
    const from = doc.indexOf("Original"); h.edit("modal-editor", from, from + 8, "Latest");
    h.composition("modal-editor", false);
  });
  await page.evaluate(() => window.harness.editors.undo("modal-editor"));
  expect((await page.evaluate(() => window.harness.editors.snapshot("modal-editor"))).doc).toBe(doc);
  await page.evaluate(() => {
    const h = window.harness.editors; h.redo("modal-editor"); h.select("modal-editor", [[0, 0]]);
  });
  await expect(editor.locator('[data-state="ready"]')).toHaveCount(1);
  await editor.getByRole("button").click();
  await page.evaluate(() => window.harness.editors.mode("modal-editor", false));
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(editor.locator("canvas")).toHaveCount(0);
  await page.evaluate(() => window.harness.editors.mode("modal-editor", true));
  await expect(editor.locator('[data-state="ready"]')).toHaveCount(1);
  await editor.getByRole("button").click();
  await page.evaluate(() => window.harness.editors.destroy("modal-editor"));
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.locator("canvas")).toHaveCount(0);
});


test("owner-document viewer and Modal clean up in a foreign window", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto("/"); await page.evaluate(() => window.ready);
  await page.evaluate(() => window.harness.mountInFrame("classDiagram\nclass Fixture {\n +String name\n}"));
  const foreign = page.frameLocator("#popout-fixture");
  await expect(foreign.locator('[data-state="ready"]')).toHaveCount(1);
  const opener = foreign.getByRole("button", { name: "Open enlarged Mermaid diagram" });
  await opener.click();
  const modal = foreign.getByRole("dialog");
  await expect(modal).toHaveCount(1);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expectInk(modal.locator(".mermaid-excalidraw-enlarged"));
  await modal.getByRole("button", { name: "Zoom in", exact: true }).focus();
  await page.keyboard.press("Enter");
  await page.keyboard.press("Escape");
  await expect(modal).toHaveCount(0);
  await expect(opener).toBeFocused();
  await opener.click();
  await page.evaluate(() => {
    const frame = document.getElementById("popout-fixture") as HTMLIFrameElement;
    frame.contentWindow!.dispatchEvent(new Event("pagehide"));
  });
  await expect(modal).toHaveCount(0);
  await page.evaluate(() => window.harness.disable());
  await expect(foreign.locator("canvas")).toHaveCount(0);
  expect(errors).toEqual([]);
});
