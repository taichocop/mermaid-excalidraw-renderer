import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

type FitOptions = NonNullable<Parameters<ExcalidrawImperativeAPI["scrollToContent"]>[1]>;

/** Public viewport offsets reserve screen pixels without moving elements.
 * Keep room for bottom controls and at least 80px of content in small panes.
 */
export function canvasFitOptions(width: number, height: number, padding: number): FitOptions {
  const horizontal = Math.min(padding, Math.max(0, (width - 80) / 2));
  const vertical = Math.min(padding, Math.max(0, (height - 80 - 48) / 2));
  return {
    fitToContent: true, viewportZoomFactor: 1, animate: false, maxZoom: 1,
    canvasOffsets: { top: vertical, right: horizontal, bottom: vertical + 48, left: horizontal },
  };
}
