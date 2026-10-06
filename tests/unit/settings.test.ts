import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, validateSettings } from "../../src/settings/settings";

describe("persisted settings validation", () => {
  it.each([null, undefined, [], "corrupted", 7])("defaults invalid data %j", (value) => {
    expect(validateSettings(value)).toEqual(DEFAULT_SETTINGS);
  });
  it("clamps and rounds independently", () => {
    expect(validateSettings({ fontSize: 99, maxHeight: 0 })).toEqual({ ...DEFAULT_SETTINGS, fontSize: 48, maxHeight: 200, canvasHeight: 240 });
    expect(validateSettings({ fontSize: 11, maxHeight: 9999 })).toEqual({ ...DEFAULT_SETTINGS, fontSize: 12, maxHeight: 1200, canvasHeight: 1200 });
    expect(validateSettings({ fontSize: 20.6, maxHeight: 600.2 })).toEqual({ ...DEFAULT_SETTINGS, fontSize: 21, maxHeight: 600 });
  });
  it("rejects strings, infinities and NaN without discarding valid fields", () => {
    expect(validateSettings({ fontSize: "22", maxHeight: Infinity })).toEqual(DEFAULT_SETTINGS);
    expect(validateSettings({ fontSize: NaN, maxHeight: 800 })).toEqual({ ...DEFAULT_SETTINGS, maxHeight: 800, canvasHeight: 800 });
  });
  it("validates new settings and prefers explicit canvas height over legacy data", () => {
    expect(validateSettings({ maxHeight: 400, canvasHeight: 1000.7, canvasPadding: 999, roughness: 2, themeMode: "dark" }))
      .toEqual({ ...DEFAULT_SETTINGS, maxHeight: 400, canvasHeight: 1001, canvasPadding: 128, roughness: 2 });
    expect(validateSettings({ canvasHeight: 1, canvasPadding: 0, roughness: 0 }))
      .toEqual({ ...DEFAULT_SETTINGS, canvasHeight: 240, canvasPadding: 16, roughness: 0 });
  });
  it.each([-1, 3, 1.5, "2", NaN, Infinity])("rejects unsupported roughness %s", (roughness) => {
    expect(validateSettings({ roughness }).roughness).toBe(1);
  });
});
