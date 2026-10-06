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
  it("reserves configurable padding and bottom controls using public fit options", () => {
    expect(canvasFitOptions(900, 600, 32)).toEqual({
      fitToContent: true, viewportZoomFactor: 1, animate: false, maxZoom: 1,
      canvasOffsets: { top: 32, right: 32, bottom: 80, left: 32 },
    });
    expect(canvasFitOptions(900, 600, 128).canvasOffsets).toEqual({ top: 128, right: 128, bottom: 176, left: 128 });
  });
  it("keeps the viewport usable with maximum padding in a narrow, short pane", () => {
    expect(canvasFitOptions(160, 240, 128).canvasOffsets).toEqual({ top: 56, right: 40, bottom: 104, left: 40 });
    expect(canvasFitOptions(0, 240, 128).canvasOffsets?.left).toBe(0);
  });
});
