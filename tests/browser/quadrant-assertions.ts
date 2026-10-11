import { expect, type Locator, type Page, type TestInfo } from "@playwright/test";
import { writeFile } from "node:fs/promises";

/** Measure emitted SVG in its own document, never in the plugin/host DOM.
 * Only browser SVG geometry/transforms are used; no Mermaid layout is inferred.
 */
export async function svgGeometry(page: Page, source: string) {
  const measurement = await page.context().newPage();
  try {
    await measurement.goto(`data:image/svg+xml;base64,${Buffer.from(source).toString("base64")}`);
    return await measurement.locator("svg").evaluate((root) => {
      if (!(root instanceof SVGSVGElement)) throw new Error("Not SVG");
      function point(element: SVGGraphicsElement, x: number, y: number) {
        return new DOMPoint(x, y).matrixTransform(element.getCTM() ?? new DOMMatrix());
      }
      function bounds(element: SVGGraphicsElement) {
        const b = element.getBBox();
        const corners = [[b.x, b.y], [b.x + b.width, b.y], [b.x, b.y + b.height], [b.x + b.width, b.y + b.height]]
          .map(([x, y]) => point(element, x!, y!));
        const x = Math.min(...corners.map((p) => p.x)), y = Math.min(...corners.map((p) => p.y));
        return { x, y, width: Math.max(...corners.map((p) => p.x)) - x, height: Math.max(...corners.map((p) => p.y)) - y };
      }
      const labels = [...root.querySelectorAll<SVGTextElement>(
        ".title text, .labels g.label text, .quadrants g.quadrant text, .data-points g.data-point text",
      )].map((node) => ({ text: node.textContent!.trim(), ...bounds(node) }));
      const quadrants = [...root.querySelectorAll<SVGRectElement>(".quadrants g.quadrant rect")]
        .map((node) => ({ text: node.parentElement!.querySelector("text")!.textContent!.trim(), ...bounds(node) }));
      const points = [...root.querySelectorAll<SVGCircleElement>(".data-points g.data-point circle")].map((node) => {
        const center = point(node, node.cx.baseVal.value, node.cy.baseVal.value);
        const edge = point(node, node.cx.baseVal.value + node.r.baseVal.value, node.cy.baseVal.value);
        return { text: node.parentElement!.querySelector("text")!.textContent!.trim(), x: center.x, y: center.y,
          radius: Math.hypot(edge.x - center.x, edge.y - center.y), strokeWidth: node.getAttribute("stroke-width"),
          fill: getComputedStyle(node).fill, stroke: getComputedStyle(node).stroke };
      });
      const lines = [...root.querySelectorAll<SVGLineElement>(".border line")].map((node) => {
        const start = point(node, node.x1.baseVal.value, node.y1.baseVal.value);
        const end = point(node, node.x2.baseVal.value, node.y2.baseVal.value);
        return { x1: start.x, y1: start.y, x2: end.x, y2: end.y };
      });
      // Preserve every non-paint attribute, text node and element in order.
      // Normalization may remove inline paint and append its generic stylesheet.
      const structure = [...root.querySelectorAll("*")].filter((node) => node.localName !== "style").map((node) => ({
        tag: node.localName, text: node.childElementCount ? null : node.textContent,
        attrs: [...node.attributes].filter((attr) => !["style", "fill", "stroke", "color"].includes(attr.name))
          .map((attr) => [attr.name, attr.value]),
      }));
      return { width: root.width.baseVal.value, height: root.height.baseVal.value,
        viewBox: root.getAttribute("viewBox"), labels, quadrants, points, lines, structure };
    });
  } finally { await measurement.close(); }
}
export type QuadrantGeometry = Awaited<ReturnType<typeof svgGeometry>>;

export async function preparedSvg(page: Page, index = 0) {
  await expect.poll(() => page.evaluate((index) => {
    const scene = window.harness.viewDiagnostics()[index];
    return scene?.files.length === 1 && scene.preparedAppearance?.theme === scene.appearance?.theme
      && scene.preparedAppearance?.background === scene.appearance?.background;
  }, index)).toBe(true);
  const diagnostic = await page.evaluate((index) => window.harness.viewDiagnostics()[index]!, index);
  const file = diagnostic.files[0]!;
  expect(file.mimeType).toBe("image/svg+xml");
  expect(diagnostic.elements).toEqual([{ type: "image", x: 0, y: 0, width: expect.any(Number), height: expect.any(Number), fileId: file.id }]);
  return { diagnostic, source: Buffer.from(file.dataURL.split(",")[1]!, "base64").toString("utf8") };
}

/** Register the actual production canvas using its long, straight plot edges.
 * Text regions exclude the plot borders; point samples inspect their annulus,
 * so the background-colored center of a hollow point cannot hide a missing edge.
 */
export async function quadrantPixels(canvas: Locator, geometry: QuadrantGeometry, dark: boolean) {
  return canvas.evaluate((node, { geometry, dark }) => {
    if (!(node instanceof HTMLCanvasElement) || !node.width || !node.height) return null;
    const width = node.width, height = node.height;
    const data = node.getContext("2d", { willReadFrequently: true })!.getImageData(0, 0, width, height).data;
    const expected = dark ? 30 : 255;
    const background = [...data.slice(0, 3)];
    if (background.some((channel) => channel !== expected)) return null;
    const ink = (x: number, y: number) => {
      const i = (y * width + x) * 4;
      const channels = [data[i]!, data[i + 1]!, data[i + 2]!];
      return data[i + 3]! > 200 && Math.max(...channels) - Math.min(...channels) <= 5
        && channels.every((channel) => dark ? channel - expected > 16 : expected - channel > 16);
    };
    function runs(vertical: boolean) {
      const outer = vertical ? width : height, inner = vertical ? height : width;
      const values = Array.from({ length: outer }, (_, i) => {
        let longest = 0, current = 0;
        for (let j = 0; j < inner; j++) {
          current = ink(vertical ? i : j, vertical ? j : i) ? current + 1 : 0;
          longest = Math.max(longest, current);
        }
        return longest;
      });
      const threshold = Math.max(...values) * 0.7;
      if (threshold < 20) return [];
      const groups: number[][] = [];
      values.forEach((value, i) => {
        if (value < threshold) return;
        const last = groups.at(-1);
        if (last && i === last.at(-1)! + 1) last.push(i); else groups.push([i]);
      });
      return groups.map((group) => group.reduce((sum, i) => sum + i, 0) / group.length);
    }
    const vertical = runs(true), horizontal = runs(false);
    if (vertical.length !== 3 || horizontal.length !== 3) return null;
    const left = vertical[0]!, right = vertical[2]!, top = horizontal[0]!, bottom = horizontal[2]!;
    const minX = Math.min(...geometry.quadrants.map((rect) => rect.x));
    const minY = Math.min(...geometry.quadrants.map((rect) => rect.y));
    const maxX = Math.max(...geometry.quadrants.map((rect) => rect.x + rect.width));
    const maxY = Math.max(...geometry.quadrants.map((rect) => rect.y + rect.height));
    const sx = (right - left) / (maxX - minX), sy = (bottom - top) / (maxY - minY);
    const xPixel = (x: number) => left + (x - minX) * sx;
    const yPixel = (y: number) => top + (y - minY) * sy;
    const inPoint = (x: number, y: number) => geometry.points.some((point) =>
      Math.hypot((x - xPixel(point.x)) / (point.radius * sx + 1),
        (y - yPixel(point.y)) / (point.radius * sy + 1)) <= 1);
    const inLabel = (x: number, y: number) => geometry.labels.some((label) =>
      x >= xPixel(label.x) - 1 && x <= xPixel(label.x + label.width) + 1
        && y >= yPixel(label.y) - 1 && y <= yPixel(label.y + label.height) + 1);
    function region(box: { x: number; y: number; width: number; height: number },
      exclude?: (x: number, y: number) => boolean) {
      let count = 0;
      const x0 = xPixel(box.x), x1 = xPixel(box.x + box.width), y0 = yPixel(box.y), y1 = yPixel(box.y + box.height);
      for (let y = Math.max(0, Math.ceil(y0 - 0.5)); y < Math.min(height, Math.ceil(y1 - 0.5)); y++) {
        for (let x = Math.max(0, Math.ceil(x0 - 0.5)); x < Math.min(width, Math.ceil(x1 - 0.5)); x++) {
          if (!exclude?.(x + 0.5, y + 0.5) && ink(x, y)) count++;
        }
      }
      return { ink: count, bounded: x0 > 1 && y0 > 1 && x1 < width - 1 && y1 < height - 1 };
    }
    // Point labels can overlap the lower circle cap. Its pixels must never
    // satisfy the separate label assertion, even when the label bbox exists.
    const labels = geometry.labels.map((label) => ({ text: label.text, ...region(label, inPoint) }));
    const points = geometry.points.map((point) => {
      const cx = xPixel(point.x), cy = yPixel(point.y), radius = point.radius * Math.min(sx, sy);
      let outlineInk = 0;
      for (let y = Math.max(0, Math.floor(cy - radius * 1.5)); y <= Math.min(height - 1, Math.ceil(cy + radius * 1.5)); y++) {
        for (let x = Math.max(0, Math.floor(cx - radius * 1.5)); x <= Math.min(width - 1, Math.ceil(cx + radius * 1.5)); x++) {
          const distance = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
          // Point labels are below the circle. Restrict to the upper rim so
          // label ink cannot satisfy a missing-point assertion.
          if (!inLabel(x + 0.5, y + 0.5) && y + 0.5 < cy && distance >= radius * 0.6 && distance <= radius * 1.5 && ink(x, y)) outlineInk++;
        }
      }
      return { text: point.text, outlineInk };
    });
    const lines = geometry.lines.map((line) => {
      // Sample an interior section; keep text/point neighborhoods out of it.
      const x1 = line.x1 + (line.x2 - line.x1) * 0.08, y1 = line.y1 + (line.y2 - line.y1) * 0.08;
      const x2 = line.x1 + (line.x2 - line.x1) * 0.25, y2 = line.y1 + (line.y2 - line.y1) * 0.25;
      return region({ x: Math.min(x1, x2) - 1.5, y: Math.min(y1, y2) - 1.5,
        width: Math.abs(x2 - x1) + 3, height: Math.abs(y2 - y1) + 3 }, (x, y) => inPoint(x, y) || inLabel(x, y)).ink;
    });
    return { background, labels, points, lines, registration: { vertical, horizontal, sx, sy }, filter: getComputedStyle(node).filter };
  }, { geometry, dark });
}

export async function expectQuadrantPixels(canvas: Locator, geometry: QuadrantGeometry, labels: string[], dark: boolean) {
  await expect.poll(async () => {
    const pixels = await quadrantPixels(canvas, geometry, dark);
    return pixels && { labels: pixels.labels.map((label) => ({ text: label.text, visible: label.ink > 5, bounded: label.bounded }))
      .sort((a, b) => a.text.localeCompare(b.text)), points: pixels.points.map((p) => p.outlineInk > 3),
    lines: pixels.lines.map((ink) => ink > 5), filter: pixels.filter };
  }).toEqual({ labels: labels.map((text) => ({ text, visible: true, bounded: true })).sort((a, b) => a.text.localeCompare(b.text)),
    points: [true, true], lines: Array(6).fill(true), filter: "none" });
}

export function expectPointPosition(geometry: QuadrantGeometry, label: string, quadrantLabel: string) {
  const point = geometry.points.find((p) => p.text === label)!;
  const quadrant = geometry.quadrants.find((rect) => rect.text === quadrantLabel)!;
  expect(point, label).toBeDefined(); expect(quadrant, quadrantLabel).toBeDefined();
  expect(point.x).toBeGreaterThan(quadrant.x); expect(point.x).toBeLessThan(quadrant.x + quadrant.width);
  expect(point.y).toBeGreaterThan(quadrant.y); expect(point.y).toBeLessThan(quadrant.y + quadrant.height);
}

export async function attachQuadrantEvidence(testInfo: TestInfo, name: string, data: unknown, source?: string) {
  const path = testInfo.outputPath(`${name}.json`);
  await writeFile(path, JSON.stringify(data, null, 2));
  await testInfo.attach(name, { path, contentType: "application/json" });
  if (source) await writeFile(testInfo.outputPath(`${name}.svg`), source);
}
