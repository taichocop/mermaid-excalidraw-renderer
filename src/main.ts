import { editorLivePreviewField, MarkdownPreviewRenderer, MarkdownView, Notice, Plugin } from "obsidian";
import { MermaidExcalidrawRenderer } from "./renderer/MermaidExcalidrawRenderer";
import { LivePreview } from "./editor/LivePreview";
import { SettingsTab } from "./settings/SettingsTab";
import { DEFAULT_SETTINGS, validateSettings } from "./settings/settings";
import type { PluginSettings } from "./types";

export default class MermaidExcalidrawPlugin extends Plugin {
  settings: PluginSettings = { ...DEFAULT_SETTINGS };
  private renderer: MermaidExcalidrawRenderer | null = null;
  private livePreview: LivePreview | null = null;
  private saves: Promise<void> = Promise.resolve();

  async onload(): Promise<void> {
    try {
      const data: unknown = await this.loadData();
      this.settings = validateSettings(data);
    } catch (error: unknown) {
      console.error("[Mermaid Excalidraw Renderer] Could not load settings", error);
      new Notice("Mermaid Excalidraw: could not load settings; using defaults.");
    }
    this.renderer = new MermaidExcalidrawRenderer(this.settings, this.app);
    this.livePreview = new LivePreview({
      isLivePreview: (state) => state.field(editorLivePreviewField, false) === true,
      settings: () => this.settings,
      mount: (source, container, appearance) => {
        if (!this.renderer) return { dispose() {} };
        return this.renderer.createMount(source, container, appearance);
      },
    });
    this.registerEditorExtension(this.livePreview.extension);
    this.registerMarkdownCodeBlockProcessor("mermaid-excalidraw", (source, element, context) => {
      this.renderer?.render(source, element, context);
    });
    // Only register a Reading-view postprocessor: code-block registration also
    // claims a language in the editor registry and rejects duplicate handlers.
    // In Obsidian 1.14.4 the built-in Mermaid postprocessor has sort order 0.
    // Consume the original code first, leaving its renderer/other registrations
    // intact. The public Plugin API removes only this callback on unload.
    const standardProcessor = MarkdownPreviewRenderer.createCodeBlockPostProcessor("mermaid", (source, element, context) => {
      this.renderer?.render(source, element, context, true);
    });
    this.registerMarkdownPostProcessor((element, context) => {
      if (this.renderer && this.settings.renderStandardMermaid) standardProcessor(element, context);
    }, -100);
    this.registerEvent(this.app.workspace.on("css-change", () => this.renderer?.updateTheme()));
    this.addSettingTab(new SettingsTab(this.app, this, this));
    this.app.workspace.onLayoutReady(() => {
      if (this.renderer) this.refreshMarkdownPreviews();
    });
  }

  async updateSettings(settings: PluginSettings): Promise<void> {
    const previouslyEnabled = this.settings.renderStandardMermaid;
    this.settings = validateSettings(settings);
    this.renderer?.updateSettings(this.settings);
    this.livePreview?.updateSettings();
    if (previouslyEnabled !== this.settings.renderStandardMermaid) {
      this.renderer?.clearStandardBlocks();
      this.refreshMarkdownPreviews();
    }
    const snapshot = { ...this.settings };
    this.saves = this.saves.then(() => this.saveData(snapshot)).catch((error: unknown) => {
      console.error("[Mermaid Excalidraw Renderer] Could not save settings", error);
      new Notice("Mermaid Excalidraw: could not save settings.");
    });
    await this.saves;
  }

  onunload(): void {
    this.livePreview?.dispose();
    this.livePreview = null;
    this.renderer?.dispose();
    this.renderer = null;
    // Component.unload removes registered callbacks before calling onunload.
    // Full rerender discards existing canvases and restores the host renderer.
    this.refreshMarkdownPreviews();
  }

  private refreshMarkdownPreviews(): void {
    for (const leaf of this.app.workspace.getLeavesOfType("markdown")) {
      // Source-mode leaves retain a preview cache too. Invalidate it now so
      // switching back to Reading view cannot revive stale or empty canvases.
      if (leaf.view instanceof MarkdownView) {
        leaf.view.previewMode.rerender(true);
      }
    }
  }
}
