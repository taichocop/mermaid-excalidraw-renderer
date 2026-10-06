import { Component, useCallback, useEffect, useState, type ErrorInfo, type ReactNode } from "react";
import {
  CaptureUpdateAction,
  Excalidraw,
  MainMenu,
  convertToExcalidrawElements,
  getCommonBounds,
} from "@excalidraw/excalidraw";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import type { DiagramTheme } from "../types";
import { errorMessage, type DiagramData } from "./conversion";
import { calculateContainerHeight } from "./layout";

interface ViewProps {
  data: DiagramData;
  theme: DiagramTheme;
  maxHeight: number;
  container: HTMLElement;
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

export function ExcalidrawView({ data, theme, maxHeight, container }: ViewProps) {
  const [api, setApi] = useState<ExcalidrawImperativeAPI | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
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
        const elements = convertToExcalidrawElements(data.elements);
        const bounds = getCommonBounds(elements);
        let initialized = false;
        let viewportSize = "";
        const fit = () => {
          if (cancelled || !initialized) return;
          const width = container.clientWidth;
          if (width === 0) return; // Wait for a hidden pane to become visible.
          container.style.height = `${calculateContainerHeight(bounds, width, maxHeight)}px`;
          if (frame !== undefined) win.cancelAnimationFrame(frame);
          frame = win.requestAnimationFrame(() => {
            // Obsidian can resize preview sections after mount. Refresh public
            // viewport dimensions before fitting the scene to the new height.
            api.refresh();
            frame = win.requestAnimationFrame(() => {
              if (!cancelled) api.scrollToContent(api.getSceneElements(), {
                fitToContent: true, viewportZoomFactor: 0.85,
                animate: false, maxZoom: 1, minZoom: 0.1,
                canvasOffsets: { top: 16, right: 16, bottom: 64, left: 16 },
              });
            });
          });
        };
        const syncViewport = () => {
          if (cancelled || api.getAppState().isLoading) return;
          if (!initialized) {
            initialized = true;
            api.updateScene({ elements, captureUpdate: CaptureUpdateAction.NEVER });
            if (data.files) api.addFiles(Object.values(data.files));
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
  }, [api, data, maxHeight, container, failure]);

  if (failure !== null) return <InlineError message={failure} />;
  return <Excalidraw
    excalidrawAPI={receiveAPI}
    theme={theme}
    viewModeEnabled
    zenModeEnabled
    gridModeEnabled={false}
    handleKeyboardGlobally={false}
    autoFocus={false}
    aiEnabled={false}
    validateEmbeddable={false}
    onLinkOpen={(_element, event) => event.preventDefault()}
    initialData={{ appState: { viewBackgroundColor: "transparent" } }}
    UIOptions={{ canvasActions, tools: { image: false } }}
  >
    <MainMenu />
  </Excalidraw>;
}
