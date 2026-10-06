import { Notice, Plugin } from "obsidian";
import { MermaidExcalidrawRenderer } from "./renderer/MermaidExcalidrawRenderer";
import { SettingsTab } from "./settings/SettingsTab";
import { DEFAULT_SETTINGS, validateSettings } from "./settings/settings";
import type { PluginSettings } from "./types";

export default class MermaidExcalidrawPlugin extends Plugin {
  settings: PluginSettings = { ...DEFAULT_SETTINGS };
  private renderer: MermaidExcalidrawRenderer | null = null;
  private saves: Promise<void> = Promise.resolve();

  async onload(): Promise<void> {
    try {
      const data: unknown = await this.loadData();
      this.settings = validateSettings(data);
    } catch (error: unknown) {
      console.error("[Mermaid Excalidraw Renderer] Could not load settings", error);
      new Notice("Mermaid Excalidraw: could not load settings; using defaults.");
    }
    this.renderer = new MermaidExcalidrawRenderer(this.settings);
    this.registerMarkdownCodeBlockProcessor("mermaid-excalidraw", (source, element, context) => {
      this.renderer?.render(source, element, context);
    });
    this.registerEvent(this.app.workspace.on("css-change", () => this.renderer?.updateTheme()));
    this.addSettingTab(new SettingsTab(this.app, this, this));
  }

  async updateSettings(settings: PluginSettings): Promise<void> {
    this.settings = validateSettings(settings);
    this.renderer?.updateSettings(this.settings);
    const snapshot = { ...this.settings };
    this.saves = this.saves.then(() => this.saveData(snapshot)).catch((error: unknown) => {
      console.error("[Mermaid Excalidraw Renderer] Could not save settings", error);
      new Notice("Mermaid Excalidraw: could not save settings.");
    });
    await this.saves;
  }

  onunload(): void {
    this.renderer?.dispose();
    this.renderer = null;
  }
}
