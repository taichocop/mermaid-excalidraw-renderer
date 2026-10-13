/** Preserve geometry/layout while removing inline colors, including detached
 * XML and foreignObject HTML from another window. Obsidian supplies the
 * cross-window instanceOf helper; ownerDocument.defaultView may be null. */
export function stripInlineColors(svg: Element): void {
  for (const node of svg.querySelectorAll("[style]")) {
    if (node.instanceOf(SVGElement) || node.instanceOf(HTMLElement)) {
      for (const property of ["fill", "stroke", "color", "background", "background-color"]) {
        node.style.removeProperty(property);
      }
    }
  }
}

/** Keep empty fills empty. Explicit translucent shape fills use the theme's
 * foreground so compositing still conveys overlap, rather than disappearing
 * into the background. Opaque fills keep the existing background policy.
 * This interprets SVG paint only; no diagram syntax or geometry is involved.
 */
export function semanticSvgFill(fill: string | null, fillOpacity: string | null, foreground: string): string | null {
  if (["none", "transparent"].includes(fill?.trim().toLowerCase() ?? "")) return "none";
  const opacity = fillOpacity?.trim() ?? "";
  if (!/^\+?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?%?$/i.test(opacity)) return null;
  const value = opacity.endsWith("%") ? Number(opacity.slice(0, -1)) / 100 : Number(opacity);
  return Number.isFinite(value) && value > 0 && value < 1 ? foreground : null;
}

export function preserveSemanticFills(svg: Element, foreground: string): void {
  // Capture inline precedence before stripInlineColors removes color paint.
  const fills: { node: SVGElement; fill: string }[] = [];
  for (const node of svg.querySelectorAll("rect,circle,ellipse,polygon,path")) {
    if (!node.instanceOf(SVGElement)) continue;
    const fill = semanticSvgFill(node.style.getPropertyValue("fill") || node.getAttribute("fill"),
      node.style.getPropertyValue("fill-opacity") || node.getAttribute("fill-opacity"), foreground);
    if (fill !== null) fills.push({ node, fill });
  }
  stripInlineColors(svg);
  for (const { node, fill } of fills) node.style.setProperty("fill", fill, "important");
}
