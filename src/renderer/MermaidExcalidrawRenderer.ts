import type { MarkdownPostProcessorContext } from "obsidian";
import type { PluginSettings } from "../types";
import { MermaidConverter } from "./conversion";
import { ExcalidrawRenderChild } from "./ExcalidrawRenderChild";
import { resolveTheme } from "../appearance/resolveTheme";

/** Independent of the registered block name so future integrations can reuse it. */
export class MermaidExcalidrawRenderer {
  private readonly converter = new MermaidConverter();
  private readonly children = new Set<ExcalidrawRenderChild>();
  private readonly standardChildren = new Set<ExcalidrawRenderChild>();
  private disposed = false;

  constructor(private settings: PluginSettings) {}

  render(source: string, element: HTMLElement, context: MarkdownPostProcessorContext, standard = false): void {
    if (this.disposed) return;
    const container = element.createDiv();
    container.className = "mermaid-excalidraw-container";
    container.setAttribute("aria-label", "Mermaid diagram in Excalidraw view mode");
    element.replaceChildren(container);
    const child = new ExcalidrawRenderChild(container, source, { ...this.settings },
      resolveTheme(container, this.settings.themeMode), this.converter, () => {
        this.children.delete(child);
        this.standardChildren.delete(child);
      });
    this.children.add(child);
    if (standard) this.standardChildren.add(child);
    context.addChild(child);
  }

  clearStandardBlocks(): void {
    for (const child of [...this.standardChildren]) child.unload();
  }

  updateTheme(): void {
    for (const child of this.children) {
      child.updateTheme(resolveTheme(child.containerEl, this.settings.themeMode));
    }
  }

  updateSettings(settings: PluginSettings): void {
    this.settings = { ...settings };
    for (const child of this.children) child.updateSettings(settings);
  }

  dispose(): void {
    this.disposed = true;
    for (const child of [...this.children]) child.unload();
    this.children.clear();
  }
}
