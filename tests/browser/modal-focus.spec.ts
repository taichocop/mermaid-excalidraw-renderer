import { expect, test } from "@playwright/test";
import { expectNoMenuChrome } from "./chrome-assertions";

// Same-origin frames model independent owner documents without native Vaults.
// The host fixture restores saved window/focus after onClose and puts app scope
// above Modal.scope, so late DOM-only guards cannot hide either regression.
test("A → B → A popout replacement never focuses the old opener and cleans up", async ({ page }, testInfo) => {
  await page.goto("/"); await page.evaluate(() => window.ready);
  await page.evaluate(() => {
    const h = window.harness;
    h.editors.create("focus-host", "Synthetic alpha beta");
    h.keyboardHost.install("window", "focus-host");
    h.mountInFrame("flowchart LR\nA[First]-->B", "popout-a");
    h.mountInFrame("classDiagram\nclass Second", "popout-b");
  });
  const frames = [page.frameLocator("#popout-a"), page.frameLocator("#popout-b")];
  for (const frame of frames) await expect(frame.locator('[data-state="ready"]')).toHaveCount(1);
  await page.evaluate(() => {
    for (const id of ["popout-a", "popout-b"]) {
      const doc = (document.getElementById(id) as HTMLIFrameElement).contentDocument!;
      const opener = doc.querySelector<HTMLButtonElement>(".mermaid-excalidraw-open")!;
      opener.dataset.focusCount = "0";
      opener.addEventListener("focus", () => { opener.dataset.focusCount = String(Number(opener.dataset.focusCount) + 1); });
    }
  });
  const observations: unknown[] = [];
  for (const [index, id] of [[0, "popout-a"], [1, "popout-b"], [0, "popout-a"]] as const) {
    // Independent popouts can activate while another window's Modal is open.
    await page.evaluate(id => {
      const frame = document.getElementById(id) as HTMLIFrameElement;
      const opener = frame.contentDocument!.querySelector<HTMLButtonElement>(".mermaid-excalidraw-open")!;
      frame.contentWindow!.focus(); opener.focus({ preventScroll: true });
      for (const other of document.querySelectorAll<HTMLIFrameElement>("iframe")) {
        other.contentDocument!.querySelector<HTMLButtonElement>(".mermaid-excalidraw-open")!.dataset.focusCount = "0";
      }
      opener.click();
    }, id);
    await expect(frames[index]!.getByRole("dialog")).toHaveCount(1);
    await expect(frames[1 - index]!.getByRole("dialog")).toHaveCount(0);
    const observation = await page.evaluate(() => {
      return [...document.querySelectorAll<HTMLIFrameElement>("iframe")].map(frame => ({
        id: frame.id, dialogs: frame.contentDocument!.querySelectorAll('[role="dialog"]').length,
        openerFocusEvents: Number(frame.contentDocument!.querySelector<HTMLElement>(".mermaid-excalidraw-open")!.dataset.focusCount),
      }));
    });
    observations.push(observation);
    expect(observation.filter(entry => entry.id !== id).every(entry => entry.openerFocusEvents === 0)).toBe(true);
  }
  const a = frames[0]!, opener = a.getByRole("button", { name: "Open enlarged Mermaid diagram" });
  await a.getByRole("dialog").getByRole("button", { name: "Zoom in", exact: true }).focus();
  await page.keyboard.press("Escape");
  await expect(a.getByRole("dialog")).toHaveCount(0);
  await expect(opener).toBeFocused();
  expect((await page.evaluate(() => window.harness.keyboardHost.snapshot())).scopeDepth).toBe(0);
  await opener.click();
  await page.evaluate(() => window.harness.disable());
  for (const frame of frames) {
    await expect(frame.getByRole("dialog")).toHaveCount(0);
    await expect(frame.locator("canvas")).toHaveCount(0);
  }
  expect((await page.evaluate(() => window.harness.keyboardHost.snapshot())).scopeDepth).toBe(0);
  await testInfo.attach("popout-replacement-focus", { body: JSON.stringify(observations), contentType: "application/json" });
});

for (const phase of ["window", "document"] as const) {
  test(`Modal Tab wraps both ways and blocks inherited host commands before ${phase} capture`, async ({ page }) => {
    await page.goto("/"); await page.evaluate(() => window.ready);
    await page.evaluate(phase => {
      const h = window.harness;
      h.editors.create("tab-host", "Synthetic alpha beta");
      h.editors.select("tab-host", [[10, 15]]);
      h.keyboardHost.install(phase, "tab-host");
      h.mountSamples(["flowchart"]);
      const input = document.createElement("input"); input.id = "outside-modal"; document.body.append(input);
    }, phase);
    const before = await page.evaluate(() => window.harness.editors.snapshot("tab-host"));
    const opener = page.getByRole("button", { name: "Open enlarged Mermaid diagram" });
    await expect(opener).toHaveCount(1); await opener.click();
    const modal = page.getByRole("dialog");
    await expect(modal).toHaveCount(1);
    const last = modal.getByRole("button", { name: "Close preview", exact: true });
    const first = modal.getByRole("button", { name: "Close dialog", exact: true });
    const controls = [first, modal.getByRole("button", { name: "Zoom out", exact: true }),
      modal.getByRole("button", { name: "Zoom in", exact: true }),
      modal.getByRole("button", { name: "Fit to content", exact: true }),
      modal.getByRole("button", { name: "Reset zoom", exact: true }), last];
    await expect(last).toBeVisible();
    for (const viewport of [{ width: 1100, height: 900 }, { width: 600, height: 500 }]) {
      await page.setViewportSize(viewport);
      await expectNoMenuChrome(modal.locator(".mermaid-excalidraw-enlarged"));
      // Exact traversal includes every host/plugin button and both wraps. The
      // public Modal Scope skips the canvas region, whose root remains tabbable.
      await first.focus();
      for (let i = 1; i <= controls.length; i++) {
        await page.keyboard.press("Tab");
        await expect(controls[i % controls.length]!).toBeFocused();
        await expect(page.locator("#outside-modal")).not.toBeFocused();
      }
      for (let i = controls.length - 1; i >= 0; i--) {
        await page.keyboard.press("Shift+Tab");
        await expect(controls[i]!).toBeFocused();
      }
      // A real pointer can focus the canvas; Tab must then return to controls
      // rather than the hidden upstream menu or the background note.
      await modal.locator("canvas.interactive").click({ position: { x: 100, y: 100 } });
      await page.keyboard.press("Tab"); await expect(first).toBeFocused();
      await modal.locator("canvas.interactive").click({ position: { x: 100, y: 100 } });
      await page.keyboard.press("Shift+Tab"); await expect(last).toBeFocused();
    }
    await modal.getByRole("button", { name: "Zoom in", exact: true }).focus();
    for (const shortcut of ["Meta+o", "Control+o", "Meta+Shift+p", "Control+Shift+p", "Meta+/", "Control+/"]) {
      await page.keyboard.press(shortcut);
      expect((await page.evaluate(() => window.harness.keyboardHost.snapshot())).effects).toEqual([]);
      expect(await page.evaluate(() => window.harness.editors.snapshot("tab-host"))).toEqual(before);
      await expect(page.locator(".prompt-input")).toHaveCount(0);
      await expect(modal).toHaveCount(1);
    }
    // Traverse more than a complete control cycle in each direction.
    for (const key of ["Tab", "Shift+Tab"]) for (let i = 0; i < 12; i++) {
      await page.keyboard.press(key);
      expect(await modal.evaluate(node => node.contains(node.ownerDocument.activeElement))).toBe(true);
    }
    await last.focus(); await page.keyboard.press("Escape");
    await expect(modal).toHaveCount(0); await expect(opener).toBeFocused();
    expect((await page.evaluate(() => window.harness.keyboardHost.snapshot())).scopeDepth).toBe(0);
    await page.keyboard.press("Meta+o");
    await expect(page.locator(".prompt-input")).toBeFocused();
    await page.evaluate(() => window.harness.disable());
    expect((await page.evaluate(() => window.harness.keyboardHost.snapshot())).scopeDepth).toBe(0);
  });
}
