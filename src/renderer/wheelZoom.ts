export interface ZoomViewport {
  zoom: number;
  scrollX: number;
  scrollY: number;
}

export interface ZoomAnchor {
  x: number;
  y: number;
}

const MIN_ZOOM = 0.1;
const MAX_ZOOM = 30;
const MAX_WHEEL_PIXELS = 100;
// One 100 CSS-pixel event matches the existing 1.2x zoom button step.
// Bounding each event to that step retains the smaller native pinch deltas.
const ZOOM_EXPONENT_PER_PIXEL = Math.log(1.2) / MAX_WHEEL_PIXELS;

function boundedPixels(value: number): number {
  return Math.max(-MAX_WHEEL_PIXELS, Math.min(MAX_WHEEL_PIXELS, value));
}

/** Convert wheel units to CSS pixels, using the viewer's measured line/page size. */
export function normalizeWheelDelta(deltaY: number, deltaMode: number, linePixels: number, pagePixels: number): number {
  if (![deltaY, deltaMode, linePixels, pagePixels].every(Number.isFinite)
    || linePixels <= 0 || pagePixels <= 0 || deltaY === 0) return 0;
  const unit = deltaMode === 0 ? 1 : deltaMode === 1 ? linePixels : deltaMode === 2 ? pagePixels : 0;
  if (!unit) return 0;
  // Bound before multiplication so even finite inputs whose product would
  // overflow still produce a finite event delta.
  const magnitude = Math.min(Math.abs(deltaY), MAX_WHEEL_PIXELS / unit) * unit;
  return boundedPixels(Math.sign(deltaY) * magnitude);
}

/** Zoom around a viewport-local CSS-pixel anchor through public AppState fields. */
export function zoomAtAnchor(viewport: ZoomViewport, deltaPixels: number, anchor: ZoomAnchor): ZoomViewport | null {
  if (![viewport.zoom, viewport.scrollX, viewport.scrollY, deltaPixels, anchor.x, anchor.y].every(Number.isFinite)
    || viewport.zoom <= 0 || deltaPixels === 0) return null;
  const zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM,
    viewport.zoom * Math.exp(-boundedPixels(deltaPixels) * ZOOM_EXPONENT_PER_PIXEL)));
  if (zoom === viewport.zoom) return null;
  // Excalidraw's public viewportCoordsToSceneCoords gives local / zoom -
  // scroll. Preserve that scene point by compensating for the new scale.
  const scrollX = viewport.scrollX + anchor.x / zoom - anchor.x / viewport.zoom;
  const scrollY = viewport.scrollY + anchor.y / zoom - anchor.y / viewport.zoom;
  if (![zoom, scrollX, scrollY].every(Number.isFinite)) return null;
  return { zoom, scrollX, scrollY };
}
