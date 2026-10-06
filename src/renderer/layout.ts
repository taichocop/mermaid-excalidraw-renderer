import type { DiagramTheme } from "../types";
import { HEIGHT_RANGE } from "../settings/settings";

export function determineTheme(classList: Pick<DOMTokenList, "contains">): DiagramTheme {
  return classList.contains("theme-dark") ? "dark" : "light";
}

/** Fit the bounding box to the available width, reserving room for padding. */
export function calculateContainerHeight(
  bounds: readonly [number, number, number, number],
  containerWidth: number,
  maxHeight: number,
): number {
  const limit = Number.isFinite(maxHeight)
    ? Math.min(HEIGHT_RANGE.max, Math.max(HEIGHT_RANGE.min, maxHeight)) : 600;
  const minimum = Math.min(240, limit);
  const [x1, y1, x2, y2] = bounds;
  if (!bounds.every(Number.isFinite)) return minimum;
  const width = Math.max(1, x2 - x1);
  const height = Math.max(0, y2 - y1);
  const available = Number.isFinite(containerWidth) && containerWidth > 0 ? containerWidth : 640;
  const scale = Math.min(1, Math.max(1, available - 64) / width);
  return Math.round(Math.max(minimum, Math.min(limit, height * scale + 80)));
}
