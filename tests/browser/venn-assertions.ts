import { expect, type Locator, type Page, type TestInfo } from "@playwright/test";
import { writeFile } from "node:fs/promises";

/** Inspect only emitted SVG using browser geometry APIs. Membership samples
 * come from isPointInFill, not a Venn parser or circle-intersection calculation.
 * The SVG lives in a separate data-URL document, never in the plugin host DOM.
 */
export async function vennGeometry(page: Page, dataURL: string) {
  const measurement = await page.context().newPage();
  try {
    await measurement.goto(dataURL);
    return await measurement.locator("svg").evaluate(root => {
      if (!(root instanceof SVGSVGElement)) throw new Error("Missing SVG");
      const vb = root.viewBox.baseVal;
      const matrix = root.getScreenCTM()!.inverse();
      const point = (node: SVGGraphicsElement, x: number, y: number) =>
        new DOMPoint(x, y).matrixTransform(node.getScreenCTM()!).matrixTransform(matrix);
      const box = (node: SVGGraphicsElement) => {
        const b = node.getBBox(), p = point(node, b.x, b.y), q = point(node, b.x + b.width, b.y + b.height);
        return { x: p.x, y: p.y, width: q.x - p.x, height: q.y - p.y };
      };
      const labels = [...root.querySelectorAll<SVGTextElement>("text")].filter(node => node.textContent!.trim()).map(node => ({
        text: node.textContent!.trim(), box: box(node),
        glyphs: [...node.textContent!].map((char, index) => ({ char, ...boxForCharacter(node, index) })),
      }));
      function boxForCharacter(node: SVGTextElement, index: number) {
        const b = node.getExtentOfChar(index), p = point(node, b.x, b.y), q = point(node, b.x + b.width, b.y + b.height);
        return { x: p.x, y: p.y, width: q.x - p.x, height: q.y - p.y };
      }
      for (const node of root.querySelectorAll("foreignObject span")) {
        const text = node.firstChild;
        if (!(text instanceof Text)) throw new Error("Unexpected HTML label structure");
        const screenBox = (rect: DOMRect) => {
          const p = new DOMPoint(rect.x, rect.y).matrixTransform(matrix);
          const q = new DOMPoint(rect.right, rect.bottom).matrixTransform(matrix);
          return { x: p.x, y: p.y, width: q.x - p.x, height: q.y - p.y };
        };
        const range = document.createRange(); range.selectNodeContents(node);
        const glyphs = [...text.data].map((char, index) => {
          range.setStart(text, index); range.setEnd(text, index + 1);
          return { char, ...screenBox(range.getBoundingClientRect()) };
        });
        range.selectNodeContents(node);
        labels.push({ text: text.data.trim(), box: screenBox(range.getBoundingClientRect()), glyphs });
      }
      const sets = [...root.querySelectorAll<SVGPathElement>(".venn-circle > path")];
      // A raster control with the same emitted geometry/paint but no labels
      // or fills lets production pixel checks exclude every boundary stroke.
      // It is decoded as an image only; no XML is inserted into the host DOM.
      const strokes = root.cloneNode(true) as SVGSVGElement;
      strokes.querySelectorAll("text,foreignObject").forEach(node => node.remove());
      for (const node of strokes.querySelectorAll("path,circle,ellipse,rect,polygon")) {
        if (node instanceof SVGElement) node.style.setProperty("fill-opacity", "0", "important");
      }
      const strokeXml = new XMLSerializer().serializeToString(strokes);
      const strokeDataURL = `data:image/svg+xml;base64,${btoa(Array.from(new TextEncoder().encode(strokeXml), byte => String.fromCharCode(byte)).join(""))}`;
      const paint = (node: SVGGraphicsElement) => {
        const style = getComputedStyle(node);
        return { fill: style.fill, stroke: style.stroke, opacity: style.opacity,
          fillOpacity: style.fillOpacity, strokeOpacity: style.strokeOpacity, strokeWidth: style.strokeWidth };
      };
      const contours = sets.map(node => Array.from({ length: 64 }, (_, index) => {
        const p = node.getPointAtLength(node.getTotalLength() * index / 64);
        return point(node, p.x, p.y);
      }).map(p => ({ x: p.x, y: p.y })));
      const membershipTransforms = sets.map(node => ({ node,
        local: node.getScreenCTM()!.inverse().multiply(root.getScreenCTM()!) }));
      const membership = (x: number, y: number) => membershipTransforms.reduce((mask, { node, local }, index) =>
        mask | (node.isPointInFill(new DOMPoint(x, y).matrixTransform(local)) ? 1 << index : 0), 0);
      const regions: Record<string, { x: number; y: number }[]> = {};
      // Stay away from every text bbox and every boundary by checking nearby
      // points with the same browser membership. No stroke/label can pass as fill.
      const step = Math.max(vb.width, vb.height) / 200;
      for (let y = vb.y + step; y < vb.y + vb.height; y += step) {
        for (let x = vb.x + step; x < vb.x + vb.width; x += step) {
          const mask = membership(x, y);
          if (!mask || labels.some(t => x >= t.box.x - step / 2 && x <= t.box.x + t.box.width + step / 2
            && y >= t.box.y - step / 2 && y <= t.box.y + t.box.height + step / 2)) continue;
          if ([[step, 0], [-step, 0], [0, step], [0, -step]].some(([dx, dy]) => membership(x + dx!, y + dy!) !== mask)) continue;
          (regions[mask] ??= []).push({ x, y });
        }
      }
      return { width: root.width.baseVal.value, height: root.height.baseVal.value, strokeDataURL,
        viewBox: { x: vb.x, y: vb.y, width: vb.width, height: vb.height }, labels, contours, regions,
        sets: sets.map(node => ({ box: box(node), paint: paint(node) })),
        intersections: [...root.querySelectorAll<SVGPathElement>(".venn-intersection > path")].map(node => ({ box: box(node), paint: paint(node) })),
        zeroStrokeCircles: root.querySelectorAll('circle[fill][stroke-width="0"],circle[fill][stroke-width="0px"]').length,
        structure: [...root.querySelectorAll("g,path,circle,ellipse,text,tspan")].map(node => ({ tag: node.localName,
          text: node.childElementCount ? null : node.textContent,
          attrs: [...node.attributes].filter(a => !["id", "style", "fill", "stroke", "color"].includes(a.name))
            .map(a => [a.name, a.value.replace(/\s+/g, " ")]) })),
      };
    });
  } finally { await measurement.close(); await page.bringToFront(); }
}
export type VennGeometry = Awaited<ReturnType<typeof vennGeometry>>;

export async function svgRegionPixels(page: Page, dataURL: string, geometry: VennGeometry, dark: boolean) {
  return page.evaluate(async ({ dataURL, geometry, dark }) => {
    const image = new Image(); image.src = dataURL; await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = Math.ceil(geometry.viewBox.width); canvas.height = Math.ceil(geometry.viewBox.height);
    const context = canvas.getContext("2d", { willReadFrequently: true })!;
    context.fillStyle = dark ? "#1e1e1e" : "white"; context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const values = context.getImageData(0, 0, canvas.width, canvas.height).data;
    return Object.entries(geometry.regions).map(([mask, points]) => ({ mask: Number(mask), count: points.length,
      rgb: [0, 1, 2].map(channel => {
        const samples = points.map(p => values[(Math.round(p.y - geometry.viewBox.y) * canvas.width
          + Math.round(p.x - geometry.viewBox.x)) * 4 + channel]!).sort((a, b) => a - b);
        return samples[Math.floor(samples.length / 2)]!;
      }) }));
  }, { dataURL, geometry, dark });
}

/** Register the production canvas against emitted circle contours. A reference
 * raster supplies only a scale/translation neighborhood; each boundary must
 * independently hit actual dark/light stroke pixels before any label or region
 * measurement is accepted. There is no full image snapshot/hash comparison.
 */
export async function vennPixels(viewer: Locator, geometry: VennGeometry, dataURL: string, dark: boolean) {
  return viewer.locator("canvas.static").evaluate(async (node, { geometry, dataURL, dark }) => {
    if (!(node instanceof HTMLCanvasElement) || !node.width || !node.height) return null;
    const width = node.width, height = node.height;
    const ctx = node.getContext("2d", { willReadFrequently: true })!;
    const actual = ctx.getImageData(0, 0, node.width, node.height).data;
    const bg = dark ? 30 : 255;
    if (![...actual.slice(0, 3)].every(c => c === bg)) return null;
    const image = new Image(); image.src = dataURL; await image.decode();
    const reference = document.createElement("canvas");
    reference.width = Math.ceil(geometry.width); reference.height = Math.ceil(geometry.height);
    const refCtx = reference.getContext("2d", { willReadFrequently: true })!;
    refCtx.fillStyle = dark ? "#1e1e1e" : "white"; refCtx.fillRect(0, 0, reference.width, reference.height);
    refCtx.drawImage(image, 0, 0, geometry.width, geometry.height);
    const ref = refCtx.getImageData(0, 0, reference.width, reference.height).data;
    const value = (data: Uint8ClampedArray, width: number, height: number, x: number, y: number) => {
      x = Math.round(x); y = Math.round(y);
      return x < 0 || y < 0 || x >= width || y >= height ? bg : data[(y * width + x) * 4]!;
    };
    const contrast = (v: number) => dark ? v - bg : bg - v;
    const bounds = (data: Uint8ClampedArray, width: number, height: number) => {
      let left = width, top = height, right = -1, bottom = -1, colored = 0;
      for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4;
        if (Math.max(data[i]!, data[i + 1]!, data[i + 2]!) - Math.min(data[i]!, data[i + 1]!, data[i + 2]!) > 5) colored++;
        if (contrast(data[i]!) < 70) continue;
        left = Math.min(left, x); right = Math.max(right, x); top = Math.min(top, y); bottom = Math.max(bottom, y);
      }
      return { left, top, right, bottom, colored };
    };
    const observed = bounds(actual, node.width, node.height), expected = bounds(ref, reference.width, reference.height);
    if (observed.right <= observed.left || expected.right <= expected.left) return null;
    const vb = geometry.viewBox;
    const refScale = geometry.width / vb.width;
    const scaleGuess = (observed.right - observed.left) / (expected.right - expected.left) * refScale;
    const xGuess = observed.left - (expected.left / refScale + vb.x) * scaleGuess;
    const yGuess = observed.top - (expected.top / refScale + vb.y) * scaleGuess;
    function strokeDistance(x: number, y: number) {
      let distance = 9;
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
        if (contrast(value(actual, width, height, x + dx, y + dy)) > 100) distance = Math.min(distance, dx * dx + dy * dy);
      }
      return distance;
    }
    const strokeHit = (x: number, y: number) => strokeDistance(x, y) <= 5;
    let registration = { scale: 0, x: 0, y: 0, hits: -1, score: Infinity };
    const contourPoints = geometry.contours.flat();
    for (let ds = -3; ds <= 3; ds++) for (let dx = -4; dx <= 4; dx++) for (let dy = -4; dy <= 4; dy++) {
      const scale = scaleGuess * (1 + ds / 200), x = xGuess + dx, y = yGuess + dy;
      const distances = contourPoints.map(p => strokeDistance(x + p.x * scale, y + p.y * scale));
      const hits = distances.filter(d => d <= 5).length;
      const score = distances.reduce((sum, d) => sum + d, 0) / distances.length;
      if (score < registration.score) registration = { scale, x, y, hits, score };
    }
    if (registration.hits < contourPoints.length * 0.9) return null;
    const strokeImage = new Image(); strokeImage.src = geometry.strokeDataURL; await strokeImage.decode();
    const strokeCanvas = document.createElement("canvas"); strokeCanvas.width = width; strokeCanvas.height = height;
    const strokeContext = strokeCanvas.getContext("2d", { willReadFrequently: true })!;
    strokeContext.fillStyle = dark ? "#1e1e1e" : "white"; strokeContext.fillRect(0, 0, width, height);
    strokeContext.drawImage(strokeImage, registration.x + vb.x * registration.scale, registration.y + vb.y * registration.scale,
      vb.width * registration.scale, vb.height * registration.scale);
    const strokePixels = strokeContext.getImageData(0, 0, width, height).data;
    // Dilate just the sparse stroke raster once. Label and glyph measurements
    // then share the same exclusion mask, including antialiasing/tolerance.
    const boundaryMask = new Uint8Array(width * height);
    for (let i = 0; i < strokePixels.length; i += 4) {
      if (contrast(strokePixels[i]!) <= 10) continue;
      const x = i / 4 % width, y = Math.floor(i / 4 / width);
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
        const px = x + dx, py = y + dy;
        if (px >= 0 && py >= 0 && px < width && py < height) boundaryMask[py * width + px] = 1;
      }
    }
    const pixel = (p: { x: number; y: number }) => ({ x: registration.x + p.x * registration.scale,
      y: registration.y + p.y * registration.scale });
    const textInk = (box: { x: number; y: number; width: number; height: number }) => {
      const p = pixel(box), boxWidth = box.width * registration.scale, boxHeight = box.height * registration.scale;
      let ink = 0;
      // Include pixels intersecting the bbox. Thin letters at 100% or in a
      // narrow pane can be less than two pixels wide; inward rounding would
      // discard their entire raster footprint.
      for (let y = Math.floor(p.y); y < Math.ceil(p.y + boxHeight); y++) for (let x = Math.floor(p.x); x < Math.ceil(p.x + boxWidth); x++) {
        if (!boundaryMask[y * width + x] && contrast(value(actual, node.width, node.height, x, y)) > 130) ink++;
      }
      return { ink, bounded: p.x > 0 && p.y > 0 && p.x + boxWidth < node.width && p.y + boxHeight < node.height };
    };
    const regions = Object.entries(geometry.regions).map(([mask, points]) => {
      const values = points.map(p => { const q = pixel(p); return value(actual, node.width, node.height, q.x, q.y); }).sort((a, b) => a - b);
      return { mask: Number(mask), count: values.length, median: values[Math.floor(values.length / 2)]!,
        contrast: contrast(values[Math.floor(values.length / 2)]!) };
    });
    return { registration, background: bg, colored: observed.colored, regions,
      filter: getComputedStyle(node).filter,
      boundaries: geometry.contours.map(points => points.filter(p => { const q = pixel(p); return strokeHit(q.x, q.y); }).length / points.length),
      labels: geometry.labels.map(label => ({ text: label.text, ...textInk(label.box),
        glyphs: label.glyphs.filter(g => /[A-Za-z]/.test(g.char)).map(g => ({ char: g.char, ...textInk(g) })) })),
      bounded: observed.left > 1 && observed.top > 1 && observed.right < node.width - 2 && observed.bottom < node.height - 2 };
  }, { geometry, dataURL, dark });
}

export async function preparedVenn(page: Page, source: string) {
  await expect.poll(() => page.evaluate(source => {
    const scene = window.harness.sceneDiagnostics().find(s => s.source === source);
    return scene?.state === "ready" && !!scene.normalized && scene.appearance?.theme === (document.body.classList.contains("theme-dark") ? "dark" : "light");
  }, source)).toBe(true);
  const scene = (await page.evaluate(source => window.harness.sceneDiagnostics().find(s => s.source === source), source))!;
  for (const data of [scene.raw!, scene.normalized!]) {
    expect(data.elements).toHaveLength(1); expect(data.elements[0]!.type).toBe("image");
    expect(Object.values(data.files!)).toHaveLength(1);
    const file = Object.values(data.files!)[0]!;
    expect(file.mimeType).toBe("image/svg+xml"); expect(data.elements[0]!).toMatchObject({ fileId: file.id });
    for (const size of [data.elements[0]!.width, data.elements[0]!.height]) {
      expect(Number.isFinite(size)).toBe(true); expect(size).toBeGreaterThan(0);
    }
  }
  return { scene, rawFile: Object.values(scene.raw!.files!)[0]!, file: Object.values(scene.normalized!.files)[0]! };
}

export async function expectVennPixels(viewer: Locator, geometry: VennGeometry, dataURL: string, dark: boolean,
  options: { individualGlyphs?: boolean } = {}) {
  let pixels: Awaited<ReturnType<typeof vennPixels>> = null;
  try { await expect.poll(async () => {
    pixels = await vennPixels(viewer, geometry, dataURL, dark);
    if (!pixels || !pixels.bounded || pixels.colored || pixels.filter !== "none") return false;
    const singles = pixels.regions.filter(r => [1, 2, 4].includes(r.mask));
    const pairs = pixels.regions.filter(r => [3, 5, 6].includes(r.mask));
    const triple = pixels.regions.find(r => r.mask === 7);
    return pixels.boundaries.every(hit => hit >= 0.9)
      && pixels.labels.every(t => t.bounded && t.ink > 3
        && t.glyphs.every(g => g.bounded && (options.individualGlyphs === false || g.ink > 0)))
      && singles.length === geometry.sets.length && singles.every(r => r.count > 4 && r.contrast > 12)
      && pairs.length === (geometry.sets.length === 3 ? 3 : 1) && pairs.every(r => r.count > 4
        && r.contrast > Math.max(...singles.map(s => s.contrast)) + 10)
      && (geometry.sets.length !== 3 || !!triple && triple.count > 4 && triple.contrast > Math.max(...pairs.map(p => p.contrast)) + 10);
  }, { timeout: 10_000, intervals: [100, 250, 500] }).toBe(true); }
  catch (error) { throw Object.assign(new Error(`Venn canvas measurement: ${JSON.stringify(pixels)}`), { cause: error }); }
  return pixels!;
}

export async function attachVennEvidence(info: TestInfo, name: string, prepared: Awaited<ReturnType<typeof preparedVenn>>,
  measurements: unknown, viewer: Locator) {
  const path = info.outputPath(`${name}-measurements.json`);
  await writeFile(path, JSON.stringify({ ...prepared, measurements }, null, 2));
  await info.attach(`${name}-measurements`, { path, contentType: "application/json" });
  for (const [kind, file] of [["raw", prepared.rawFile], ["normalized", prepared.file]] as const) {
    const path = info.outputPath(`${name}-${kind}.svg`);
    await writeFile(path, Buffer.from(file.dataURL.split(",")[1]!, "base64"));
    await info.attach(`${name}-${kind}`, { path, contentType: "image/svg+xml" });
  }
  const screenshot = info.outputPath(`${name}-canvas.png`);
  await viewer.screenshot({ path: screenshot });
  await info.attach(`${name}-canvas`, { path: screenshot, contentType: "image/png" });
}
