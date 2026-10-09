import { createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { PluginSettings } from "../types";
import { resolveTheme, type ResolvedTheme } from "../appearance/resolveTheme";
import { type DiagramData, MermaidConverter } from "./conversion";
import { DiagramErrorBoundary, ExcalidrawView, InlineError, type ViewProps, type ViewSceneCache } from "./ExcalidrawView";
import type { ViewerKeymap } from "./viewOnlyBoundary";

export interface PreviewHost {
  open(mount: DiagramMount, opener: HTMLButtonElement): void;
  refresh(mount: DiagramMount): void;
  close(mount: DiagramMount): void;
}

/** A rendering session owned by either a Markdown child or an editor widget. */
export class DiagramMount {
  private root: Root | null = null;
  private controller: AbortController | null = null;
  private generation = 0;
  data: DiagramData | null = null;
  private message: string | null = null;
  private disposed = false;
  private readonly sceneCache: ViewSceneCache = {};

  constructor(
    readonly containerEl: HTMLElement,
    private readonly source: string,
    private settings: PluginSettings,
    private appearance: ResolvedTheme,
    private readonly converter: MermaidConverter,
    private readonly onDispose: () => void,
    private readonly keymap: ViewerKeymap,
    private readonly previewHost?: PreviewHost,
  ) {}

  get viewProps(): ViewProps | null {
    return this.data && !this.disposed ? {
      data: this.data, appearance: this.appearance, settings: this.settings,
      container: this.containerEl, keymap: this.keymap, sceneCache: this.sceneCache,
    } : null;
  }

  load(): void {
    if (this.disposed || this.root) return;
    this.root = createRoot(this.containerEl);
    this.startConversion();
  }

  updateSettings(settings: PluginSettings): void {
    const shouldConvert = settings.fontSize !== this.settings.fontSize;
    this.settings = { ...settings };
    this.appearance = resolveTheme(this.containerEl, settings.themeMode);
    this.containerEl.style.height = `${settings.canvasHeight}px`;
    if (shouldConvert) this.startConversion();
    else this.render();
  }

  updateTheme(appearance: ResolvedTheme): void {
    if (appearance.theme === this.appearance.theme && appearance.background === this.appearance.background
      && appearance.foreground === this.appearance.foreground) return;
    this.appearance = appearance;
    this.render();
  }

  private startConversion(): void {
    if (this.disposed || !this.root) return;
    this.previewHost?.close(this);
    this.sceneCache.converted = undefined;
    this.sceneCache.scene = undefined;
    this.controller?.abort();
    const controller = new AbortController();
    this.controller = controller;
    const generation = ++this.generation;
    this.data = null;
    this.message = null;
    this.containerEl.style.height = `${this.settings.canvasHeight}px`;
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
          ...this.viewProps!,
          onOpen: (opener: HTMLButtonElement) => this.previewHost?.open(this, opener),
        })
        : createElement("div", { className: "mermaid-excalidraw-loading", role: "status" }, "Rendering diagram…");
    this.root.render(createElement(DiagramErrorBoundary, { key: this.generation, children: content }));
    this.previewHost?.refresh(this);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.previewHost?.close(this);
    this.generation++;
    this.controller?.abort();
    this.controller = null;
    this.root?.unmount();
    this.root = null;
    this.data = null;
    this.sceneCache.converted = undefined;
    this.sceneCache.scene = undefined;
    this.onDispose();
  }
}
