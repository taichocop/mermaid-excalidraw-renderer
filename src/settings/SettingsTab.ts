import { PluginSettingTab, Setting, type App } from "obsidian";
import type { PluginSettings } from "../types";
import { CANVAS_HEIGHT_RANGE, CANVAS_PADDING_RANGE, FONT_SIZE_RANGE } from "./settings";

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
      .setName("Render standard mermaid blocks as Excalidraw")
      .setDesc("On by default, including after upgrading. Changes immediately refresh open Reading views. Turn off to restore Obsidian’s standard Mermaid display. Dedicated mermaid-excalidraw blocks always render; standard Mermaid in Live Preview is not supported.")
      .addToggle((toggle) => toggle.setValue(this.host.settings.renderStandardMermaid)
        .onChange(async (renderStandardMermaid) => {
          await this.host.updateSettings({ ...this.host.settings, renderStandardMermaid });
        }));
    new Setting(this.containerEl)
      .setName("Font size")
      .setDesc("Diagram text size in pixels (12–48). Changes apply to open diagrams.")
      .addSlider((slider) => slider.setLimits(FONT_SIZE_RANGE.min, FONT_SIZE_RANGE.max, 1)
        .setValue(this.host.settings.fontSize).setDynamicTooltip()
        .onChange(async (fontSize) => {
          await this.host.updateSettings({ ...this.host.settings, fontSize });
        }));
    new Setting(this.containerEl)
      .setName("Roughness")
      .setDesc("Hand-drawn strokes: 0 = Clean, 1 = Architect, 2 = Artist. SVG fallback images keep their original geometry.")
      .addDropdown((dropdown) => dropdown
        .addOptions({ "0": "Clean", "1": "Architect", "2": "Artist" })
        .setValue(String(this.host.settings.roughness))
        .onChange(async (value) => {
          await this.host.updateSettings({ ...this.host.settings, roughness: Number(value) });
        }));
    new Setting(this.containerEl)
      .setName("Canvas height")
      .setDesc("Canvas height in pixels (240–1200). Width follows the note (100%).")
      .addSlider((slider) => slider.setLimits(CANVAS_HEIGHT_RANGE.min, CANVAS_HEIGHT_RANGE.max, 20)
        .setValue(this.host.settings.canvasHeight).setDynamicTooltip()
        .onChange(async (canvasHeight) => {
          await this.host.updateSettings({ ...this.host.settings, canvasHeight });
        }));
    new Setting(this.containerEl)
      .setName("Canvas padding")
      .setDesc("Space around the diagram in pixels (16–128), with extra room for canvas controls. Reduced in very small panes.")
      .addSlider((slider) => slider.setLimits(CANVAS_PADDING_RANGE.min, CANVAS_PADDING_RANGE.max, 1)
        .setValue(this.host.settings.canvasPadding).setDynamicTooltip()
        .onChange(async (canvasPadding) => {
          await this.host.updateSettings({ ...this.host.settings, canvasPadding });
        }));
    new Setting(this.containerEl)
      .setName("Theme")
      .setDesc("Use Obsidian’s background with contrasting black or white lines and text. Updates open diagrams automatically.")
      .addDropdown((dropdown) => dropdown.addOption("follow-obsidian", "Follow Obsidian")
        .setValue(this.host.settings.themeMode)
        .onChange(async () => {
          await this.host.updateSettings({ ...this.host.settings, themeMode: "follow-obsidian" });
        }));
  }
}
