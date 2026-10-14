import { expect, test, type Page } from "@playwright/test";

async function holdPreview(page: Page) {
  const handle = await page.evaluateHandle(() => {
    const preview = window.harness.previewHandle();
    if (!preview) throw new Error("Missing preview");
    const viewer = preview.contentEl.firstElementChild;
    if (!viewer) throw new Error("Missing viewer");
    return { preview, viewer, root: Reflect.get(preview, "root") as unknown };
  });
  return handle;
}

type PreviewHandle = Awaited<ReturnType<typeof holdPreview>>;

async function expectViewer(handle: PreviewHandle, foreign: boolean) {
  expect(await handle.evaluate(({ preview, viewer, root }) => {
    const content = preview.contentEl;
    const owner = content.ownerDocument;
    const Div = Reflect.get(owner.defaultView!, "HTMLDivElement") as typeof HTMLDivElement;
    return {
      tag: viewer.tagName,
      classes: [...viewer.classList].sort(),
      directChildren: content.children.length,
      viewers: content.querySelectorAll(".mermaid-excalidraw-enlarged").length,
      parent: viewer.parentElement === content,
      sameOwner: viewer.ownerDocument === owner,
      foreign: owner !== document,
      ownerRealm: viewer instanceof Div,
      rootPresent: root !== null && root !== undefined,
      sameRoot: Reflect.get(preview, "root") === root,
      sameViewer: Reflect.get(preview, "viewer") === viewer,
    };
  })).toEqual({ tag: "DIV", classes: ["mermaid-excalidraw-container", "mermaid-excalidraw-enlarged"],
    directChildren: 1, viewers: 1, parent: true, sameOwner: true, foreign, ownerRealm: true,
    rootPresent: true, sameRoot: true, sameViewer: true });
}

async function expectDisposed(handle: PreviewHandle) {
  expect(await handle.evaluate(({ preview, viewer }) => ({
    rootCleared: Reflect.get(preview, "root") === null,
    viewerCleared: Reflect.get(preview, "viewer") === null,
    ownerWindowCleared: Reflect.get(preview, "ownerWindow") === null,
    contentEmpty: preview.contentEl.childNodes.length === 0,
    viewerDisconnected: !viewer.isConnected,
    viewerEmpty: viewer.childNodes.length === 0,
  }))).toEqual({ rootCleared: true, viewerCleared: true, ownerWindowCleared: true,
    contentEmpty: true, viewerDisconnected: true, viewerEmpty: true });
}

for (const foreign of [false, true]) {
  test(`Modal DOM preserves ${foreign ? "secondary" : "main"} owner document through refresh, replacement and close`, async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.goto("/"); await page.evaluate(() => window.ready);
    await page.evaluate(foreign => {
      const h = window.harness;
      const source = "flowchart LR\nA[Owner] --> B[Document]";
      const other = "classDiagram\nclass Replacement";
      if (foreign) { h.mountInFrame(source); h.mountInFrame(other, "popout-replacement"); }
      else { h.mount(source); h.mount(other); }
    }, foreign);
    const surface = foreign ? page.frameLocator("#popout-fixture") : page;
    const opener = surface.getByRole("button", { name: "Open enlarged Mermaid diagram" }).first();
    const nextSurface = foreign ? page.frameLocator("#popout-replacement") : page;
    const replacementOpener = nextSurface.getByRole("button", { name: "Open enlarged Mermaid diagram" }).nth(foreign ? 0 : 1);
    let modal = surface.getByRole("dialog", { name: "Mermaid diagram preview" });
    await opener.click();
    await expect(modal.locator("canvas.static")).toBeVisible();
    await expect(modal.getByRole("button", { name: "Close preview", exact: true })).toBeVisible();
    const first = await holdPreview(page);
    await expectViewer(first, foreign);
    if (foreign) await expect(page.getByRole("dialog")).toHaveCount(0);

    // A refresh must retain the same public parent, viewer node and React root.
    await first.evaluate(({ preview }) => preview.refresh());
    await expect(modal.getByRole("button", { name: "Close preview", exact: true })).toBeVisible();
    await expectViewer(first, foreign);

    // Another diagram replaces the prior preview; reactivating the same one is
    // intentionally deduplicated. Retain the original nodes to verify unmount.
    await replacementOpener.evaluate(node => {
      node.ownerDocument.defaultView!.focus();
      (node as HTMLButtonElement).focus();
      (node as HTMLButtonElement).click();
    });
    if (foreign) await expect(modal).toHaveCount(0);
    modal = nextSurface.getByRole("dialog", { name: "Mermaid diagram preview" });
    await expect(modal).toHaveCount(1);
    await expect(modal.locator("canvas.static")).toBeVisible();
    await expectDisposed(first); await first.dispose();
    const replacement = await holdPreview(page);
    await expectViewer(replacement, foreign);
    await modal.getByRole("button", { name: "Zoom in", exact: true }).focus();
    await page.keyboard.press("Escape");
    await expect(modal).toHaveCount(0); await expect(replacementOpener).toBeFocused();
    await expectDisposed(replacement); await replacement.dispose();

    await replacementOpener.click();
    await expect(modal.locator("canvas.static")).toBeVisible();
    const reopened = await holdPreview(page);
    await expectViewer(reopened, foreign);
    await modal.getByRole("button", { name: "Close preview", exact: true }).click();
    await expect(modal).toHaveCount(0); await expect(replacementOpener).toBeFocused();
    await expectDisposed(reopened); await reopened.dispose();
    expect(await page.evaluate(() => window.harness.previewHandle())).toBeNull();
    expect(errors).toEqual([]);
  });
}
