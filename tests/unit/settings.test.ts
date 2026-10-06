import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, validateSettings } from "../../src/settings/settings";

describe("persisted settings validation", () => {
  it.each([null, undefined, [], "corrupted", 7])("defaults invalid data %j", (value) => {
    expect(validateSettings(value)).toEqual(DEFAULT_SETTINGS);
  });
  it("clamps and rounds independently", () => {
    expect(validateSettings({ fontSize: 99, maxHeight: 0 })).toEqual({ fontSize: 48, maxHeight: 200 });
    expect(validateSettings({ fontSize: 11, maxHeight: 9999 })).toEqual({ fontSize: 12, maxHeight: 1200 });
    expect(validateSettings({ fontSize: 20.6, maxHeight: 600.2 })).toEqual({ fontSize: 21, maxHeight: 600 });
  });
  it("rejects strings, infinities and NaN without discarding valid fields", () => {
    expect(validateSettings({ fontSize: "22", maxHeight: Infinity })).toEqual(DEFAULT_SETTINGS);
    expect(validateSettings({ fontSize: NaN, maxHeight: 800 })).toEqual({ fontSize: 20, maxHeight: 800 });
  });
});
