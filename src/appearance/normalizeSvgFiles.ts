import { newElementWith } from "@excalidraw/excalidraw";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import type { BinaryFileData, BinaryFiles } from "@excalidraw/excalidraw/types";
import type { ResolvedTheme } from "./resolveTheme";

/** Recolor upstream SVG images without interpreting Mermaid or changing geometry.
 * The XML is never inserted into the host DOM. Other images pass through.
 */
export function normalizeSvgFiles(
  elements: ExcalidrawElement[], files: BinaryFiles | undefined, colors: ResolvedTheme,
): { elements: ExcalidrawElement[]; files: BinaryFiles } {
  const normalized: BinaryFiles = {};
  const ids = new Map<BinaryFileData["id"], BinaryFileData["id"]>();
  for (const file of Object.values(files ?? {})) {
    if (file.mimeType !== "image/svg+xml" || !file.dataURL.startsWith("data:image/svg+xml;base64,")) {
      normalized[file.id] = file;
      continue;
    }
    const bytes = Uint8Array.from(atob(file.dataURL.slice(file.dataURL.indexOf(",") + 1)), (char) => char.charCodeAt(0));
    const document = new DOMParser().parseFromString(new TextDecoder().decode(bytes), "image/svg+xml");
    const svg = document.documentElement;
    if (svg.localName !== "svg" || document.querySelector("parsererror")) {
      normalized[file.id] = file;
      continue;
    }
    const { foreground, background } = colors;
    const style = document.createElementNS("http://www.w3.org/2000/svg", "style");
    style.textContent = `
      svg { background: transparent !important; color: ${foreground} !important; }
      rect, circle, ellipse, polygon, path { fill: ${background} !important; stroke: ${foreground} !important; }
      line, polyline { fill: none !important; stroke: ${foreground} !important; }
      [fill="none"] { fill: none !important; }
      text, tspan { fill: ${foreground} !important; stroke: none !important; }
      foreignObject, foreignObject * { color: ${foreground} !important; background: transparent !important; }
      marker *, .state-start, .state-end { fill: ${foreground} !important; stroke: ${foreground} !important; }
    `;
    svg.appendChild(style);
    // Inline classDef colors otherwise outrank stylesheet rules. Remove only
    // color declarations, preserving layout, font and all geometry.
    for (const node of svg.querySelectorAll("[style]")) {
      if (node instanceof SVGElement || node instanceof HTMLElement) {
        for (const property of ["fill", "stroke", "color", "background", "background-color"]) {
          node.style.removeProperty(property);
        }
      }
    }
    const serialized = new XMLSerializer().serializeToString(svg);
    const encoded = btoa(Array.from(new TextEncoder().encode(serialized), (byte) => String.fromCharCode(byte)).join(""));
    // addFiles() does not replace existing IDs; use stable appearance-specific
    // IDs so theme changes cannot reuse stale pixels from the image cache.
    const id = `${file.id}-appearance-${foreground.slice(1)}-${encodeURIComponent(background)}` as BinaryFileData["id"];
    const dataURL = `data:image/svg+xml;base64,${encoded}` as BinaryFileData["dataURL"];
    normalized[id] = { ...file, id, dataURL };
    ids.set(file.id, id);
  }
  return {
    elements: elements.map((element) => element.type === "image" && element.fileId && ids.has(element.fileId)
      ? newElementWith(element, { fileId: ids.get(element.fileId)! }) : element),
    files: normalized,
  };
}
