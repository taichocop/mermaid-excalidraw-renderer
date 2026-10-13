import { describe, expect, it } from "vitest";
import { canvasFitOptions } from "../../src/renderer/layout";
import { contrastingForeground, determineTheme } from "../../src/appearance/resolveTheme";

describe("theme", () => {
  it("uses Obsidian's body class", () => {
    expect(determineTheme({ contains: (name) => name === "theme-dark" })).toBe("dark");
    expect(determineTheme({ contains: () => false })).toBe("light");
  });
  it("chooses the higher contrast color from actual background luminance", () => {
    expect(contrastingForeground([255, 255, 255])).toBe("#000000");
    expect(contrastingForeground([30, 30, 30])).toBe("#ffffff");
    expect(contrastingForeground([120, 120, 120])).toBe("#000000");
    expect(contrastingForeground([100, 100, 100])).toBe("#ffffff");
  });
});

describe("canvas viewport", () => {
  it("uses public viewport fitting with separate bounded automatic zoom", () => {
    for (const [mode, maxZoom] of [["inline", 3], ["modal", 4]] as const) {
      expect(canvasFitOptions(900, 600, 32, mode)).toEqual({
        fitToViewport: true, viewportZoomFactor: 1, animate: false, maxZoom,
        canvasOffsets: { top: 32, right: 32, bottom: 32, left: 32 },
      });
    }
  });
  it("reserves only configurable padding, with no hidden bottom chrome space", () => {
    expect(canvasFitOptions(900, 600, 128, "inline")?.canvasOffsets)
      .toEqual({ top: 128, right: 128, bottom: 128, left: 128 });
    expect(canvasFitOptions(900, 600, 128, "modal")?.canvasOffsets)
      .toEqual({ top: 128, right: 128, bottom: 128, left: 128 });
  });
  it("reserves actual inline caption clearance only when padding does not already cover it", () => {
    expect(canvasFitOptions(900, 600, 16, "inline", 24)?.canvasOffsets)
      .toEqual({ top: 16, right: 16, bottom: 24, left: 16 });
    expect(canvasFitOptions(900, 600, 32, "inline", 24)?.canvasOffsets)
      .toEqual({ top: 32, right: 32, bottom: 32, left: 32 });
    expect(canvasFitOptions(900, 600, 16, "modal", 24)?.canvasOffsets)
      .toEqual({ top: 16, right: 16, bottom: 16, left: 16 });
    expect(canvasFitOptions(160, 100, 128, "inline", 24)?.canvasOffsets)
      .toEqual({ top: 0, right: 40, bottom: 20, left: 40 });
  });
  it("keeps at least 80px available by reducing padding in small panes", () => {
    expect(canvasFitOptions(160, 240, 128, "inline")?.canvasOffsets)
      .toEqual({ top: 80, right: 40, bottom: 80, left: 40 });
    expect(canvasFitOptions(50, 50, 128, "modal")?.canvasOffsets)
      .toEqual({ top: 0, right: 0, bottom: 0, left: 0 });
  });
  it.each([[0, 600], [900, 0], [0, 0], [-1, 600], [NaN, 600], [900, Infinity]])(
    "defers zero/invalid viewport %sx%s", (width, height) => {
      expect(canvasFitOptions(width, height, 32, "inline")).toBeNull();
      expect(canvasFitOptions(width, height, 32, "modal")).toBeNull();
    },
  );
  // The public API owns the scene calculation. These cases document the
  // constraints handed to it; production-browser cases check its actual zoom.
  it.each([
    ["inline small scene", 400, 60, "inline", 2.09],
    ["modal small scene", 400, 60, "modal", 2.09],
    ["inline maximum", 100, 60, "inline", 3],
    ["modal maximum", 100, 60, "modal", 4],
    ["width limited", 500, 60, "inline", 1.672],
    ["height limited", 60, 400, "inline", 1.34],
    ["large scene", 1200, 900, "inline", 536 / 900],
    ["extreme wide", 4000, 60, "inline", 0.209],
    ["extreme tall", 60, 4000, "modal", 0.134],
  ] as const)("%s supplies both dimensions and its mode cap", (_name, sceneWidth, sceneHeight, mode, expected) => {
    const options = canvasFitOptions(900, 600, 32, mode)!;
    const offsets = options.canvasOffsets!;
    const width = 900 - offsets.left! - offsets.right!;
    const height = 600 - offsets.top! - offsets.bottom!;
    expect(Math.min(width / sceneWidth, height / sceneHeight, options.maxZoom!)).toBeCloseTo(expected);
    expect(options.fitToViewport).toBe(true);
    expect(options.viewportZoomFactor).toBe(1);
  });
});
