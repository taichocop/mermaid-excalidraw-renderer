import { Component, useCallback, useEffect, useLayoutEffect, useRef, useState, type ErrorInfo, type ReactNode } from "react";
import { flushSync } from "react-dom";
import {
  CaptureUpdateAction,
  Excalidraw,
  MainMenu,
  convertToExcalidrawElements,
  getCommonBounds,
} from "@excalidraw/excalidraw";
import type { ExcalidrawImperativeAPI, Zoom } from "@excalidraw/excalidraw/types";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import type { Scope } from "obsidian";
import type { PluginSettings } from "../types";
import { applyAppearance } from "../appearance/applyAppearance";
import { normalizeSvgFiles } from "../appearance/normalizeSvgFiles";
import type { ResolvedTheme } from "../appearance/resolveTheme";
import { errorMessage, type DiagramData } from "./conversion";
import { installViewOnlyBoundary, type ViewerKeymap } from "./viewOnlyBoundary";
import { canvasFitOptions } from "./layout";
import { normalizeWheelDelta, zoomAtAnchor } from "./wheelZoom";
import { installCanvasPan } from "./canvasPan";

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
  modalScope?: Scope;
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

export function ExcalidrawView({ data, appearance, settings, container, keymap, sceneCache, onOpen, onClose, modalScope }: ViewProps) {
  const enlarged = !!onClose;
  const inlineHeight = enlarged ? null : settings.canvasHeight;
  const [api, setApi] = useState<ExcalidrawImperativeAPI | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const pointer = useRef<{ x: number; y: number; moved: boolean } | null>(null);
  const [zoom, setZoom] = useState(1);
  const receiveAPI = useCallback((value: ExcalidrawImperativeAPI) => setApi(value), []);

  const [sceneAPI, setSceneAPI] = useState<ExcalidrawImperativeAPI | null>(null);

  const onCanvasWheel = useCallback((event: WheelEvent, canvas: Element) => {
    if (!api || sceneAPI !== api || failure !== null) return;
    const win = container.ownerDocument.defaultView;
    const rect = canvas.getBoundingClientRect();
    if (!win || rect.width <= 0 || rect.height <= 0
      || !Number.isFinite(event.clientX) || !Number.isFinite(event.clientY)) return;
    const style = win.getComputedStyle(canvas);
    const lineHeight = Number.parseFloat(style.lineHeight);
    // CSS `normal` has no numeric computed line height. Use that canvas's em
    // size rather than guessing a device-dependent wheel line length.
    const linePixels = Number.isFinite(lineHeight) && lineHeight > 0
      ? lineHeight : Number.parseFloat(style.fontSize);
    const delta = normalizeWheelDelta(event.deltaY, event.deltaMode, linePixels, rect.height);
    if (!delta) return;
    const anchor = {
      x: Math.max(0, Math.min(rect.width, event.clientX - rect.left)),
      y: Math.max(0, Math.min(rect.height, event.clientY - rect.top)),
    };
    // updateScene batches React state in 0.18.1. Commit each input through the
    // public React API so a same-task burst reads the preceding zoom/anchor,
    // rather than repeatedly overwriting one old viewport or queuing stale work.
    flushSync(() => {
      const state = api.getAppState();
      const next = zoomAtAnchor({ zoom: state.zoom.value, scrollX: state.scrollX, scrollY: state.scrollY }, delta, anchor);
      if (!next) return;
      api.updateScene({ appState: {
        zoom: { value: next.zoom as Zoom["value"] }, scrollX: next.scrollX, scrollY: next.scrollY,
      }, captureUpdate: CaptureUpdateAction.NEVER });
    });
  }, [api, sceneAPI, failure, container]);

  useLayoutEffect(() => {
    if (!enlarged) return;
    const disposeBoundary = installViewOnlyBoundary(container, keymap, {
      onEscape: onClose, blockWheel: true, onCanvasWheel, parentScope: modalScope,
      wheelRoot: container.closest<HTMLElement>(".mermaid-excalidraw-modal") ?? container,
    });
    const disposePan = installCanvasPan(container, canvas => {
      if (!api || sceneAPI !== api || failure !== null || canvas.getBoundingClientRect().width <= 0) return;
      return (dx, dy) => {
        flushSync(() => {
          const state = api.getAppState();
          if (!Number.isFinite(state.zoom.value) || state.zoom.value <= 0) return;
          const scrollX = state.scrollX + dx / state.zoom.value;
          const scrollY = state.scrollY + dy / state.zoom.value;
          if (!Number.isFinite(scrollX) || !Number.isFinite(scrollY)) return;
          api.updateScene({ appState: { scrollX, scrollY }, captureUpdate: CaptureUpdateAction.NEVER });
        });
      };
    });
    return () => { disposePan(); disposeBoundary(); };
  }, [container, keymap, enlarged, onClose, onCanvasWheel, modalScope, api, sceneAPI, failure]);

  // Updating colors/roughness does not change the user's viewport. Font/source
  // reconversion creates a new view through DiagramMount's existing lifecycle.
  useEffect(() => {
    if (!api || failure !== null) return;
    let cancelled = false;
    let unsubscribe: (() => void) | undefined;
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
        const applyScene = () => {
          if (cancelled || initialized || api.getAppState().isLoading) return;
          initialized = true;
          api.updateScene({
            elements: scene.elements, appState: { viewBackgroundColor: appearance.background },
            captureUpdate: CaptureUpdateAction.NEVER,
          });
          api.addFiles(Object.values(scene.files));
          setSceneAPI(api);
        };
        // The public API arrives before initialData finishes loading in 0.18.1.
        unsubscribe = api.onChange(applyScene);
        applyScene();
      } catch (error: unknown) {
        if (!cancelled) {
          console.error("[Mermaid Excalidraw Renderer] Scene rendering failed", error);
          setFailure(errorMessage(error));
        }
      }
    })();
    return () => { cancelled = true; unsubscribe?.(); };
  }, [api, data, appearance, settings.roughness, container, failure, sceneCache]);

  useEffect(() => {
    if (!api || sceneAPI !== api || failure !== null) return;
    const win = container.ownerDocument.defaultView;
    const canvas = container.querySelector<HTMLElement>(".mermaid-excalidraw-canvas");
    if (!win || !canvas) return;
    const caption = enlarged ? null : container.querySelector<HTMLElement>(".mermaid-excalidraw-open span");
    if (inlineHeight !== null) container.style.height = `${inlineHeight}px`;
    let cancelled = false;
    let frame: number | undefined;
    let viewportSize = "";
    let pendingSize = "";
    const fitViewport = () => {
      if (cancelled || api.getAppState().isLoading) return;
      const width = canvas.clientWidth, height = canvas.clientHeight;
      // The passive opener's visible caption is the only inline overlay.
      // Measure its clearance, including a small stroke margin, instead of
      // reserving space for removed upstream chrome.
      const bottomClearance = caption && caption.getClientRects().length
        ? Math.max(0, Math.ceil(canvas.getBoundingClientRect().bottom - caption.getBoundingClientRect().top + 8)) : 0;
      const options = canvasFitOptions(width, height, settings.canvasPadding, enlarged ? "modal" : "inline", bottomClearance);
      const size = `${width}x${height}x${bottomClearance}`;
      if (!options) {
        // A reveal must fit even if its size equals the last visible size.
        viewportSize = "";
        pendingSize = "";
        if (frame !== undefined) win.cancelAnimationFrame(frame);
        return;
      }
      const current = api.getAppState();
      if (size === viewportSize && current.width === width && current.height === height) return;
      if (size === pendingSize) return;
      pendingSize = size;
      if (frame !== undefined) win.cancelAnimationFrame(frame);
      frame = win.requestAnimationFrame(() => {
        if (cancelled || canvas.clientWidth !== width || canvas.clientHeight !== height) {
          pendingSize = "";
          if (!cancelled) fitViewport();
          return;
        }
        // refresh updates offsets only in 0.18.1. Synchronize dimensions via
        // the public scene API for panes initially measured while hidden.
        api.refresh();
        const state = api.getAppState();
        if (state.width !== width || state.height !== height) {
          api.updateScene({ appState: { width, height }, captureUpdate: CaptureUpdateAction.NEVER });
        }
        frame = win.requestAnimationFrame(() => {
          if (cancelled) return;
          if (canvas.clientWidth !== width || canvas.clientHeight !== height) {
            pendingSize = "";
            fitViewport();
            return;
          }
          pendingSize = "";
          // React may defer updateScene beyond a frame, especially when several
          // hidden SVG viewers reveal together. Wait for public onChange to
          // confirm dimensions rather than fitting against 0px or stale width.
          const committed = api.getAppState();
          if (committed.width !== width || committed.height !== height) return;
          viewportSize = size;
          api.scrollToContent(api.getSceneElements(), options);
        });
      });
    };
    const syncViewport = () => {
      if (enlarged) setZoom(api.getAppState().zoom.value);
      fitViewport();
    };
    const unsubscribe = api.onChange(syncViewport);
    syncViewport();
    const observer = new win.ResizeObserver(fitViewport);
    observer.observe(canvas);
    observer.observe(container);
    if (caption) observer.observe(caption);
    return () => {
      cancelled = true;
      unsubscribe();
      observer.disconnect();
      if (frame !== undefined) win.cancelAnimationFrame(frame);
    };
  }, [api, sceneAPI, data, inlineHeight, settings.canvasPadding, container, failure, enlarged]);

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
  const fit = () => {
    if (!api) return;
    const canvas = container.querySelector<HTMLElement>(".mermaid-excalidraw-canvas");
    const options = canvasFitOptions(canvas?.clientWidth ?? 0, canvas?.clientHeight ?? 0, settings.canvasPadding, "modal");
    if (options) api.scrollToContent(api.getSceneElements(), options);
  };
  const reset = () => {
    if (!api) return;
    const state = api.getAppState();
    const elements = api.getSceneElements();
    const [minX, minY, maxX, maxY] = elements.length ? getCommonBounds(elements) : [0, 0, 0, 0] as const;
    // Commit scale and content center together. A second scrollToContent call
    // in this React handler can read the old zoom before updateScene commits.
    api.updateScene({ appState: {
      zoom: { value: 1 as Zoom["value"] },
      scrollX: state.width / 2 - (minX + maxX) / 2,
      scrollY: state.height / 2 - (minY + maxY) / 2,
    }, captureUpdate: CaptureUpdateAction.NEVER });
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
    {/* The empty public replacement suppresses default menu items. Omitting it
        restores upstream's menu; viewer-scoped CSS hides the retained chrome. */}
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
