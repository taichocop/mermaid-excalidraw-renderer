import { describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS, validateSettings } from "../../src/settings/settings";

vi.mock("obsidian", () => ({ PluginSettingTab: class {} }));
import { SettingsTab } from "../../src/settings/SettingsTab";

function fixture() {
  const host = {
    settings: { ...DEFAULT_SETTINGS },
    updateSettings: vi.fn(async (candidate) => { host.settings = validateSettings(candidate); }),
  };
  // The superclass is a disposable fixture, never a real app or vault.
  const tab = new SettingsTab(null!, null!, host);
  return { tab, host };
}

describe("declarative settings", () => {
  it("defines all six searchable controls with ranges and storage types", () => {
    const { tab } = fixture();
    const controls = tab.getSettingDefinitions().map(d => "control" in d ? d.control : undefined);
    expect(controls.map(c => c?.key)).toEqual(["renderStandardMermaid", "fontSize", "roughness", "canvasHeight", "canvasPadding", "themeMode"]);
    expect(controls[1]).toMatchObject({ min: 12, max: 48, step: 1 });
    expect(controls[3]).toMatchObject({ min: 240, max: 1200, step: 20 });
    expect(controls[4]).toMatchObject({ min: 16, max: 128, step: 1 });
    expect(tab.getControlValue("roughness")).toBe("1");
  });
  it("routes all changes through existing validation/redraw/save and ignores unknown keys", async () => {
    const { tab, host } = fixture();
    await tab.setControlValue("renderStandardMermaid", false);
    await tab.setControlValue("fontSize", 100);
    await tab.setControlValue("roughness", "2");
    await tab.setControlValue("canvasHeight", 800);
    await tab.setControlValue("canvasPadding", 96);
    await tab.setControlValue("themeMode", "follow-obsidian");
    expect(host.settings).toMatchObject({ renderStandardMermaid: false, fontSize: 48, roughness: 2, canvasHeight: 800, canvasPadding: 96 });
    expect(host.updateSettings).toHaveBeenCalledTimes(6);
    await tab.setControlValue("__proto__", {});
    await tab.setControlValue("maxHeight", 400);
    expect(host.updateSettings).toHaveBeenCalledTimes(6);
    expect(tab.getControlValue("unknown")).toBeUndefined();
  });
});
