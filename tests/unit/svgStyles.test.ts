import { describe, expect, it } from "vitest";
import { semanticSvgFill } from "../../src/appearance/svgStyles";

describe("SVG semantic fill policy", () => {
  it("uses resolved foreground for explicitly translucent fills without retaining original colors", () => {
    for (const foreground of ["#000000", "#ffffff"]) {
      for (const opacity of ["0.1", ".5", " 0.95 ", "10%", "5e-1", "+.1"]) {
        expect(semanticSvgFill("red", opacity, foreground)).toBe(foreground);
        expect(semanticSvgFill(null, opacity, foreground)).toBe(foreground);
      }
    }
  });
  it("preserves fill none/transparent regardless of opacity", () => {
    for (const fill of ["none", "transparent", " NONE "]) {
      for (const opacity of [null, "0", "0.1", "1"]) expect(semanticSvgFill(fill, opacity, "#000000")).toBe("none");
    }
  });
  it("retains the opaque/background policy for absent, zero, opaque or invalid fill opacity", () => {
    for (const opacity of [null, "", " ", "0", "0%", "1", "100%", "-0.1", "1.1", "110%", "NaN", "Infinity", "inherit", "0x1", "10px", "%"]) {
      expect(semanticSvgFill("red", opacity, "#ffffff")).toBeNull();
    }
  });
});
