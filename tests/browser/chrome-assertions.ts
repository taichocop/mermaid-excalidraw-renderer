import { expect, type Locator } from "@playwright/test";

/** Production geometry/hit checks. Upstream nodes intentionally remain; these
 * selectors are diagnostic assertions, not runtime DOM removal. */
export async function expectNoMenuChrome(viewer: Locator) {
  await expect(viewer.locator(".main-menu-trigger")).toHaveCount(1);
  await expect.poll(() => viewer.evaluate(container => {
    const region = container.querySelector<HTMLElement>(".mermaid-excalidraw-canvas")!;
    const canvas = region.querySelector<HTMLCanvasElement>("canvas.interactive")!;
    const viewport = region.querySelector<HTMLElement>(".excalidraw")!;
    const bounds = region.getBoundingClientRect();
    const controls = container.querySelector<HTMLElement>(".mermaid-excalidraw-controls");
    const inline = !!container.querySelector(".mermaid-excalidraw-open");
    const chrome = [...region.querySelectorAll<HTMLElement>(
      ".main-menu-trigger, .App-menu, .App-bottom-bar, .App-bottom-bar .Island, .App-bottom-bar footer, .App-toolbar-content",
    )];
    const zeroGeometry = chrome.every(node => {
      const rect = node.getBoundingClientRect();
      return node.getClientRects().length === 0 && rect.width === 0 && rect.height === 0;
    });
    // Measured trigger centers are 34px from the desktop top/left and 38px
    // from the mobile bottom/left. Keep samples across the empty bar as well.
    const triggerInset = region.querySelector(".App-bottom-bar") ? 38 : 34;
    const intendedHits = [triggerInset, bounds.width * 0.5, bounds.width * 0.95].every(x =>
      [triggerInset, bounds.height - triggerInset].every(y => {
        const hit = container.ownerDocument.elementFromPoint(bounds.x + x, bounds.y + y);
        return inline ? hit === container.querySelector(".mermaid-excalidraw-open") : hit === canvas;
      }));
    return {
      zeroGeometry, intendedHits,
      fullViewport: viewport.clientWidth === region.clientWidth && viewport.clientHeight === region.clientHeight
        && Math.abs(canvas.getBoundingClientRect().width - bounds.width) <= 1
        && Math.abs(canvas.getBoundingClientRect().height - bounds.height) <= 1,
      // No chrome row subtracts space from the inline canvas or Modal flex area.
      noChromeSpace: Math.abs(bounds.width - container.clientWidth) <= 1
        && Math.abs(bounds.height + (controls?.getBoundingClientRect().height ?? 0) - container.clientHeight) <= 1,
    };
  })).toEqual({ zeroGeometry: true, intendedHits: true, fullViewport: true, noChromeSpace: true });
}

export async function expectBoundedInk(viewer: Locator) {
  await expect.poll(() => viewer.locator("canvas.static").evaluate(node => {
    const canvas = node as HTMLCanvasElement;
    if (!canvas.width || !canvas.height) return false;
    const data = canvas.getContext("2d", { willReadFrequently: true })!
      .getImageData(0, 0, canvas.width, canvas.height).data;
    let ink = 0, left = canvas.width, right = -1, top = canvas.height, bottom = -1;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3]! > 200 && Math.abs(data[i]! - data[0]!) > 16) {
        ink++;
        const x = (i / 4) % canvas.width, y = Math.floor(i / 4 / canvas.width);
        left = Math.min(left, x); right = Math.max(right, x);
        top = Math.min(top, y); bottom = Math.max(bottom, y);
      }
    }
    const bounds = canvas.getBoundingClientRect();
    const sx = bounds.width / canvas.width, sy = bounds.height / canvas.height;
    return ink > 100 && left * sx > 1 && top * sy > 1
      && (canvas.width - right - 1) * sx > 1 && (canvas.height - bottom - 1) * sy > 1;
  })).toBe(true);
}
