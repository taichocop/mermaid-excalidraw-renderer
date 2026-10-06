import { PluginSettingTab, Setting, type App } from "obsidian";
import type { PluginSettings } from "../types";
import { FONT_SIZE_RANGE, HEIGHT_RANGE } from "./settings";

interface SettingsHost {
  settings: PluginSettings;
  updateSettings(settings: PluginSettings): Promise<void>;
}

export class SettingsTab extends PluginSettingTab {
  constructor(app: App, plugin: ConstructorParameters<typeof PluginSettingTab>[1], private readonly host: SettingsHost) {
    super(app, plugin);
  }

  display(): void {
    this.containerEl.empty();
    new Setting(this.containerEl)
      .setName("Font size")
      .setDesc("Diagram text size in pixels (12–48). Changes apply to open diagrams.")
      .addSlider((slider) => slider.setLimits(FONT_SIZE_RANGE.min, FONT_SIZE_RANGE.max, 1)
        .setValue(this.host.settings.fontSize).setDynamicTooltip()
        .onChange(async (fontSize) => {
          await this.host.updateSettings({ ...this.host.settings, fontSize });
        }));
    new Setting(this.containerEl)
      .setName("Maximum diagram height")
      .setDesc("Maximum canvas height in pixels (200–1200). Larger diagrams fit by zooming out.")
      .addSlider((slider) => slider.setLimits(HEIGHT_RANGE.min, HEIGHT_RANGE.max, 20)
        .setValue(this.host.settings.maxHeight).setDynamicTooltip()
        .onChange(async (maxHeight) => {
          await this.host.updateSettings({ ...this.host.settings, maxHeight });
        }));
  }
}
