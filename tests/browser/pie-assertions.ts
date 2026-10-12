import { expect, type Locator, type Page } from "@playwright/test";

export interface PieExpectation {
  title: string;
  legend: string[];
  percentages: string[];
  sections: number;
  descending?: boolean;
}

// The returned converter/normalized SVG is inspected in a separate SVG
// document, never inserted into the host note. Geometry comes from public
// browser SVG APIs: no Mermaid parser, path-command parser or angle math.
async function svgGeometry(page: Page, dataURL: string) {
  await page.goto(dataURL);
  return page.evaluate(() => {
    const svg = document.documentElement;
    if (!(svg instanceof SVGSVGElement)) throw new Error("Expected SVG document");
    const box = (node: SVGGraphicsElement, bounds: { x: number; y: number; width: number; height: number } = node.getBBox()) => {
      const matrix = node.getScreenCTM();
      if (!matrix) throw new Error("SVG geometry not rendered");
      const corners = [[bounds.x, bounds.y], [bounds.x + bounds.width, bounds.y],
        [bounds.x, bounds.y + bounds.height], [bounds.x + bounds.width, bounds.y + bounds.height]]
        .map(([x, y]) => new DOMPoint(x, y).matrixTransform(matrix));
      const x = Math.min(...corners.map(p => p.x)), y = Math.min(...corners.map(p => p.y));
      return { x, y, width: Math.max(...corners.map(p => p.x)) - x, height: Math.max(...corners.map(p => p.y)) - y };
    };
    const points = (node: SVGGeometryElement, count: number) => {
      const matrix = node.getScreenCTM();
      if (!matrix) throw new Error("Missing SVG transform");
      return Array.from({ length: count }, (_, i) => {
        const point = node.getPointAtLength(node.getTotalLength() * (i + 0.5) / count).matrixTransform(matrix);
        return { x: point.x, y: point.y };
      });
    };
    const texts = [...svg.querySelectorAll("text")].map(node => {
      const text = node.textContent ?? "";
      const substring = (start: number, end: number) => {
        if (start >= end) throw new Error("Empty SVG text region");
        const extents = Array.from({ length: end - start }, (_, i) => node.getExtentOfChar(start + i));
        const x = Math.min(...extents.map(v => v.x)), y = Math.min(...extents.map(v => v.y));
        return box(node, { x, y, width: Math.max(...extents.map(v => v.x + v.width)) - x,
          height: Math.max(...extents.map(v => v.y + v.height)) - y });
      };
      const bracket = text.indexOf("[");
      const isLegend = node.parentElement?.classList.contains("legend") ?? false;
      const digitIndices = bracket >= 0
        ? Array.from({ length: text.length - bracket - 2 }, (_, i) => bracket + 1 + i)
        : node.classList.contains("slice") ? Array.from({ length: text.length - 1 }, (_, i) => i) : [];
      return { text, kind: node.classList.contains("pieTitleText") ? "title"
        : node.classList.contains("slice") ? "percentage" : isLegend ? "legend" : "other",
        box: box(node), labelBox: bracket >= 0 ? substring(0, bracket - 1) : box(node),
        digits: digitIndices.map(index => ({ text: text[index]!, box: substring(index, index + 1) })) };
    });
    const circle = svg.querySelector(".pieOuterCircle");
    if (!(circle instanceof SVGCircleElement)) throw new Error("No Pie outline");
    const sliceLabels = [...svg.querySelectorAll<SVGTextElement>(".slice")];
    const paths = [...svg.querySelectorAll(".pieCircle")].map((node, index) => {
      if (!(node instanceof SVGPathElement)) throw new Error("Invalid Pie path");
      let inside = 0;
      const bounds = circle.getBBox();
      for (let y = bounds.y + 1; y < bounds.y + bounds.height; y += 2) {
        for (let x = bounds.x + 1; x < bounds.x + bounds.width; x += 2) {
          if (node.isPointInFill(new DOMPoint(x, y))) inside++;
        }
      }
      const label = sliceLabels[index];
      if (!label) throw new Error("Section without percentage label");
      const labelMatrix = label.getScreenCTM(), pathMatrix = node.getScreenCTM();
      if (!labelMatrix || !pathMatrix) throw new Error("Missing section transform");
      const labelBounds = label.getBBox();
      const center = new DOMPoint(labelBounds.x + labelBounds.width / 2, labelBounds.y + labelBounds.height / 2)
        .matrixTransform(labelMatrix).matrixTransform(pathMatrix.inverse());
      return { inside, points: points(node, 64), percentage: label.textContent,
        percentageInside: node.isPointInFill(center) };
    });
    return { width: Number(svg.getAttribute("width")), height: Number(svg.getAttribute("height")),
      viewBox: [svg.viewBox.baseVal.x, svg.viewBox.baseVal.y, svg.viewBox.baseVal.width, svg.viewBox.baseVal.height],
      texts, circle: points(circle, 64), paths,
      swatches: [...svg.querySelectorAll(".legend rect")].map(node => {
        if (!(node instanceof SVGRectElement)) throw new Error("Invalid legend swatch");
        return { box: box(node), points: points(node, 24) };
      }),
      // Compare every geometry/text attribute on rendered primitives and their
      // groups. Exclude paint/style and changing Mermaid render IDs.
      geometry: [...svg.querySelectorAll("g,path,circle,text,rect")].map(node => ({ tag: node.tagName,
        attributes: [...node.attributes].filter(a => !["id", "style", "fill", "stroke", "color"].includes(a.name))
          .map(a => [a.name, a.value]).sort((a, b) => a[0]!.localeCompare(b[0]!)),
        text: node.tagName === "text" ? node.textContent : null })),
    };
  });
}

type PieGeometry = Awaited<ReturnType<typeof svgGeometry>>;

async function contentPixels(viewer: Locator, geometry: PieGeometry, dataURL: string, dark: boolean) {
  return viewer.locator("canvas.static").evaluate(async (node, { geometry, dataURL, dark }) => {
    if (!(node instanceof HTMLCanvasElement) || !node.width || !node.height) return null;
    const context = node.getContext("2d", { willReadFrequently: true });
    if (!context) throw new Error("No production canvas context");
    const background = dark ? 30 : 255;
    const actual = context.getImageData(0, 0, node.width, node.height).data;
    if (![...actual.slice(0, 3)].every(value => value === background)) return null;
    const image = new Image(); image.src = dataURL; await image.decode();
    const reference = document.createElement("canvas");
    reference.width = Math.ceil(geometry.width); reference.height = Math.ceil(geometry.height);
    const refContext = reference.getContext("2d", { willReadFrequently: true });
    if (!refContext) throw new Error("No SVG reference context");
    refContext.fillStyle = dark ? "rgb(30,30,30)" : "white";
    refContext.fillRect(0, 0, reference.width, reference.height);
    refContext.drawImage(image, 0, 0, geometry.width, geometry.height);
    const ref = refContext.getImageData(0, 0, reference.width, reference.height).data;
    const ink = (data: Uint8ClampedArray, width: number, height: number, x: number, y: number) => {
      if (x < 0 || y < 0 || x >= width || y >= height) return false;
      const i = (y * width + x) * 4;
      const r = data[i]!, g = data[i + 1]!, b = data[i + 2]!;
      return data[i + 3]! > 200 && Math.max(r, g, b) - Math.min(r, g, b) <= 5
        && (dark ? r - background > 16 : background - r > 16);
    };
    const bounds = (data: Uint8ClampedArray, width: number, height: number) => {
      let left = width, top = height, right = -1, bottom = -1, count = 0, colored = 0;
      for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4;
        if (Math.max(data[i]!, data[i + 1]!, data[i + 2]!) - Math.min(data[i]!, data[i + 1]!, data[i + 2]!) > 5) colored++;
        if (ink(data, width, height, x, y)) {
          count++; left = Math.min(left, x); top = Math.min(top, y);
          right = Math.max(right, x); bottom = Math.max(bottom, y);
        }
      }
      return { left, top, right, bottom, count, colored };
    };
    const observed = bounds(actual, node.width, node.height), expected = bounds(ref, reference.width, reference.height);
    if (!observed.count || !expected.count) return null;
    const scaleGuess = (observed.right - observed.left) / (expected.right - expected.left);
    const xGuess = observed.left - expected.left * scaleGuess, yGuess = observed.top - expected.top * scaleGuess;
    const distance = (x: number, y: number, radius: number) => {
      let best = Infinity;
      for (let dy = -radius; dy <= radius; dy++) for (let dx = -radius; dx <= radius; dx++) {
        const px = Math.round(x) + dx, py = Math.round(y) + dy;
        if (ink(actual, node.width, node.height, px, py)) best = Math.min(best, (px - x) ** 2 + (py - y) ** 2);
      }
      return best;
    };
    let registration = { score: Infinity, hits: 0, scale: 0, x: 0, y: 0 };
    // Bounds supply only an initial neighborhood. Choose the transform solely
    // by outer-circle contour agreement; missing labels cannot redefine it.
    for (let ds = -8; ds <= 8; ds++) for (let dx = -12; dx <= 12; dx++) for (let dy = -12; dy <= 12; dy++) {
      const scale = scaleGuess * (1 + ds / 100), x = xGuess + dx, y = yGuess + dy;
      const distances = geometry.circle.map(p => distance(x + p.x * scale, y + p.y * scale, 1));
      const hits = distances.filter(d => d <= 2).length;
      const score = distances.reduce((sum, d) => sum + Math.min(d, 9), 0) / distances.length;
      if (score < registration.score) registration = { score, hits, scale, x, y };
    }
    if (registration.hits < geometry.circle.length * 0.9 || registration.score > 1.5) return null;
    const region = (box: { x: number; y: number; width: number; height: number }) => {
      const x = registration.x + box.x * registration.scale, y = registration.y + box.y * registration.scale;
      const width = box.width * registration.scale, height = box.height * registration.scale;
      let count = 0;
      for (let py = Math.max(0, Math.floor(y)); py < Math.min(node.height, Math.ceil(y + height)); py++) {
        for (let px = Math.max(0, Math.floor(x)); px < Math.min(node.width, Math.ceil(x + width)); px++) {
          if (ink(actual, node.width, node.height, px, py)) count++;
        }
      }
      return { ink: count, bounded: x > 0 && y > 0 && x + width < node.width && y + height < node.height };
    };
    const contour = (points: { x: number; y: number }[]) => ({ samples: points.length,
      hits: points.filter(p => distance(registration.x + p.x * registration.scale,
        registration.y + p.y * registration.scale, 2) <= 5).length });
    return { background: [...actual.slice(0, 3)], colored: observed.colored, filter: getComputedStyle(node).filter,
      registration, inkBounds: observed, width: node.width, height: node.height,
      texts: geometry.texts.map(t => ({ text: t.text, kind: t.kind, pixels: region(t.box),
        label: region(t.labelBox), digits: t.digits.map(d => ({ text: d.text, ...region(d.box) })) })),
      swatches: geometry.swatches.map(s => ({ ...region(s.box), ...contour(s.points) })),
      outlines: geometry.paths.map(p => contour(p.points)) };
  }, { geometry, dataURL, dark });
}

export async function expectPie(page: Page, source: string, expectation: PieExpectation,
  viewer: Locator = page.locator(".mermaid-excalidraw-container").first(), dark = false) {
  await expect.poll(() => page.evaluate(source => {
    const scene = window.harness.sceneDiagnostics().find(s => s.source === source);
    return scene?.state === "ready" && !!scene.normalized && scene.appearance?.theme === (document.body.classList.contains("theme-dark") ? "dark" : "light");
  }, source)).toBe(true);
  const scene = (await page.evaluate(source => window.harness.sceneDiagnostics().find(s => s.source === source), source))!;
  const raw = scene.raw!, normalized = scene.normalized!;
  for (const value of [raw, normalized]) {
    expect(value.elements).toHaveLength(1);
    expect(value.elements[0]!.type).toBe("image");
    expect(Object.values(value.files ?? {})).toHaveLength(1);
    const file = Object.values(value.files!)[0]!;
    expect(file.mimeType).toBe("image/svg+xml");
    expect(value.elements[0]!).toMatchObject({ fileId: file.id });
    expect(file.dataURL).toMatch(/^data:image\/svg\+xml;base64,/);
    for (const size of [value.elements[0]!.width, value.elements[0]!.height]) {
      expect(Number.isFinite(size)).toBe(true); expect(size).toBeGreaterThan(0);
    }
  }
  const file = Object.values(normalized.files)[0]!, rawFile = Object.values(raw.files!)[0]!;
  const svgDocument = await page.context().newPage();
  try {
    const rawGeometry = await svgGeometry(svgDocument, rawFile.dataURL);
    const geometry = await svgGeometry(svgDocument, file.dataURL);
    expect(geometry.geometry).toEqual(rawGeometry.geometry);
    // Same-run measured geometry also catches layout-bearing CSS changes
    // (text-anchor/font/transform), which paint-only attribute checks exclude.
    expect(geometry.texts).toEqual(rawGeometry.texts);
    expect(geometry.circle).toEqual(rawGeometry.circle);
    expect(geometry.paths).toEqual(rawGeometry.paths);
    expect(geometry.swatches).toEqual(rawGeometry.swatches);
    expect(geometry.viewBox).toEqual(rawGeometry.viewBox);
    expect(geometry.viewBox).toHaveLength(4);
    expect(geometry.viewBox.every(Number.isFinite)).toBe(true);
    expect(geometry.viewBox[2]).toBeGreaterThan(0); expect(geometry.viewBox[3]).toBeGreaterThan(0);
    for (const [kind, values] of [["title", [expectation.title]], ["legend", expectation.legend], ["percentage", expectation.percentages]] as const) {
      expect(geometry.texts.filter(t => t.kind === kind).map(t => t.text)).toEqual(values);
      expect(rawGeometry.texts.filter(t => t.kind === kind).map(t => t.text)).toEqual(values);
    }
    expect(geometry.paths).toHaveLength(expectation.sections);
    expect(geometry.paths.map(path => path.percentage)).toEqual(expectation.percentages);
    for (const path of geometry.paths) expect(path.percentageInside).toBe(true);
    expect(geometry.swatches).toHaveLength(expectation.legend.length);
    for (const text of geometry.texts) {
      for (const box of [text.box, text.labelBox, ...text.digits.map(digit => digit.box)]) {
        expect(box.width).toBeGreaterThan(0); expect(box.height).toBeGreaterThan(0);
        expect(box.x).toBeGreaterThanOrEqual(0); expect(box.y).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width).toBeLessThanOrEqual(geometry.width);
        expect(box.y + box.height).toBeLessThanOrEqual(geometry.height);
      }
      const bracket = text.text.indexOf("[");
      const expectedDigits = text.kind === "percentage" ? text.text.slice(0, -1)
        : text.kind === "legend" && bracket >= 0 ? text.text.slice(bracket + 1, -1) : "";
      expect(text.digits.map(digit => digit.text).join("")).toBe(expectedDigits);
      if (expectedDigits) expect(text.digits.length).toBeGreaterThan(0);
    }
    for (const svg of [rawGeometry, geometry]) {
      expect(svg.width).toBe(raw.elements[0]!.width); expect(svg.height).toBe(raw.elements[0]!.height);
    }
    if (expectation.descending) {
      expect(geometry.paths).toHaveLength(3);
      const [large, middle, small] = geometry.paths.map(p => p.inside);
      expect(large!).toBeGreaterThan(middle! * 2);
      expect(middle!).toBeGreaterThan(small! * 1.5); expect(small!).toBeGreaterThan(0);
    }
    let pixels: Awaited<ReturnType<typeof contentPixels>> = null;
    await expect.poll(async () => {
      pixels = await contentPixels(viewer, geometry, file.dataURL, dark);
      if (!pixels) return false;
      return pixels.colored === 0 && pixels.filter === "none"
        && pixels.texts.length === 1 + expectation.legend.length + expectation.percentages.length
        && pixels.texts.every((t, i) => t.digits.length === geometry.texts[i]!.digits.length
          && t.pixels.bounded && t.label.bounded && t.pixels.ink > 5 && t.label.ink > 5
          && t.digits.every(d => d.bounded && d.ink > 1))
        && pixels.swatches.length === expectation.legend.length && pixels.swatches.every(s => s.bounded && s.ink > 0 && s.hits >= s.samples * 0.75)
        && pixels.outlines.length === expectation.sections && pixels.outlines.every(o => o.hits >= o.samples * 0.85);
    }, { timeout: 15_000, intervals: [100, 250, 500] }).toBe(true);
    return { rawFileId: rawFile.id, fileId: file.id, rawGeometry, geometry, pixels: pixels!, scene };
  } finally { await svgDocument.close(); await page.bringToFront(); }
}

export function watchErrors(page: Page, expectedConversionErrors = 0) {
  const unexpected: string[] = [], conversion: string[] = [];
  page.on("pageerror", error => unexpected.push(error.message));
  page.on("console", message => {
    if (message.type() !== "error" && message.type() !== "warning") return;
    // Repeated test-only reads of an upstream-created canvas elicit this
    // Chromium performance advisory. It is neither a renderer failure nor a
    // reason to change runtime context creation. All other warnings fail.
    if (message.type() === "warning" && message.text() === "Canvas2D: Multiple readback operations using getImageData are faster with the willReadFrequently attribute set to true. See: https://html.spec.whatwg.org/multipage/canvas.html#concept-canvas-will-read-frequently") return;
    if (message.type() === "error" && message.text().startsWith("[Mermaid Excalidraw Renderer] Conversion failed")) conversion.push(message.text());
    else unexpected.push(message.text());
  });
  return () => { expect(unexpected).toEqual([]); expect(conversion).toHaveLength(expectedConversionErrors); };
}
