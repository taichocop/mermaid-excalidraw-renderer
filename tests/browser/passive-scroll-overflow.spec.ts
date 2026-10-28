import { expect, test, type Locator } from "@playwright/test";
import { fitInk, fitState, observeFitAPI } from "./auto-fit-helpers";
import { samples } from "./samples";

async function paintedPosition(viewer: Locator) {
  return viewer.evaluate(node => {
    const canvas = node.querySelector<HTMLCanvasElement>("canvas.static")!;
    const pixels = canvas.getContext("2d")!.getImageData(0, 0, canvas.width, canvas.height).data;
    let hash = 2166136261;
    for (const byte of pixels) hash = Math.imul(hash ^ byte, 16777619);
    const outer = node.getBoundingClientRect(), inner = canvas.getBoundingClientRect();
    const widget = node.closest<HTMLElement>(".cm-content > [contenteditable=false]") ?? node as HTMLElement;
    return { pixels: hash >>> 0, x: inner.left - outer.left, y: inner.top - outer.top,
      widgetTop: widget.scrollTop, widgetLeft: widget.scrollLeft };
  });
}

for (const mode of ["reading", "live"] as const) {
  for (const language of ["mermaid", "mermaid-excalidraw"] as const) {
    for (const fixture of ["flowchart", "sequence", "class"] as const) {
      test(`${mode} ${language} ${fixture}: a scrollable host widget cannot capture passive diagram wheel`, async ({ page }, testInfo) => {
        await observeFitAPI(page);
        await page.goto("/"); await page.evaluate(() => window.ready);
        await page.mouse.move(0, 0);
        const inspector = await page.context().newCDPSession(page);
        const objects: Record<string, string> = {};
        for (const target of ["window", "document"]) {
          const { result } = await inspector.send("Runtime.evaluate", { expression: target, objectGroup: "passive-scroll" });
          objects[target] = result.objectId!;
        }
        const inputListeners = async (objectId: string) => {
          const { listeners } = await inspector.send("DOMDebugger.getEventListeners", { objectId });
          return listeners.filter(({ type }: { type: string }) => /^(wheel|gesturestart|gesturechange|gestureend)$/.test(type)).length;
        };
        const baselineListeners = await Promise.all(Object.values(objects).map(inputListeners));
        // Model the measured Native combination: the host establishes a paint
        // containing block and a theme makes non-editable CM6 blocks scrollable.
        // No vendor theme code is copied and no event handler is simulated.
        await page.addStyleTag({ content: `
          .markdown-source-view.mod-cm6 *, main * { box-sizing: border-box; }
          .markdown-source-view.mod-cm6 .cm-content > [contenteditable=false] { contain: paint !important; overflow: auto; }
        ` });
        await page.evaluate(({ mode, language, source }) => {
          if (mode === "live") {
            const h = window.harness.editors;
            h.create("passive-overflow", `Before\n\n\`\`\`${language}\n${source}\n\`\`\`\n\n`
              + Array.from({ length: 80 }, (_, i) => `Body line ${i}`).join("\n"));
            document.getElementById("passive-overflow")!.className = "markdown-source-view mod-cm6";
            const editor = h.view("passive-overflow");
            Object.assign(editor.scrollDOM.style, { width: "616px", height: "420px", overflow: "auto" });
            editor.contentDOM.style.width = "900px";
            editor.requestMeasure();
          } else {
            const main = document.querySelector("main")!;
            Object.assign(main.style, { width: "616px", height: "420px", overflow: "auto" });
            document.getElementById("reading")!.style.width = "900px";
            window.harness.mount(source, language);
            const tail = document.createElement("div"); tail.style.height = "1800px";
            document.getElementById("reading")!.append(tail);
          }
        }, { mode, language, source: samples[fixture] });
        const viewer = page.locator(".mermaid-excalidraw-container");
        const host = mode === "live" ? page.locator("#passive-overflow .cm-scroller") : page.locator("main");
        await expect(viewer).toHaveAttribute("data-state", "ready");
        await expect.poll(() => fitState(page)).not.toBeNull();
        await expect.poll(async () => (await fitInk(viewer))?.count ?? 0).toBeGreaterThan(100);
        await page.waitForTimeout(700);
        const { result: retained } = await inspector.send("Runtime.evaluate", {
          expression: "document.querySelector('.mermaid-excalidraw-container .excalidraw')", objectGroup: "passive-scroll",
        });
        expect(retained.objectId).toBeTruthy();
        expect(await inputListeners(retained.objectId!)).toBeGreaterThan(0);
        const source = mode === "live"
          ? await page.evaluate(() => window.harness.editors.snapshot("passive-overflow")) : null;
        const before = { host: await host.evaluate(node => ({ top: node.scrollTop, left: node.scrollLeft })),
          scene: await fitState(page), paint: await paintedPosition(viewer) };
        await viewer.hover({ position: { x: 260, y: 140 } });
        expect(await fitState(page)).toEqual(before.scene);
        expect(await paintedPosition(viewer)).toEqual(before.paint);
        await page.mouse.wheel(0, 80);
        await page.waitForTimeout(300);
        const vertical = { host: await host.evaluate(node => ({ top: node.scrollTop, left: node.scrollLeft })),
          scene: await fitState(page), paint: await paintedPosition(viewer) };
        await page.mouse.wheel(60, 0);
        await page.waitForTimeout(300);
        const horizontal = { host: await host.evaluate(node => ({ top: node.scrollTop, left: node.scrollLeft })),
          scene: await fitState(page), paint: await paintedPosition(viewer) };
        await testInfo.attach("passive-widget-scroll", {
          body: JSON.stringify({ mode, language, fixture, before, vertical, horizontal }), contentType: "application/json",
        });
        // These assertions must hold together: identical scene pixels alone
        // miss DOM scrolling inside the widget while the note remains still.
        expect.soft(vertical.host.top).toBeGreaterThan(before.host.top);
        expect.soft(horizontal.host.left).toBeGreaterThan(before.host.left);
        for (const after of [vertical, horizontal]) {
          expect.soft(after.scene).toEqual(before.scene);
          expect.soft(after.paint).toEqual(before.paint);
          expect.soft(after.paint.widgetTop).toBe(0);
          expect.soft(after.paint.widgetLeft).toBe(0);
        }
        await expect(page.getByRole("dialog")).toHaveCount(0);
        if (mode === "live") {
          expect(await page.evaluate(() => window.harness.editors.snapshot("passive-overflow"))).toEqual(source);
          await page.evaluate(() => window.harness.editors.destroy("passive-overflow"));
        } else await page.evaluate(() => window.harness.clear());
        expect(await page.evaluate(() => window.harness.mountedScenes())).toEqual([]);
        await expect(page.locator("canvas")).toHaveCount(0);
        await page.evaluate(() => window.harness.disable());
        await expect.poll(() => inputListeners(retained.objectId!)).toBe(0);
        expect(await Promise.all(Object.values(objects).map(inputListeners))).toEqual(baselineListeners);
        await inspector.send("Runtime.releaseObjectGroup", { objectGroup: "passive-scroll" });
        await inspector.detach();
      });
    }
  }
}
