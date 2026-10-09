import { describe, expect, it } from "vitest";
import { isViewNavigationKey } from "../../src/renderer/viewOnlyBoundary";
const key = (key: string, options = {}) => ({ key, code: "", ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...options });
describe("view-only shortcut boundary", () => {
  it("keeps navigation without permitting editor/dialog shortcuts", () => {
    for (const value of ["Tab", "Escape", " ", "PageDown", "ArrowRight"]) expect(isViewNavigationKey(key(value))).toBe(true);
    expect(isViewNavigationKey(key("+", { ctrlKey: true, code: "Equal" }))).toBe(true);
    for (const code of ["Equal", "NumpadAdd", "Minus", "NumpadSubtract"]) {
      for (const modifier of ["shiftKey", "ctrlKey", "metaKey"]) {
        expect(isViewNavigationKey(key("layout-dependent", { code, [modifier]: true }))).toBe(true);
      }
      expect(isViewNavigationKey(key("layout-dependent", { code }))).toBe(false);
    }
    for (const code of ["Digit0", "Numpad0"]) {
      for (const modifier of ["shiftKey", "ctrlKey", "metaKey"]) {
        expect(isViewNavigationKey(key("0", { code, [modifier]: true }))).toBe(true);
      }
      expect(isViewNavigationKey(key("0", { code }))).toBe(false);
    }
    expect(isViewNavigationKey(key("!", { shiftKey: true, code: "Digit1" }))).toBe(true);
    for (const value of ["?", "v", "c", "e", "/", "p", "o", "s", "k"]) {
      expect(isViewNavigationKey(key(value))).toBe(false);
      expect(isViewNavigationKey(key(value, { ctrlKey: true, shiftKey: true }))).toBe(false);
      expect(isViewNavigationKey(key(value, { metaKey: true }))).toBe(false);
    }
    expect(isViewNavigationKey(key("r", { altKey: true }))).toBe(false);
  });
});
