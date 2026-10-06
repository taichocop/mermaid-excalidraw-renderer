import { MarkdownRenderChild } from "obsidian";
import { createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { DiagramTheme, PluginSettings } from "../types";
import { type DiagramData, MermaidConverter } from "./conversion";
import { DiagramErrorBoundary, ExcalidrawView, InlineError } from "./ExcalidrawView";

export class ExcalidrawRenderChild extends MarkdownRenderChild {
  private root: Root | null = null;
  private controller: AbortController | null = null;
  private generation = 0;
  private data: DiagramData | null = null;
  private message: string | null = null;
  private disposed = false;

  constructor(
    container: HTMLElement,
    private readonly source: string,
    private settings: PluginSettings,
    private theme: DiagramTheme,
    private readonly converter: MermaidConverter,
    private readonly onDispose: () => void,
  ) { super(container); }

  onload(): void {
    this.root = createRoot(this.containerEl);
    this.startConversion();
  }

  updateSettings(settings: PluginSettings): void {
    const shouldConvert = settings.fontSize !== this.settings.fontSize;
    this.settings = { ...settings };
    if (shouldConvert) this.startConversion();
    else this.render();
  }

  updateTheme(theme: DiagramTheme): void {
    if (theme === this.theme) return;
    this.theme = theme;
    this.render();
  }

  private startConversion(): void {
    if (this.disposed || !this.root) return;
    this.controller?.abort();
    const controller = new AbortController();
    this.controller = controller;
    const generation = ++this.generation;
    this.data = null;
    this.message = null;
    this.containerEl.style.height = `${Math.min(240, this.settings.maxHeight)}px`;
    this.containerEl.dataset.state = "loading";
    this.render();
    void this.converter.convert(this.source, this.settings, controller.signal).then((result) => {
      if (this.disposed || generation !== this.generation || result.status === "cancelled") return;
      if (result.status === "error") {
        this.message = result.message;
        this.containerEl.dataset.state = "error";
      } else {
        this.data = result.data;
        this.containerEl.dataset.state = "ready";
      }
      this.render();
    });
  }

  private render(): void {
    if (this.disposed || !this.root) return;
    const content = this.message !== null
      ? createElement(InlineError, { message: this.message })
      : this.data
        ? createElement(ExcalidrawView, {
          data: this.data, theme: this.theme, maxHeight: this.settings.maxHeight,
          container: this.containerEl,
        })
        : createElement("div", { className: "mermaid-excalidraw-loading", role: "status" }, "Rendering diagram…");
    this.root.render(createElement(DiagramErrorBoundary, { key: this.generation, children: content }));
  }

  onunload(): void {
    this.disposed = true;
    this.generation++;
    this.controller?.abort();
    this.controller = null;
    this.root?.unmount();
    this.root = null;
    this.data = null;
    this.onDispose();
  }
}
