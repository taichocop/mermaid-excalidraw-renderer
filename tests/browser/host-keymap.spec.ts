import { expect, test } from "@playwright/test";

for (const phase of ["window", "document"] as const) {
  for (const mode of ["Reading", "Live Preview"] as const) {
    test(`${mode} isolates an earlier ${phase}-capture host keymap and restores it on focus exit/disposal`, async ({ page }) => {
      await page.goto("/"); await page.evaluate(() => window.ready);
      const doc = "Synthetic alpha beta\n\n```mermaid\nflowchart LR\nA[Disposable]-->B[Fixture]\n```\n\nOmega";
      await page.evaluate(({ phase, mode, doc }) => {
        const h = window.harness;
        h.keyboardHost.install(phase, "host-keys");
        h.editors.create("host-keys", mode === "Live Preview" ? doc : "Synthetic alpha beta");
        h.editors.select("host-keys", [[10, 15]]);
        if (mode === "Reading") h.mountSamples(["flowchart", "class"]);
      }, { phase, mode, doc });
      const viewers = page.locator(".mermaid-excalidraw-container");
      await expect(page.locator('[data-state="ready"]')).toHaveCount(mode === "Reading" ? 2 : 1);
      const before = await page.evaluate(() => window.harness.editors.snapshot("host-keys"));
      for (const viewer of await viewers.all()) {
        const wrapper = viewer.locator(".excalidraw").first();
        await wrapper.focus();
        for (const code of ["KeyO", "Slash", "KeyP"]) {
          // Both original canvas target and focused wrapper are covered. Host
          // effects live outside the viewer and intentionally ignore late
          // defaultPrevented, as an already-run host command cannot be undone.
          for (const target of [viewer.locator("canvas.interactive"), wrapper]) {
            const blocked = await target.evaluate((node, code) => {
              const event = new KeyboardEvent("keydown", { key: code === "Slash" ? "/" : code.slice(3).toLowerCase(), code,
                metaKey: true, shiftKey: code === "KeyP", bubbles: true, cancelable: true });
              node.dispatchEvent(event); return event.defaultPrevented;
            }, code);
            expect(blocked).toBe(true);
            const host = await page.evaluate(() => window.harness.keyboardHost.snapshot());
            expect(host.effects).toEqual([]);
            expect(host.scopeDepth).toBe(1);
            expect(await page.evaluate(() => window.harness.editors.snapshot("host-keys"))).toEqual(before);
            await expect(page.locator(".prompt-input, .modal-container, [role=dialog]")).toHaveCount(0);
          }
        }
        const reset = viewer.getByRole("button", { name: "Reset zoom", exact: true });
        const zoom = await reset.textContent();
        await wrapper.evaluate(node => node.dispatchEvent(new KeyboardEvent("keydown", {
          key: "=", code: "Equal", metaKey: true, bubbles: true, cancelable: true,
        })));
        await expect(reset).not.toHaveText(zoom!);
        await expect(page.locator(".prompt-input, .modal-container, [role=dialog]")).toHaveCount(0);
      }
      // Shift+Tab follows natural host tab order. Never insert fixture controls
      // into CM6-owned contentDOM: its DOM observer removes foreign children.
      const first = viewers.first(), wrapper = first.locator(".excalidraw").first();
      await first.evaluate((node, mode) => {
        const input = document.createElement("input"); input.id = "host-before-viewer";
        (mode === "Live Preview" ? node.closest("#host-keys")! : node).before(input);
      }, mode);
      await wrapper.focus(); await page.keyboard.press("Shift+Tab");
      if (mode === "Reading") await expect(page.locator("#host-before-viewer")).toBeFocused();
      else await expect.poll(() => page.evaluate(() => {
        const active = document.activeElement;
        return active === window.harness.editors.view("host-keys").contentDOM || active?.id === "host-before-viewer";
      })).toBe(true);
      expect((await page.evaluate(() => window.harness.keyboardHost.snapshot())).scopeDepth).toBe(0);
      await page.keyboard.press("Meta+o");
      await expect(page.locator(".prompt-input")).toBeFocused();
      await page.evaluate(() => window.harness.keyboardHost.clearPrompts());
      // Source editing remains under the real CM6 editor's ownership.
      await page.evaluate(() => window.harness.editors.view("host-keys").focus());
      await page.keyboard.press("Meta+/");
      expect((await page.evaluate(() => window.harness.editors.snapshot("host-keys"))).doc).toContain("%%alpha%%");
      await wrapper.focus();
      expect((await page.evaluate(() => window.harness.keyboardHost.snapshot())).scopeDepth).toBe(1);
      await page.evaluate(mode => {
        if (mode === "Live Preview") window.harness.editors.destroy("host-keys");
        else window.harness.clear();
      }, mode);
      await expect(page.locator("canvas")).toHaveCount(0);
      expect((await page.evaluate(() => window.harness.keyboardHost.snapshot())).scopeDepth).toBe(0);
      await page.evaluate(() => {
        document.querySelector("#host-before-viewer")?.remove();
        const input = document.createElement("input"); input.id = "host-after-disposal"; document.body.append(input); input.focus();
      });
      await page.keyboard.press("Meta+o");
      await expect(page.locator(".prompt-input")).toBeFocused();
    });
  }
}

for (const removal of ["Back-to-content", "InlineError"] as const) {
  test(`${removal} removes the focused control without trapping host shortcuts`, async ({ page }, testInfo) => {
    await page.goto("/"); await page.evaluate(() => window.ready);
    await page.evaluate(removal => {
      const h = window.harness;
      h.keyboardHost.install("window", "host-keys");
      h.editors.create("host-keys", "Synthetic alpha beta");
      h.editors.select("host-keys", [[10, 15]]);
      h.mountSamples([removal === "InlineError" ? "class" : "flowchart"]);
    }, removal);
    const viewer = page.locator(".mermaid-excalidraw-container");
    await expect(page.locator('[data-state="ready"]')).toHaveCount(1);
    const sourceBefore = await page.evaluate(() => window.harness.editors.snapshot("host-keys"));
    if (removal === "Back-to-content") {
      const canvas = viewer.locator("canvas.interactive");
      await canvas.hover({ position: { x: 100, y: 100 } });
      await page.mouse.wheel(10_000, 10_000);
      const back = viewer.locator(".scroll-back-to-content");
      await expect(back).toBeVisible();
      await back.focus();
      expect((await page.evaluate(() => window.harness.keyboardHost.snapshot())).scopeDepth).toBe(1);
      await page.keyboard.press("Enter");
      await expect(back).toHaveCount(0);
    } else {
      await viewer.getByRole("button", { name: "Reset zoom", exact: true }).focus();
      expect((await page.evaluate(() => window.harness.keyboardHost.snapshot())).scopeDepth).toBe(1);
      await page.evaluate(async () => {
        window.harness.corruptSceneSvg();
        await window.harness.updateSettings({ roughness: 2 });
      });
      await expect(viewer.locator(".mermaid-excalidraw-error")).toBeVisible();
      await expect(viewer.locator("canvas")).toHaveCount(0);
    }
    const afterRemoval = await page.evaluate(() => ({
      ...window.harness.keyboardHost.snapshot(), activeTag: document.activeElement?.tagName,
      focusInside: !!document.activeElement?.closest(".mermaid-excalidraw-container"),
    }));
    // No outside focus() or click: host commands must work immediately after
    // the actual production UI removes its focused button.
    await page.keyboard.press("Meta+Shift+p");
    await page.keyboard.press("Meta+o");
    const afterCommands = await page.evaluate(() => ({
      ...window.harness.keyboardHost.snapshot(), prompt: !!document.querySelector(".prompt-input"),
      palette: !!document.querySelector(".modal-container"), source: window.harness.editors.snapshot("host-keys"),
    }));
    await testInfo.attach("focused-control-removal", { body: JSON.stringify({ removal, afterRemoval, afterCommands }), contentType: "application/json" });
    expect(afterRemoval.focusInside).toBe(false);
    expect(afterRemoval.scopeDepth).toBe(0);
    expect(afterCommands.effects).toEqual(["command-palette", "quickswitcher"]);
    expect(afterCommands.prompt).toBe(true); expect(afterCommands.palette).toBe(true);
    expect(afterCommands.source).toEqual(sourceBefore);
  });
}
