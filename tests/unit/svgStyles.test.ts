import { afterEach, describe, expect, it, vi } from "vitest";
import { preserveSemanticFills, semanticSvgFill } from "../../src/appearance/svgStyles";

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

// Exercise paint capture/removal order without a fake SVG renderer. Actual
// XML, CSS priority, stroke pixels and Quadrant disks are covered in Chromium.
class Shape {
  readonly paint: Map<string, string>;
  readonly priorities = new Map<string, string>();
  constructor(readonly attributes: Record<string, string>, styles: Record<string, string> = {}) {
    this.paint = new Map(Object.entries(styles));
  }
  instanceOf(type: unknown) { return type === Shape; }
  getAttribute(name: string) { return this.attributes[name] ?? null; }
  readonly style = {
    getPropertyValue: (name: string) => this.paint.get(name) ?? "",
    removeProperty: (name: string) => { const old = this.paint.get(name) ?? ""; this.paint.delete(name); return old; },
    setProperty: (name: string, value: string, priority = "") => { this.paint.set(name, value); this.priorities.set(name, priority); },
  };
}
const svg = (shapes: Shape[]) => ({ querySelectorAll: () => shapes }) as unknown as Element;
afterEach(() => vi.unstubAllGlobals());

it("captures inline fill-opacity precedence and preserves non-color geometry/opacity/stroke styles", () => {
  vi.stubGlobal("SVGElement", Shape);
  const inline = new Shape({ fill: "blue", "fill-opacity": "1", d: "M0 0h20v20Z" },
    { fill: "red", "fill-opacity": ".25", opacity: ".8", stroke: "green", "stroke-opacity": ".95", "stroke-width": "2.5", transform: "translate(3,4)" });
  const opaque = new Shape({ fill: "red", "fill-opacity": ".25" }, { "fill-opacity": "1" });
  const before = { ...inline.attributes };
  preserveSemanticFills(svg([inline, opaque]), "#ffffff");
  expect(inline.attributes).toEqual(before);
  expect(Object.fromEntries(inline.paint)).toEqual({ fill: "#ffffff", "fill-opacity": ".25", opacity: ".8",
    "stroke-opacity": ".95", "stroke-width": "2.5", transform: "translate(3,4)" });
  expect(inline.priorities.get("fill")).toBe("important");
  expect(opaque.paint.has("fill")).toBe(false);
});

it("keeps empty fills empty and leaves opaque zero-stroke Quadrant/marker attributes intact", () => {
  vi.stubGlobal("SVGElement", Shape);
  const point = new Shape({ fill: "red", "stroke-width": "0" });
  const marker = new Shape({ fill: "red", "stroke-width": "0px" });
  const hollow = new Shape({ "stroke-width": "0" }, { fill: "none", "fill-opacity": ".1" });
  const transparent = new Shape({}, { fill: "transparent" });
  preserveSemanticFills(svg([point, marker, hollow, transparent]), "#000000");
  expect(point.attributes).toEqual({ fill: "red", "stroke-width": "0" });
  expect(marker.attributes).toEqual({ fill: "red", "stroke-width": "0px" });
  expect(point.paint.has("fill")).toBe(false); expect(marker.paint.has("fill")).toBe(false);
  expect(hollow.paint.get("fill")).toBe("none"); expect(hollow.paint.get("fill-opacity")).toBe(".1");
  expect(transparent.paint.get("fill")).toBe("none");
});
