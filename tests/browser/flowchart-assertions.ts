import { expect, type Page, type Locator, type TestInfo } from "@playwright/test";
import { fitInk } from "./auto-fit-helpers";

export async function nativeScene(page: Page, index = 0) {
  const diagnostic = await page.evaluate(index => window.harness.sceneDiagnostics()[index]!, index);
  expect(diagnostic.state).toBe("ready");
  expect(diagnostic.raw?.files).toBeUndefined();
  expect(diagnostic.normalized?.elements.some(element => element.type === "image")).toBe(false);
  return diagnostic.normalized!.elements;
}
export type NativeScene = Awaited<ReturnType<typeof nativeScene>>;
export function textOf(scene: NativeScene, label: string) {
  const text = scene.find(element => element.type === "text" && element.text.replace(/\s/g, "") === label.replace(/\s/g, ""));
  if (!text || text.type !== "text") throw new Error(`Missing text: ${label}`);
  return text;
}
export function nodeOf(scene: NativeScene, label: string) {
  const text = textOf(scene, label), node = scene.find(element => element.id === text.containerId);
  if (!node || node.type === "text" || node.type === "arrow") throw new Error(`Missing node: ${label}`);
  return node;
}
export function expectDirection(scene: NativeScene, direction: string, labels = ["Input", "Process", "Output"]) {
  const nodes = labels.map(label => nodeOf(scene, label));
  const centers = nodes.map(node => [node.x + node.width / 2, node.y + node.height / 2]);
  const axis = ["LR", "RL"].includes(direction) ? 0 : 1;
  for (let i = 1; i < centers.length; i++) {
    if (["RL", "BT"].includes(direction)) expect(centers[i - 1]![axis]! - centers[i]![axis]!).toBeGreaterThan(20);
    else expect(centers[i]![axis]! - centers[i - 1]![axis]!).toBeGreaterThan(20);
  }
}

type Box = { x: number; y: number; width: number; height: number };
type Point = { x: number; y: number };
export type PixelRegion = Box & { name: string; kind: "text" | "outline" | "shaft" | "head"; points?: Point[]; atStart?: boolean; radius?: number; headDepth?: number; headMinAcross?: number };
/** Project actual emitted geometry through the public Excalidraw view state.
 * Shaft bands exclude node/text bounds; head wings exclude the shaft itself.
 * This only measures pixels, and does not infer Mermaid layout or draw edges.
 */
export async function regionPixels(page: Page, viewer: Locator, index: number, regions: PixelRegion[], excluded: Box[] = [], edgeExcluded: Box[] = []) {
  const state = await page.evaluate(index => {
    const state = window.fitApis[index]!.getAppState();
    return { zoom: state.zoom.value, scrollX: state.scrollX, scrollY: state.scrollY };
  }, index);
  return viewer.locator("canvas.static").evaluate((node, { state, regions, excluded, edgeExcluded }) => {
    if (!(node instanceof HTMLCanvasElement) || !node.width || !node.height) return null;
    const scale = node.width / node.getBoundingClientRect().width;
    const data = node.getContext("2d", { willReadFrequently: true })!.getImageData(0, 0, node.width, node.height).data;
    // These fixtures use the host's default white/dark background. Waiting for
    // its actual pixels prevents an old Light frame satisfying a Dark check.
    const background = document.body.classList.contains("theme-dark") ? 30 : 255;
    if ([data[0], data[1], data[2]].some(channel => channel !== background)) return null;
    const contains = (box: Box, x: number, y: number, pad = 0) => x >= box.x - pad && x <= box.x + box.width + pad && y >= box.y - pad && y <= box.y + box.height + pad;
    const counts = regions.map(region => ({ name: region.name, kind: region.kind, ink: 0, samples: 0 }));
    for (let py = 0; py < node.height; py++) for (let px = 0; px < node.width; px++) {
      const x = (px + 0.5) / scale / state.zoom - state.scrollX, y = (py + 0.5) / scale / state.zoom - state.scrollY;
      const offset = (py * node.width + px) * 4;
      const ink = data[offset + 3]! > 200 && Math.abs(data[offset]! - data[0]!) > 16;
      for (let i = 0; i < regions.length; i++) {
        const region = regions[i]!;
        if (!contains(region, x, y, 20)) continue;
        let sample = false;
        if (region.kind === "text") sample = contains(region, x, y);
        if (region.kind === "outline") {
          // Cardinal perimeter windows work for rectangles, ellipses and diamond
          // vertices. They cannot pass solely from a readable interior label.
          const r = region.radius ?? 6, cx = region.x + region.width / 2, cy = region.y + region.height / 2;
          sample = [[cx, region.y], [cx, region.y + region.height], [region.x, cy], [region.x + region.width, cy]]
            .some(([a, b]) => Math.abs(x - a!) < r && Math.abs(y - b!) < r);
        }
        if (region.kind === "shaft") {
          const points = region.points!;
          for (let j = 1; j < points.length; j++) {
            const a = points[j - 1]!, b = points[j]!, length = Math.hypot(b.x - a.x, b.y - a.y);
            if (!length) continue;
            const along = ((x - a.x) * (b.x - a.x) + (y - a.y) * (b.y - a.y)) / length;
            const across = Math.abs((x - a.x) * (b.y - a.y) - (y - a.y) * (b.x - a.x)) / length;
            if (along > length * 0.2 && along < length * 0.8 && across < (region.radius ?? 3)) sample = true;
          }
        }
        if (region.kind === "head") {
          const points = region.points!, tip = region.atStart ? points[0]! : points.at(-1)!;
          const previous = region.atStart ? points[1]! : points.at(-2)!;
          const length = Math.hypot(tip.x - previous.x, tip.y - previous.y);
          const along = ((tip.x - x) * (tip.x - previous.x) + (tip.y - y) * (tip.y - previous.y)) / length;
          const across = Math.abs((x - tip.x) * (tip.y - previous.y) - (y - tip.y) * (tip.x - previous.x)) / length;
          const r = region.radius ?? 1;
          sample = along > 2 * r && along < (region.headDepth ?? 18) * r && across > (region.headMinAcross ?? 3) * r && across < 13 * r;
        }
        if (region.kind !== "text" && excluded.some(box => contains(box, x, y, 2))) sample = false;
        if (["shaft", "head"].includes(region.kind) && edgeExcluded.some(box => contains(box, x, y, 2))) sample = false;
        if (sample) { counts[i]!.samples++; if (ink) counts[i]!.ink++; }
      }
    }
    return counts;
  }, { state, regions, excluded, edgeExcluded });
}
export function nativeRegions(scene: NativeScene) {
  const regions: PixelRegion[] = [];
  const excluded = scene.filter(element => element.type === "text" || ["rectangle", "ellipse", "diamond"].includes(element.type));
  for (const element of scene) {
    const box = { x: element.x, y: element.y, width: element.width, height: element.height };
    if (element.type === "text") regions.push({ ...box, name: element.text, kind: "text" });
    else if (element.type === "arrow" || element.type === "line") {
      const points = element.points.map(([x, y]) => ({ x: element.x + x, y: element.y + y }));
      const lineBox = { x: Math.min(...points.map(p => p.x)), y: Math.min(...points.map(p => p.y)),
        width: Math.max(...points.map(p => p.x)) - Math.min(...points.map(p => p.x)),
        height: Math.max(...points.map(p => p.y)) - Math.min(...points.map(p => p.y)) };
      regions.push({ ...lineBox, name: element.id, kind: "shaft", points });
      if (element.type === "arrow") for (const atStart of [false, true]) {
        if (atStart ? element.startArrowhead : element.endArrowhead) regions.push({ ...lineBox, name: element.id + (atStart ? "-start" : "-end"), kind: "head", points, atStart, headDepth: 10, headMinAcross: 3.5 });
      }
    }
  }
  return { regions, excluded };
}
export async function headlessPixels(page: Page, viewer: Locator, index: number, scene: NativeScene) {
  const { regions, excluded } = nativeRegions(scene);
  const absent: PixelRegion[] = [];
  for (const region of regions.filter(region => region.kind === "shaft")) {
    const element = scene.find(element => element.id === region.name)!;
    if (element.type !== "arrow") continue;
    for (const atStart of [false, true]) if (!(atStart ? element.startArrowhead : element.endArrowhead)) {
      // Stay close to the endpoint to exclude rounded bends. The off-axis
      // window excludes the measured rough shaft width; metadata is checked
      // separately, so an empty window cannot stand in for no arrowhead.
      absent.push({ ...region, kind: "head", name: region.name + (atStart ? "-absent-start" : "-absent-end"), atStart,
        headDepth: 10, headMinAcross: 3.5 });
    }
  }
  return await regionPixels(page, viewer, index, absent, excluded);
}
export async function expectCleanHeadlessPixels(page: Page, viewer: Locator, index: number, sceneIndex = index) {
  // A rough bent shaft can enter a wing probe despite null arrowheads. First
  // the caller verifies default rendering; then the supported appearance
  // setting removes that rough-shaft ambiguity for a strict zero-ink proof.
  await page.evaluate(() => window.harness.updateSettings({ roughness: 0 }));
  try {
    await expect.poll(() => page.evaluate(index => window.fitApis[index]!.getSceneElements().every(element => element.roughness === 0), index)).toBe(true);
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    const scene = await nativeScene(page, sceneIndex);
    await expect.poll(async () => (await headlessPixels(page, viewer, index, scene))?.every(region => region.samples > 0 && region.ink === 0) ?? false).toBe(true);
    return await headlessPixels(page, viewer, index, scene);
  } finally {
    await page.evaluate(() => window.harness.updateSettings({ roughness: 1 }));
    await expect.poll(() => page.evaluate(index => window.fitApis[index]!.getSceneElements().every(element => element.roughness === 1), index)).toBe(true);
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  }
}
export async function expectNativePixels(page: Page, viewer: Locator, index: number, scene: NativeScene, includeHeads = true) {
  const native = nativeRegions(scene), excluded = native.excluded;
  // Narrow/large auto-fit scenes can rasterize heads below one pixel. Their
  // fit checks still require every label, shaft and outline; representative
  // full-size direction/edge fixtures retain separate head-wing assertions.
  const regions = native.regions.filter(region => includeHeads || region.kind !== "head");
  await expect.poll(async () => (await regionPixels(page, viewer, index, regions, excluded))?.every(region => region.samples > 0 && region.ink > (region.kind === "head" ? 0 : 2)) ?? false).toBe(true);
  for (const node of scene.filter(element => ["rectangle", "ellipse", "diamond"].includes(element.type))) {
    const pixels = await regionPixels(page, viewer, index, [{ x: node.x, y: node.y, width: node.width, height: node.height, name: node.id, kind: "outline" }], scene.filter(element => element.type === "text"));
    expect(pixels![0]!.ink).toBeGreaterThan(5);
  }
  return await regionPixels(page, viewer, index, regions, excluded);
}

/** SVG fallback is measured in an isolated SVG document, with browser geometry
 * and transforms, never with a Mermaid parser or an alternate layout engine. */
export async function subgraphGeometry(page: Page, source: string) {
  const measurement = await page.context().newPage();
  try {
    await measurement.goto(`data:image/svg+xml;base64,${Buffer.from(source).toString("base64")}`);
    return await measurement.locator("svg").evaluate(root => {
      if (!(root instanceof SVGSVGElement)) throw new Error("Missing SVG");
      const point = (element: SVGGraphicsElement, x: number, y: number) => {
        const p = new DOMPoint(x, y).matrixTransform(element.getCTM()!); return { x: p.x, y: p.y };
      };
      const bounds = (element: SVGGraphicsElement) => {
        const box = element.getBBox(); const a = point(element, box.x, box.y), b = point(element, box.x + box.width, box.y + box.height);
        return { x: a.x, y: a.y, width: b.x - a.x, height: b.y - a.y };
      };
      const labels = [...root.querySelectorAll<SVGGraphicsElement>(".node .label foreignObject, .cluster-label foreignObject")]
        .map(element => ({ ...bounds(element), text: element.textContent!.trim() }));
      const nodes = [...root.querySelectorAll<SVGGElement>("g.node")].map(element => ({ name: element.textContent!.trim(), ...bounds(element.querySelector<SVGGraphicsElement>("rect,polygon,ellipse,circle")!) }));
      const boundaries = [...root.querySelectorAll<SVGGElement>("g.cluster")].map(element => ({ name: element.querySelector(".cluster-label")!.textContent!.trim(), ...bounds(element.querySelector<SVGRectElement>("rect")!) }));
      const edges = [...root.querySelectorAll<SVGPathElement>("path.flowchart-link")].map(element => {
        const length = element.getTotalLength(); const points = [0, 0.1, 0.3, 0.5, 0.7, 0.9, 1].map(fraction => {
          const p = element.getPointAtLength(length * fraction); return point(element, p.x, p.y);
        });
        return { name: element.getAttribute("data-id")!, ...bounds(element), points, start: element.hasAttribute("marker-start"), end: element.hasAttribute("marker-end") };
      });
      return { width: root.width.baseVal.value, height: root.height.baseVal.value, labels, nodes, boundaries, edges };
    });
  } finally { await measurement.close(); }
}
export type SubgraphGeometry = Awaited<ReturnType<typeof subgraphGeometry>>;
export function subgraphEdgeExclusions(geometry: SubgraphGeometry) {
  // Only perimeter bands are excluded: edges inside a subgraph still count.
  // In particular B→Outside must have its own shaft ink beyond the cluster's
  // bottom border, which cannot by itself satisfy an edge pixel assertion.
  return [...geometry.nodes, ...geometry.boundaries.flatMap(boundary => [
    { x: boundary.x, y: boundary.y - 1, width: boundary.width, height: 2 },
    { x: boundary.x, y: boundary.y + boundary.height - 1, width: boundary.width, height: 2 },
    { x: boundary.x - 1, y: boundary.y, width: 2, height: boundary.height },
    { x: boundary.x + boundary.width - 1, y: boundary.y, width: 2, height: boundary.height },
  ])];
}
export async function expectSubgraphPixels(page: Page, viewer: Locator, index: number, geometry: SubgraphGeometry) {
  const regions: PixelRegion[] = [
    ...geometry.labels.map(label => ({ ...label, name: label.text, kind: "text" as const })),
    ...geometry.nodes.map(node => ({ ...node, kind: "outline" as const, radius: 4 })),
    ...geometry.boundaries.map(boundary => ({ ...boundary, kind: "outline" as const, radius: 4 })),
    ...geometry.edges.flatMap(edge => [{ ...edge, kind: "shaft" as const, radius: 2 },
      ...(edge.end ? [{ ...edge, name: edge.name + "-end", kind: "head" as const, radius: 0.4 }] : [])]),
  ];
  await expect.poll(async () => (await regionPixels(page, viewer, index, regions, geometry.labels, subgraphEdgeExclusions(geometry)))?.every(region => region.samples > 0 && region.ink > (region.kind === "head" ? 0 : 2)) ?? false).toBe(true);
  return await regionPixels(page, viewer, index, regions, geometry.labels, subgraphEdgeExclusions(geometry));
}
export function expectContains(outer: Box, inner: Box) {
  expect(inner.x).toBeGreaterThanOrEqual(outer.x - 1);
  expect(inner.y).toBeGreaterThanOrEqual(outer.y - 1);
  expect(inner.x + inner.width).toBeLessThanOrEqual(outer.x + outer.width + 1);
  expect(inner.y + inner.height).toBeLessThanOrEqual(outer.y + outer.height + 1);
}
export async function attachFlowchartEvidence(page: Page, viewer: Locator, info: TestInfo, name: string, detail: unknown) {
  await info.attach(name, { body: JSON.stringify({ browser: page.context().browser()?.version(), diagnostics: await page.evaluate(() => window.harness.sceneDiagnostics()), ink: await fitInk(viewer), detail }, null, 2), contentType: "application/json" });
}
