import { describe, expect, it } from "vitest";
import { normalizeWheelDelta, zoomAtAnchor, type ZoomViewport } from "../../src/renderer/wheelZoom";

describe("wheel delta normalization", () => {
  it.each([
    [0, 12, 12], [0, -12, -12],
    [1, 2, 36], [1, -2, -36],
    [2, 0.1, 60], [2, -0.1, -60],
  ])("converts delta mode %s delta %s to %s CSS pixels", (mode, delta, expected) => {
    expect(normalizeWheelDelta(delta, mode, 18, 600)).toBeCloseTo(expected);
  });

  it.each([0, 1, 2])("keeps zero and tiny deltas in mode %s", (mode) => {
    const unit = [1, 18, 600][mode]!;
    expect(normalizeWheelDelta(0, mode, 18, 600)).toBe(0);
    expect(normalizeWheelDelta(0.000001, mode, 18, 600)).toBeCloseTo(0.000001 * unit, 12);
    expect(normalizeWheelDelta(-0.000001, mode, 18, 600)).toBeCloseTo(-0.000001 * unit, 12);
  });

  it.each([0, 1, 2])("bounds huge finite deltas before multiplying mode %s", (mode) => {
    expect(normalizeWheelDelta(Number.MAX_VALUE, mode, 18, 600)).toBe(100);
    expect(normalizeWheelDelta(-Number.MAX_VALUE, mode, 18, 600)).toBe(-100);
    expect(normalizeWheelDelta(1, mode, Number.MAX_VALUE, Number.MAX_VALUE)).toBe(mode === 0 ? 1 : 100);
  });

  it.each([NaN, Infinity, -Infinity])("ignores nonfinite delta %s in every mode", (delta) => {
    for (const mode of [0, 1, 2]) expect(normalizeWheelDelta(delta, mode, 18, 600)).toBe(0);
  });

  it.each([NaN, Infinity, -Infinity, -1, 3, 0.5])("ignores invalid delta mode %s", (mode) => {
    expect(normalizeWheelDelta(10, mode, 18, 600)).toBe(0);
  });

  it.each([NaN, Infinity, -Infinity, 0, -1])("ignores invalid measured unit size %s", (size) => {
    for (const mode of [0, 1, 2]) {
      expect(normalizeWheelDelta(10, mode, size, 600)).toBe(0);
      expect(normalizeWheelDelta(10, mode, 18, size)).toBe(0);
    }
  });

  it("uses supplied line and page dimensions rather than fixed unit multipliers", () => {
    expect(normalizeWheelDelta(1, 1, 24, 800)).toBe(24);
    expect(normalizeWheelDelta(0.1, 2, 24, 800)).toBe(80);
  });
});

describe("wheel zoom", () => {
  const viewport: ZoomViewport = { zoom: 2, scrollX: -125, scrollY: 80 };
  const anchor = { x: 450, y: 300 };

  it("maps wheel up to zoom in and wheel down to zoom out at the existing button step", () => {
    expect(zoomAtAnchor(viewport, -100, anchor)?.zoom).toBeCloseTo(2 * 1.2);
    expect(zoomAtAnchor(viewport, 100, anchor)?.zoom).toBeCloseTo(2 / 1.2);
  });

  it("preserves fractional native pinch increments and combines them smoothly", () => {
    const first = zoomAtAnchor(viewport, -0.944, anchor)!;
    expect(first.zoom).toBeGreaterThan(viewport.zoom);
    expect(first.zoom).toBeLessThan(viewport.zoom * 1.01);
    const combined = zoomAtAnchor(first, -4.25, anchor)!;
    expect(combined.zoom).toBeCloseTo(zoomAtAnchor(viewport, -5.194, anchor)!.zoom, 12);
    const restored = zoomAtAnchor(first, 0.944, anchor)!;
    expect(restored.zoom).toBeCloseTo(viewport.zoom, 12);
    expect(restored.scrollX).toBeCloseTo(viewport.scrollX, 10);
    expect(restored.scrollY).toBeCloseTo(viewport.scrollY, 10);
  });

  it.each([-0.000001, 0.000001])("keeps tiny delta %s continuous", (delta) => {
    const next = zoomAtAnchor(viewport, delta, anchor)!;
    expect(next.zoom).not.toBe(viewport.zoom);
    expect(Math.abs(next.zoom - viewport.zoom)).toBeLessThan(0.000001);
    expect(Math.sign(next.zoom - viewport.zoom)).toBe(-Math.sign(delta));
  });

  it.each([-Number.MAX_VALUE, Number.MAX_VALUE])("bounds a huge finite delta %s to one button step", (delta) => {
    expect(zoomAtAnchor(viewport, delta, anchor)).toEqual(zoomAtAnchor(viewport, Math.sign(delta) * 100, anchor));
  });

  it("clamps to the existing manual zoom limits and stops at either limit", () => {
    const minimum = zoomAtAnchor({ ...viewport, zoom: 0.11 }, 100, anchor)!;
    const maximum = zoomAtAnchor({ ...viewport, zoom: 29 }, -100, anchor)!;
    expect(minimum.zoom).toBe(0.1);
    expect(maximum.zoom).toBe(30);
    expect(zoomAtAnchor(minimum, 100, anchor)).toBeNull();
    expect(zoomAtAnchor(maximum, -100, anchor)).toBeNull();
    expect(zoomAtAnchor(minimum, -1, anchor)?.zoom).toBeGreaterThan(0.1);
    expect(zoomAtAnchor(maximum, 1, anchor)?.zoom).toBeLessThan(30);
  });

  it.each([
    ["center", 450, 300], ["top-left", 12, 9], ["bottom-right", 888, 591], ["origin", 0, 0],
  ] as const)("keeps the scene point at the %s anchor for both zoom directions and both limits", (_name, x, y) => {
    for (const [zoom, delta] of [[2, -40.251], [2, 40.251], [0.11, 100], [29, -100]]) {
      const before = { ...viewport, zoom: zoom! };
      const next = zoomAtAnchor(before, delta!, { x, y })!;
      // The public transforms map viewport-local coordinates to scene using
      // local / zoom - scroll, and back using (scene + scroll) * zoom.
      const sceneX = x / before.zoom - before.scrollX;
      const sceneY = y / before.zoom - before.scrollY;
      expect((sceneX + next.scrollX) * next.zoom).toBeCloseTo(x, 9);
      expect((sceneY + next.scrollY) * next.zoom).toBeCloseTo(y, 9);
    }
  });

  it("keeps 30 fast events finite, bounded and monotonic in each direction", () => {
    for (const direction of [-1, 1]) {
      let current = viewport;
      for (let index = 0; index < 30; index++) {
        const next = zoomAtAnchor(current, direction * 40.251, anchor)!;
        expect(next.zoom).toBeGreaterThanOrEqual(0.1);
        expect(next.zoom).toBeLessThanOrEqual(30);
        expect(Number.isFinite(next.scrollX) && Number.isFinite(next.scrollY)).toBe(true);
        expect(Math.sign(next.zoom - current.zoom)).toBe(-direction);
        current = next;
      }
    }
  });

  it.each([0, NaN, Infinity, -Infinity])("ignores zero/nonfinite delta %s", (delta) => {
    expect(zoomAtAnchor(viewport, delta, anchor)).toBeNull();
  });

  it.each([NaN, Infinity, -Infinity])("ignores nonfinite viewport or anchor fields %s", (value) => {
    for (const field of ["zoom", "scrollX", "scrollY"] as const) {
      expect(zoomAtAnchor({ ...viewport, [field]: value }, -10, anchor)).toBeNull();
    }
    for (const field of ["x", "y"] as const) {
      expect(zoomAtAnchor(viewport, -10, { ...anchor, [field]: value })).toBeNull();
    }
  });

  it.each([0, -1])("ignores invalid current zoom %s", (zoom) => {
    expect(zoomAtAnchor({ ...viewport, zoom }, -10, anchor)).toBeNull();
  });

  it("rejects scroll compensation overflow rather than returning nonfinite state", () => {
    expect(zoomAtAnchor({ ...viewport, zoom: Number.MIN_VALUE }, -10, anchor)).toBeNull();
    expect(zoomAtAnchor(viewport, -100, { x: Number.MAX_VALUE, y: -Number.MAX_VALUE })).not.toBeNull();
    expect(zoomAtAnchor({ ...viewport, zoom: 0.1 }, -100, { x: Number.MAX_VALUE, y: 0 })).toBeNull();
  });
});
