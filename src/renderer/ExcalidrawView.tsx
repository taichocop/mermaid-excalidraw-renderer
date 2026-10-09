import { Component, useCallback, useEffect, useLayoutEffect, useRef, useState, type ErrorInfo, type ReactNode } from "react";
import {
  CaptureUpdateAction,
  Excalidraw,
  MainMenu,
  convertToExcalidrawElements,
} from "@excalidraw/excalidraw";
import type { ExcalidrawImperativeAPI, Zoom } from "@excalidraw/excalidraw/types";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import type { PluginSettings } from "../types";
import { applyAppearance } from "../appearance/applyAppearance";
import { normalizeSvgFiles } from "../appearance/normalizeSvgFiles";
import type { ResolvedTheme } from "../appearance/resolveTheme";
import { errorMessage, type DiagramData } from "./conversion";
import { installViewOnlyBoundary, type ViewerKeymap } from "./viewOnlyBoundary";
import { canvasFitOptions } from "./layout";

export interface ViewSceneCache {
  converted?: { data: DiagramData; elements: ExcalidrawElement[] };
  scene?: { data: DiagramData; appearance: ResolvedTheme; roughness: number; value: ReturnType<typeof normalizeSvgFiles> };
}

export interface ViewProps {
  data: DiagramData;
  appearance: ResolvedTheme;
  settings: PluginSettings;
  container: HTMLElement;
  keymap: ViewerKeymap;
  sceneCache: ViewSceneCache;
  onOpen?: (opener: HTMLButtonElement) => void;
  onClose?: () => void;
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

export function ExcalidrawView({ data, appearance, settings, container, keymap, sceneCache, onOpen, onClose }: ViewProps) {
  const enlarged = !!onClose;
  useLayoutEffect(() => enlarged
    ? installViewOnlyBoundary(container, keymap, { onEscape: onClose, blockWheel: true })
    : undefined, [container, keymap, enlarged, onClose]);
  const [api, setApi] = useState<ExcalidrawImperativeAPI | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const pointer = useRef<{ x: number; y: number; moved: boolean } | null>(null);
  const [zoom, setZoom] = useState(1);
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
        if (sceneCache.converted?.data !== data) {
          sceneCache.converted = { data, elements: convertToExcalidrawElements(data.elements) };
        }
        if (sceneCache.scene?.data !== data || sceneCache.scene.appearance !== appearance
          || sceneCache.scene.roughness !== settings.roughness) {
          sceneCache.scene = { data, appearance, roughness: settings.roughness, value: normalizeSvgFiles(
            applyAppearance(sceneCache.converted.elements, settings, appearance), data.files, appearance,
          ) };
        }
        const scene = sceneCache.scene.value;
        let initialized = false;
        let viewportSize = "";
        const fit = () => {
          if (cancelled || !initialized) return;
          const width = container.clientWidth;
          if (width === 0) return; // Wait for a hidden pane to become visible.
          if (!enlarged) container.style.height = `${settings.canvasHeight}px`;
          if (frame !== undefined) win.cancelAnimationFrame(frame);
          frame = win.requestAnimationFrame(() => {
            if (cancelled) return;
            // refresh() updates offsets only in 0.18.1. Obsidian can reveal a
            // cached section after Excalidraw measured it at 0x0, so synchronize
            // dimensions through the public scene API before fitting as well.
            api.refresh();
            const width = container.clientWidth;
            const height = enlarged ? container.querySelector<HTMLElement>(".mermaid-excalidraw-canvas")!.clientHeight : container.clientHeight;
            const state = api.getAppState();
            if (state.width !== width || state.height !== height) {
              api.updateScene({ appState: { width, height }, captureUpdate: CaptureUpdateAction.NEVER });
            }
            frame = win.requestAnimationFrame(() => {
              if (!cancelled) api.scrollToContent(api.getSceneElements(),
                canvasFitOptions(container.clientWidth, enlarged ? container.querySelector<HTMLElement>(".mermaid-excalidraw-canvas")!.clientHeight : container.clientHeight, settings.canvasPadding));
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
          const { width, height, zoom } = api.getAppState();
          if (enlarged) setZoom(zoom.value);
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
        observer = new win.ResizeObserver(fit);
        if (enlarged) observer.observe(container.querySelector<HTMLElement>(".mermaid-excalidraw-canvas")!);
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
  }, [api, data, appearance, settings.roughness, settings.canvasHeight, settings.canvasPadding, container, failure, enlarged, sceneCache]);

  if (failure !== null) return <InlineError message={failure} />;
  const changeZoom = (value: number) => {
    if (!api) return;
    const state = api.getAppState();
    const next = Math.max(0.1, Math.min(30, value)) as Zoom["value"];
    api.updateScene({ appState: {
      zoom: { value: next },
      scrollX: state.scrollX + state.width / (2 * next) - state.width / (2 * state.zoom.value),
      scrollY: state.scrollY + state.height / (2 * next) - state.height / (2 * state.zoom.value),
    }, captureUpdate: CaptureUpdateAction.NEVER });
  };
  const fit = () => api?.scrollToContent(api.getSceneElements(),
    canvasFitOptions(api.getAppState().width, api.getAppState().height, settings.canvasPadding));
  const reset = () => {
    changeZoom(1);
    api?.scrollToContent(api.getSceneElements(), { animate: false });
  };
  return <>
    {enlarged && <div className="mermaid-excalidraw-controls" role="group" aria-label="Diagram navigation">
      <button type="button" onClick={() => changeZoom(zoom / 1.2)} disabled={!api} aria-label="Zoom out">−</button>
      <output aria-label="Zoom level">{Math.round(zoom * 100)}%</output>
      <button type="button" onClick={() => changeZoom(zoom * 1.2)} disabled={!api} aria-label="Zoom in">+</button>
      <button type="button" onClick={fit} disabled={!api}>Fit to content</button>
      <button type="button" onClick={reset} disabled={!api}>Reset zoom</button>
      <button type="button" onClick={onClose}>Close preview</button>
    </div>}
    <div className={`mermaid-excalidraw-canvas${enlarged ? "" : " mermaid-excalidraw-passive"}`}
      aria-hidden={enlarged ? undefined : true} ref={node => { if (node) node.inert = !enlarged; }}>
    <Excalidraw
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
  </Excalidraw>
    </div>
    {!enlarged && <button type="button" className="mermaid-excalidraw-open"
      aria-label="Open enlarged Mermaid diagram" aria-haspopup="dialog"
      onPointerDown={event => { pointer.current = { x: event.clientX, y: event.clientY, moved: false }; }}
      onPointerMove={event => {
        if (pointer.current && Math.hypot(event.clientX - pointer.current.x, event.clientY - pointer.current.y) > 5) {
          pointer.current.moved = true;
        }
      }}
      onClick={event => {
        if (!event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey
          && (event.detail === 0 || !pointer.current?.moved)) onOpen?.(event.currentTarget);
        pointer.current = null;
      }}>
      <span>Click to enlarge</span>
    </button>}
  </>;
}
