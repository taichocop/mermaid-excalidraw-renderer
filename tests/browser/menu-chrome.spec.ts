import { expect, test } from "@playwright/test";
import { expectBoundedInk, expectNoMenuChrome } from "./chrome-assertions";
import { samples } from "./samples";

// Reading is a processor fixture; Live Preview uses real CM6 with the existing
// simulated host dedicated widget. Neither substitutes for native acceptance.
for (const mode of ["reading", "live-preview"] as const) {
  for (const language of ["mermaid", "mermaid-excalidraw"] as const) {
    test(`${mode} ${language}: retained menu nodes have no geometry, reserved space or hits`, async ({ page }) => {
      const errors: string[] = [];
      page.on("pageerror", error => errors.push(error.message));
      await page.goto("/"); await page.evaluate(() => window.ready);
      await page.setViewportSize({ width: 1280, height: 1100 });
      const inline = page.locator(".mermaid-excalidraw-container:not(.mermaid-excalidraw-enlarged)");
      for (const fixture of ["flowchart", "class"] as const) {
        await page.evaluate(({ mode, language, source }) => {
          if (mode === "reading") { window.harness.clear(); window.harness.mount(source, language); }
          else window.harness.editors.create("chrome-editor", `Before\n\n\`\`\`${language}\n${source}\n\`\`\`\n\nAfter`);
        }, { mode, language, source: samples[fixture] });
        await expect(inline).toHaveAttribute("data-state", "ready");
        for (const size of [{ width: 900, height: 900 }, { width: 420, height: 240 }]) {
          await page.evaluate(async size => {
            document.querySelector<HTMLElement>("main")!.style.width = `${size.width}px`;
            await window.harness.updateSettings({ canvasHeight: size.height });
          }, size);
          for (const dark of [false, true]) {
            await page.evaluate(dark => window.harness.theme(dark), dark);
            await expect.poll(() => inline.locator("canvas.static").evaluate(node =>
              [...(node as HTMLCanvasElement).getContext("2d")!.getImageData(0, 0, 1, 1).data].slice(0, 3),
            )).toEqual(dark ? [30, 30, 30] : [255, 255, 255]);
            await expectBoundedInk(inline); await expectNoMenuChrome(inline);
            await inline.getByRole("button", { name: "Open enlarged Mermaid diagram" }).click();
            const modal = page.getByRole("dialog"), viewer = modal.locator(".mermaid-excalidraw-enlarged");
            await expectBoundedInk(viewer); await expectNoMenuChrome(viewer);
            await expect(modal.getByRole("button", { name: "Close dialog", exact: true })).toBeVisible();
            await expect(viewer.locator(".mermaid-excalidraw-controls button")).toHaveCount(5);
            await page.setViewportSize({ width: 600, height: 500 });
            await expectBoundedInk(viewer); await expectNoMenuChrome(viewer);
            await page.setViewportSize({ width: 1280, height: 1100 });
            await expectBoundedInk(viewer); await expectNoMenuChrome(viewer);
            await page.keyboard.press("Escape");
            await expect(modal).toHaveCount(0);
            await expect(inline.getByRole("button", { name: "Open enlarged Mermaid diagram" })).toBeFocused();
          }
        }
      }
      expect(errors).toEqual([]);
    });
  }
}
