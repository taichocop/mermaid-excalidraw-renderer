import type { MarkdownPostProcessorContext } from "obsidian";
import type { PluginSettings } from "../types";
import { MermaidConverter } from "./conversion";
import { ExcalidrawRenderChild } from "./ExcalidrawRenderChild";
import { DiagramMount } from "./DiagramMount";
import { resolveTheme, type ResolvedTheme } from "../appearance/resolveTheme";
import type { ViewerKeymap } from "./viewOnlyBoundary";

/** Independent of the registered block name so future integrations can reuse it. */
export class MermaidExcalidrawRenderer {
  private readonly converter = new MermaidConverter();
  private readonly children = new Set<ExcalidrawRenderChild>();
  private readonly mounts = new Set<DiagramMount>();
  private readonly standardChildren = new Set<ExcalidrawRenderChild>();
  private disposed = false;

  constructor(private settings: PluginSettings, private readonly keymap: ViewerKeymap) {}

  render(source: string, element: HTMLElement, context: MarkdownPostProcessorContext, standard = false): void {
    if (this.disposed) return;
    const container = element.createDiv();
    container.className = "mermaid-excalidraw-container";
    container.setAttribute("aria-label", "Mermaid diagram in Excalidraw view mode");
    element.replaceChildren(container);
    const child = new ExcalidrawRenderChild(container, () => this.createMount(source, container), () => {
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

  createMount(source: string, container: HTMLElement, appearance?: ResolvedTheme): DiagramMount {
    const mount = new DiagramMount(container, source, { ...this.settings },
      appearance ?? resolveTheme(container, this.settings.themeMode), this.converter, () => this.mounts.delete(mount), this.keymap);
    if (this.disposed) mount.dispose();
    else { this.mounts.add(mount); mount.load(); }
    return mount;
  }

  updateTheme(): void {
    for (const mount of this.mounts) {
      mount.updateTheme(resolveTheme(mount.containerEl, this.settings.themeMode));
    }
  }

  updateSettings(settings: PluginSettings): void {
    this.settings = { ...settings };
    for (const mount of this.mounts) mount.updateSettings(settings);
  }

  dispose(): void {
    this.disposed = true;
    for (const child of [...this.children]) child.unload();
    this.children.clear();
    for (const mount of [...this.mounts]) mount.dispose();
  }
}
