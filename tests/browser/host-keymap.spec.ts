import { expect, test } from "@playwright/test";

for (const phase of ["window", "document"] as const) {
  for (const mode of ["Reading", "Live Preview"] as const) {
    test(`${mode} Modal isolates an earlier ${phase}-capture host keymap and Escape restores host focus`, async ({ page }) => {
      await page.goto("/"); await page.evaluate(() => window.ready);
      const doc = "Synthetic alpha beta\n\n```mermaid\nflowchart LR\nA[Disposable]-->B[Fixture]\n```\n\nOmega";
      await page.evaluate(({ phase, mode, doc }) => {
        const h = window.harness;
        h.keyboardHost.install(phase, "host-keys");
        h.editors.create("host-keys", mode === "Live Preview" ? doc : "Synthetic alpha beta");
        h.editors.select("host-keys", [[10, 15]]);
        if (mode === "Reading") h.mountSamples(["flowchart", "class"]);
      }, { phase, mode, doc });
      await expect(page.locator('[data-state="ready"]')).toHaveCount(mode === "Reading" ? 2 : 1);
      const before = await page.evaluate(() => window.harness.editors.snapshot("host-keys"));
      const openers = page.getByRole("button", { name: "Open enlarged Mermaid diagram" });
      await expect(openers).toHaveCount(mode === "Reading" ? 2 : 1);
      for (const opener of await openers.all()) {
        await opener.focus(); await page.keyboard.press("Enter");
        const modal = page.getByRole("dialog");
        await expect(modal).toHaveCount(1);
        const wrapper = modal.locator(".excalidraw").first();
        await wrapper.focus();
        for (const code of ["KeyO", "Slash", "KeyP"]) {
          for (const target of [modal.locator("canvas.interactive"), wrapper]) {
            const blocked = await target.evaluate((node, code) => {
              const event = new KeyboardEvent("keydown", { key: code === "Slash" ? "/" : code.slice(3).toLowerCase(), code,
                metaKey: true, shiftKey: code === "KeyP", bubbles: true, cancelable: true });
              node.dispatchEvent(event); return event.defaultPrevented;
            }, code);
            expect(blocked).toBe(true);
            const host = await page.evaluate(() => window.harness.keyboardHost.snapshot());
            expect(host.effects).toEqual([]);
            expect(host.scopeDepth).toBe(2); // Modal scope + focused viewer scope.
            expect(await page.evaluate(() => window.harness.editors.snapshot("host-keys"))).toEqual(before);
            await expect(page.locator(".prompt-input")).toHaveCount(0);
            await expect(page.getByRole("dialog")).toHaveCount(1);
          }
        }
        const zoom = modal.getByLabel("Zoom level");
        const value = await zoom.textContent();
        await page.keyboard.press("ControlOrMeta+=");
        await expect(zoom).not.toHaveText(value!);
        // Mock host dispatch invokes the top Scope before document capture.
        await page.keyboard.press("Escape");
        await expect(modal).toHaveCount(0);
        await expect(opener).toBeFocused();
        expect((await page.evaluate(() => window.harness.keyboardHost.snapshot())).scopeDepth).toBe(0);
      }
      expect(await page.evaluate(() => window.harness.editors.snapshot("host-keys"))).toEqual(before);
      await page.evaluate(() => window.harness.disable());
      expect((await page.evaluate(() => window.harness.keyboardHost.snapshot())).scopeDepth).toBe(0);
      await page.keyboard.press("Meta+o");
      await expect(page.locator(".prompt-input")).toBeFocused();
    });
  }
}

test("a redraw error and disposal of a focused Modal release scopes and restore host commands", async ({ page }) => {
  await page.goto("/"); await page.evaluate(() => window.ready);
  await page.evaluate(() => {
    const h = window.harness;
    h.keyboardHost.install("window", "host-keys");
    h.editors.create("host-keys", "Synthetic alpha beta");
    h.editors.select("host-keys", [[10, 15]]);
    h.mountSamples(["class"]);
  });
  await expect(page.locator('[data-state="ready"]')).toHaveCount(1);
  await page.getByRole("button", { name: "Open enlarged Mermaid diagram" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Reset zoom" }).focus();
  await page.evaluate(async () => {
    window.harness.corruptSceneSvg();
    await window.harness.updateSettings({ roughness: 2 });
  });
  await expect(page.getByRole("dialog").getByRole("alert")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect((await page.evaluate(() => window.harness.keyboardHost.snapshot())).scopeDepth).toBe(0);
  await page.keyboard.press("Meta+o");
  await expect(page.locator(".prompt-input")).toBeFocused();
  await page.evaluate(() => window.harness.disable());
  expect((await page.evaluate(() => window.harness.keyboardHost.snapshot())).scopeDepth).toBe(0);
});
