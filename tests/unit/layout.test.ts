import { describe, expect, it } from "vitest";
import { calculateContainerHeight, determineTheme } from "../../src/renderer/layout";

describe("theme", () => {
  it("uses Obsidian's body class", () => {
    expect(determineTheme({ contains: (name) => name === "theme-dark" })).toBe("dark");
    expect(determineTheme({ contains: () => false })).toBe("light");
  });
});

describe("diagram height", () => {
  it("fits the bounding box and clamps tiny and very tall diagrams", () => {
    expect(calculateContainerHeight([0, 0, 200, 300], 640, 600)).toBe(380);
    expect(calculateContainerHeight([0, 0, 10, 10], 640, 600)).toBe(240);
    expect(calculateContainerHeight([0, 0, 200, 9000], 640, 600)).toBe(600);
    expect(calculateContainerHeight([0, 0, 200, 300], 640, 200)).toBe(200);
  });
  it("scales wide diagrams for narrow panes", () => {
    expect(calculateContainerHeight([0, 0, 1000, 1000], 464, 1200)).toBe(480);
  });
  it("handles negative coordinates, hidden panes and invalid bounds", () => {
    expect(calculateContainerHeight([-10, -20, 190, 280], 0, 600)).toBe(380);
    expect(calculateContainerHeight([NaN, 0, Infinity, 20], 640, NaN)).toBe(240);
  });
});
