import { PluginSettingTab, type App, type SettingDefinitionItem } from "obsidian";
import type { PluginSettings } from "../types";
import { CANVAS_HEIGHT_RANGE, CANVAS_PADDING_RANGE, DEFAULT_SETTINGS, FONT_SIZE_RANGE } from "./settings";

interface SettingsHost {
  settings: PluginSettings;
  updateSettings(settings: PluginSettings): Promise<void>;
}

type ControlKey = Exclude<keyof PluginSettings, "maxHeight">;
const CONTROL_KEYS: readonly ControlKey[] = ["renderStandardMermaid", "fontSize", "roughness", "canvasHeight", "canvasPadding", "themeMode"];

export class SettingsTab extends PluginSettingTab {
  constructor(app: App, plugin: ConstructorParameters<typeof PluginSettingTab>[1], private readonly host: SettingsHost) {
    super(app, plugin);
  }

  getSettingDefinitions(): SettingDefinitionItem<ControlKey>[] {
    return [
      {
        name: "Render standard mermaid blocks as Excalidraw",
        desc: "On by default, including after upgrading. Changes immediately refresh Reading view and Live Preview. Turn off to restore Obsidian’s standard Mermaid display. Dedicated mermaid-excalidraw blocks always render. Move the cursor into a block to edit its source.",
        control: { type: "toggle", key: "renderStandardMermaid", defaultValue: DEFAULT_SETTINGS.renderStandardMermaid },
      },
      {
        name: "Font size",
        desc: "Diagram text size in pixels (12–48). Changes apply to open diagrams.",
        control: { type: "slider", key: "fontSize", ...FONT_SIZE_RANGE, step: 1, defaultValue: DEFAULT_SETTINGS.fontSize },
      },
      {
        name: "Roughness",
        desc: "Hand-drawn strokes: 0 = Clean, 1 = Architect, 2 = Artist. SVG fallback images keep their original geometry.",
        control: { type: "dropdown", key: "roughness", options: { "0": "Clean", "1": "Architect", "2": "Artist" }, defaultValue: String(DEFAULT_SETTINGS.roughness) },
      },
      {
        name: "Canvas height",
        desc: "Canvas height in pixels (240–1200). Width follows the note (100%).",
        control: { type: "slider", key: "canvasHeight", ...CANVAS_HEIGHT_RANGE, step: 20, defaultValue: DEFAULT_SETTINGS.canvasHeight },
      },
      {
        name: "Canvas padding",
        desc: "Space around the diagram in pixels (16–128), with extra room for canvas controls. Reduced in very small panes.",
        control: { type: "slider", key: "canvasPadding", ...CANVAS_PADDING_RANGE, step: 1, defaultValue: DEFAULT_SETTINGS.canvasPadding },
      },
      {
        name: "Theme",
        desc: "Use Obsidian’s background with contrasting black or white lines and text. Updates open diagrams automatically.",
        control: { type: "dropdown", key: "themeMode", options: { "follow-obsidian": "Follow Obsidian" }, defaultValue: DEFAULT_SETTINGS.themeMode },
      },
    ];
  }

  getControlValue(key: string): unknown {
    if (!CONTROL_KEYS.includes(key as ControlKey)) return undefined;
    const value = this.host.settings[key as ControlKey];
    return key === "roughness" ? String(value) : value;
  }

  async setControlValue(key: string, value: unknown): Promise<void> {
    if (!CONTROL_KEYS.includes(key as ControlKey)) return;
    // Dropdowns resolve strings; retain the plugin's validation, redraw and
    // serialized-save path instead of the host's default storage convention.
    const candidate = key === "roughness" && typeof value === "string" ? Number(value) : value;
    await this.host.updateSettings({ ...this.host.settings, [key]: candidate });
  }
}
