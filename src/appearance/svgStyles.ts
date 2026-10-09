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
