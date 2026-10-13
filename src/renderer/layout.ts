import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

type FitOptions = NonNullable<Parameters<ExcalidrawImperativeAPI["scrollToContent"]>[1]>;
export type FitMode = "inline" | "modal";
export const AUTO_FIT_MAX_ZOOM = { inline: 3, modal: 4 } as const;

/** Offsets are screen pixels. Upstream's public viewport fit evaluates both
 * scene dimensions; fitToContent would additionally cap small scenes at 100%.
 * Hidden chrome needs no reservation. Inline captions reserve their measured
 * clearance; modal controls sit outside the canvas.
 */
export function canvasFitOptions(width: number, height: number, padding: number, mode: FitMode, bottomClearance = 0): FitOptions | null {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null;
  const horizontal = Math.min(padding, Math.max(0, (width - 80) / 2));
  const availableMargin = Math.max(0, height - 80);
  const vertical = Math.min(padding, availableMargin / 2);
  const bottom = Math.min(availableMargin, Math.max(vertical, mode === "inline" ? bottomClearance : 0));
  const top = Math.min(vertical, availableMargin - bottom);
  return {
    fitToViewport: true, viewportZoomFactor: 1, animate: false, maxZoom: AUTO_FIT_MAX_ZOOM[mode],
    canvasOffsets: { top, right: horizontal, bottom, left: horizontal },
  };
}
