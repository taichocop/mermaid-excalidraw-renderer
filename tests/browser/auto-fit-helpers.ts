import { expect, type Page, type Locator } from "@playwright/test";
import type { getCommonBounds } from "@excalidraw/excalidraw";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

declare global { interface Window { fitApis: ExcalidrawImperativeAPI[]; fitBounds: typeof getCommonBounds } }

/** Observe the public callback in the served production bundle. The checked
 * replacement only forwards the identical API to the original React callback;
 * no production diagnostic surface or private upstream state is introduced.
 */
export async function observeFitAPI(page: Page) {
  await page.route("**/main.js", async route => {
    const response = await route.fetch();
    const body = await response.text();
    // Reset already references this public export in the bundled view. Observe
    // that same getCommonBounds function rather than approximate line bounds.
    const boundsPattern = /getSceneElements\(\),\[[^\]]+\]=(\w+)\.length\?(\w+)\(\1\):\[0,0,0,0\]/;
    expect(body.match(new RegExp(boundsPattern.source, "g"))).toHaveLength(1);
    const boundsExport = body.match(boundsPattern)![2]!;
    const pattern = /excalidrawAPI:(\w+),theme:(\w+)\.theme,viewModeEnabled:!0/;
    expect(body.match(new RegExp(pattern.source, "g"))).toHaveLength(1);
    await route.fulfill({ response, body: body.replace(pattern, (_match, callback: string, theme: string) =>
      `excalidrawAPI:a=>{window.fitBounds=${boundsExport};(window.fitApis??=[]).push(a);${callback}(a)},theme:${theme}.theme,viewModeEnabled:!0`) });
  });
}

export async function fitState(page: Page, index = 0) {
  return page.evaluate(index => {
    const api = window.fitApis?.[index];
    if (!api) return null;
    const state = api.getAppState(), elements = api.getSceneElements();
    if (!elements.length) return null;
    const [left, top, right, bottom] = window.fitBounds(elements);
    const bounds = { left, top, right, bottom };
    const projected = {
      left: (bounds.left + state.scrollX) * state.zoom.value,
      top: (bounds.top + state.scrollY) * state.zoom.value,
      right: (bounds.right + state.scrollX) * state.zoom.value,
      bottom: (bounds.bottom + state.scrollY) * state.zoom.value,
    };
    return { zoom: state.zoom.value, width: state.width, height: state.height,
      scrollX: state.scrollX, scrollY: state.scrollY, bounds, projected,
      elements: elements.map(e => ({ type: e.type, x: e.x, y: e.y, width: e.width, height: e.height })) };
  }, index);
}

export async function fitInk(viewer: Locator) {
  return viewer.locator("canvas.static").evaluate(canvas => {
    if (!(canvas instanceof HTMLCanvasElement) || !canvas.width || !canvas.height) return null;
    const width = canvas.width, height = canvas.height;
    const pixels = canvas.getContext("2d", { willReadFrequently: true })!.getImageData(0, 0, width, height).data;
    let left = width, right = 0, top = height, bottom = 0, count = 0;
    for (let i = 0; i < pixels.length; i += 4) {
      if (pixels[i + 3]! > 200 && Math.abs(pixels[i]! - pixels[0]!) > 16) {
        count++; const x = (i / 4) % width, y = Math.floor(i / 4 / width);
        left = Math.min(left, x); right = Math.max(right, x); top = Math.min(top, y); bottom = Math.max(bottom, y);
      }
    }
    const scale = width / canvas.getBoundingClientRect().width;
    return { count, left: left / scale, right: right / scale, top: top / scale, bottom: bottom / scale,
      width: width / scale, height: height / scale };
  });
}

export async function expectFit(page: Page, viewer: Locator, index: number, cap: number, padding = 32) {
  await expect.poll(async () => {
    const s = await fitState(page, index), ink = await fitInk(viewer);
    if (!s || !ink || ink.count < 100) return false;
    const xPad = Math.min(padding, Math.max(0, (s.width - 80) / 2));
    const yPad = Math.min(padding, Math.max(0, (s.height - 80) / 2));
    const captionClearance = await viewer.evaluate(e => {
      const canvas = e.querySelector(".mermaid-excalidraw-canvas"), caption = e.querySelector(".mermaid-excalidraw-open span");
      return canvas && caption && caption.getClientRects().length
        ? Math.max(0, Math.ceil(canvas.getBoundingClientRect().bottom - caption.getBoundingClientRect().top + 8)) : 0;
    });
    const availableMargin = Math.max(0, s.height - 80);
    const bottom = Math.min(availableMargin, Math.max(yPad, captionClearance));
    const top = Math.min(yPad, availableMargin - bottom);
    const expected = Math.min((s.width - 2 * xPad) / (s.bounds.right - s.bounds.left),
      (s.height - top - bottom) / (s.bounds.bottom - s.bounds.top), cap);
    // Upstream 0.18.1 floors to its 0.1 zoom step. Tolerance accommodates actual
    // arrow bounds and subpixel rasterization; no environment-specific float.
    return s.zoom > 0 && Number.isFinite(s.zoom) && s.zoom <= cap
      && s.zoom <= expected + 0.02 && s.zoom >= expected - 0.11
      && s.projected.left >= xPad - 1 && s.projected.right <= s.width - xPad + 1
      && s.projected.top >= top - 1 && s.projected.bottom <= s.height - bottom + 1
      && ink.left > 0 && ink.top > 0 && ink.right < ink.width && ink.bottom < ink.height;
  }).toBe(true);
  return (await fitState(page, index))!;
}

export async function nativeContentInk(page: Page, index: number) {
  return page.evaluate(index => {
    const api = window.fitApis[index]!;
    const state = api.getAppState();
    const canvas = document.querySelectorAll<HTMLCanvasElement>("canvas.static")[index]!;
    const scale = canvas.width / canvas.getBoundingClientRect().width;
    const pixels = canvas.getContext("2d")!.getImageData(0, 0, canvas.width, canvas.height).data;
    const regionInk = (x: number, y: number, width: number, height: number) => {
      const left = Math.max(0, Math.floor((x + state.scrollX) * state.zoom.value * scale));
      const right = Math.min(canvas.width, Math.ceil((x + width + state.scrollX) * state.zoom.value * scale));
      const top = Math.max(0, Math.floor((y + state.scrollY) * state.zoom.value * scale));
      const bottom = Math.min(canvas.height, Math.ceil((y + height + state.scrollY) * state.zoom.value * scale));
      let ink = 0;
      for (let py = top; py < bottom; py++) for (let px = left; px < right; px++) {
        const offset = (py * canvas.width + px) * 4;
        if (pixels[offset + 3]! > 200 && Math.abs(pixels[offset]! - pixels[0]!) > 16) ink++;
      }
      return ink;
    };
    return api.getSceneElements().filter(e => e.type === "text" || e.type === "arrow").map(e => {
      const margin = e.type === "arrow" ? 8 : 0;
      return { type: e.type, text: e.type === "text" ? e.text : null,
        ink: regionInk(e.x - margin, e.y - margin, e.width + 2 * margin, e.height + 2 * margin),
        // Primary Japanese fixture has horizontal arrows. Middle shaft and
        // off-center arrowhead wings exclude neighboring node boundaries.
        shaftInk: e.type === "arrow" ? regionInk(e.x + 5, e.y - 2, e.width - 25, 4) : null,
        headInk: e.type === "arrow" ? regionInk(e.x + e.width - 15, e.y - 8, 12, 6)
          + regionInk(e.x + e.width - 15, e.y + 2, 12, 6) : null,
      };
    });
  }, index);
}
