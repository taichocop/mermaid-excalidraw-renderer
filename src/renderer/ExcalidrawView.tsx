import { Component, useCallback, useEffect, useLayoutEffect, useRef, useState, type ErrorInfo, type ReactNode } from "react";
import {
  CaptureUpdateAction,
  Excalidraw,
  MainMenu,
  convertToExcalidrawElements,
} from "@excalidraw/excalidraw";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import type { PluginSettings } from "../types";
import { applyAppearance } from "../appearance/applyAppearance";
import { normalizeSvgFiles } from "../appearance/normalizeSvgFiles";
import type { ResolvedTheme } from "../appearance/resolveTheme";
import { errorMessage, type DiagramData } from "./conversion";
import { installViewOnlyBoundary, type ViewerKeymap } from "./viewOnlyBoundary";
import { canvasFitOptions } from "./layout";

interface ViewProps {
  data: DiagramData;
  appearance: ResolvedTheme;
  settings: PluginSettings;
  container: HTMLElement;
  keymap: ViewerKeymap;
}

export function InlineError({ message }: { message: string }) {
  return <div className="mermaid-excalidraw-error" role="alert">
    <strong>Mermaid diagram could not be rendered.</strong>
    <pre className="mermaid-excalidraw-error-detail">{message}</pre>
  </div>;
}

export class DiagramErrorBoundary extends Component<{ children: ReactNode }, { message: string | null }> {
  state: { message: string | null } = { message: null };

  static getDerivedStateFromError(error: unknown) { return { message: errorMessage(error) }; }
  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[Mermaid Excalidraw Renderer] React rendering failed", error, info);
  }
  render() {
    return this.state.message !== null ? <InlineError message={this.state.message} /> : this.props.children;
  }
}

const canvasActions = {
  changeViewBackgroundColor: false, clearCanvas: false, export: false,
  loadScene: false, saveToActiveFile: false, toggleTheme: false, saveAsImage: false,
} as const;

export function ExcalidrawView({ data, appearance, settings, container, keymap }: ViewProps) {
  useLayoutEffect(() => installViewOnlyBoundary(container, keymap), [container, keymap]);
  const [api, setApi] = useState<ExcalidrawImperativeAPI | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const converted = useRef<{ data: DiagramData; elements: ExcalidrawElement[] } | null>(null);
  const receiveAPI = useCallback((value: ExcalidrawImperativeAPI) => setApi(value), []);

  useEffect(() => {
    if (!api || failure !== null) return;
    let cancelled = false;
    let frame: number | undefined;
    const win = container.ownerDocument.defaultView;
    if (!win) return;
    let observer: ResizeObserver | undefined;
    let unsubscribe: (() => void) | undefined;

    // Virgil is the font used by upstream skeleton conversion. Build embeds it
    // in styles.css so measurement uses the same font as the rendered canvas.
    void (async () => {
      try {
        await container.ownerDocument.fonts.load("20px Virgil");
        if (cancelled) return;
        if (converted.current?.data !== data) {
          converted.current = { data, elements: convertToExcalidrawElements(data.elements) };
        }
        const scene = normalizeSvgFiles(
          applyAppearance(converted.current.elements, settings, appearance),
          data.files, appearance,
        );
        let initialized = false;
        let viewportSize = "";
        const fit = () => {
          if (cancelled || !initialized) return;
          const width = container.clientWidth;
          if (width === 0) return; // Wait for a hidden pane to become visible.
          container.style.height = `${settings.canvasHeight}px`;
          if (frame !== undefined) win.cancelAnimationFrame(frame);
          frame = win.requestAnimationFrame(() => {
            if (cancelled) return;
            // refresh() updates offsets only in 0.18.1. Obsidian can reveal a
            // cached section after Excalidraw measured it at 0x0, so synchronize
            // dimensions through the public scene API before fitting as well.
            api.refresh();
            const width = container.clientWidth;
            const height = container.clientHeight;
            const state = api.getAppState();
            if (state.width !== width || state.height !== height) {
              api.updateScene({ appState: { width, height }, captureUpdate: CaptureUpdateAction.NEVER });
            }
            frame = win.requestAnimationFrame(() => {
              if (!cancelled) api.scrollToContent(api.getSceneElements(),
                canvasFitOptions(container.clientWidth, container.clientHeight, settings.canvasPadding));
            });
          });
        };
        const syncViewport = () => {
          if (cancelled || api.getAppState().isLoading) return;
          if (!initialized) {
            initialized = true;
            api.updateScene({
              elements: scene.elements, appState: { viewBackgroundColor: appearance.background },
              captureUpdate: CaptureUpdateAction.NEVER,
            });
            api.addFiles(Object.values(scene.files));
            fit();
          }
          const { width, height } = api.getAppState();
          const size = `${width}x${height}`;
          if (size !== viewportSize) {
            viewportSize = size;
            fit();
          }
        };
        // 0.18.1 provides the API before initialData has finished loading.
        // Watch the public state rather than racing its initialization/resize.
        unsubscribe = api.onChange(syncViewport);
        syncViewport();
        observer = new ResizeObserver(fit);
        observer.observe(container);
      } catch (error: unknown) {
        if (!cancelled) {
          console.error("[Mermaid Excalidraw Renderer] Scene rendering failed", error);
          setFailure(errorMessage(error));
        }
      }
    })();
    return () => {
      cancelled = true;
      unsubscribe?.();
      observer?.disconnect();
      if (frame !== undefined) win.cancelAnimationFrame(frame);
    };
  }, [api, data, appearance, settings.roughness, settings.canvasHeight, settings.canvasPadding, container, failure]);

  if (failure !== null) return <InlineError message={failure} />;
  return <Excalidraw
    excalidrawAPI={receiveAPI}
    theme={appearance.theme}
    viewModeEnabled
    zenModeEnabled
    gridModeEnabled={false}
    handleKeyboardGlobally={false}
    autoFocus={false}
    aiEnabled={false}
    validateEmbeddable={false}
    onPaste={() => false}
    onLinkOpen={(_element, event) => event.preventDefault()}
    initialData={{ appState: { viewBackgroundColor: appearance.background } }}
    UIOptions={{ canvasActions, tools: { image: false } }}
  >
    <MainMenu />
  </Excalidraw>;
}
