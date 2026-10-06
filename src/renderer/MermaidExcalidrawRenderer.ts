import type { MarkdownPostProcessorContext } from "obsidian";
import type { DiagramTheme, PluginSettings } from "../types";
import { MermaidConverter } from "./conversion";
import { ExcalidrawRenderChild } from "./ExcalidrawRenderChild";
import { determineTheme } from "./layout";

/** Independent of the registered block name so future integrations can reuse it. */
export class MermaidExcalidrawRenderer {
  private readonly converter = new MermaidConverter();
  private readonly children = new Set<ExcalidrawRenderChild>();
  private disposed = false;

  constructor(private settings: PluginSettings) {}

  render(source: string, element: HTMLElement, context: MarkdownPostProcessorContext): void {
    if (this.disposed) return;
    const container = element.ownerDocument.createElement("div");
    container.className = "mermaid-excalidraw-container";
    container.setAttribute("aria-label", "Mermaid diagram in Excalidraw view mode");
    element.replaceChildren(container);
    const child = new ExcalidrawRenderChild(container, source, { ...this.settings },
      determineTheme(element.ownerDocument.body.classList), this.converter, () => this.children.delete(child));
    this.children.add(child);
    context.addChild(child);
  }

  updateTheme(): void {
    for (const child of this.children) {
      const theme: DiagramTheme = determineTheme(child.containerEl.ownerDocument.body.classList);
      child.updateTheme(theme);
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
