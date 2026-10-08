import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { writeFile } from "node:fs/promises";
import { samples } from "./samples";
import { dependencies } from "../../package.json";

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => window.ready);
});

declare global { interface Window { ready: Promise<void> } }

async function attachJson(testInfo: TestInfo, name: string, data: unknown) {
  const path = testInfo.outputPath(`${name}.json`);
  await writeFile(path, JSON.stringify(data, null, 2));
  await testInfo.attach(name, { path, contentType: "application/json" });
}

// Read the actual rendered scene pixels, including SVG fallback image pixels.
async function scenePixels(page: Page) {
  return page.locator("canvas.static").evaluateAll((nodes) => nodes.map((node) => {
    if (!(node instanceof HTMLCanvasElement)) throw new Error("Not a canvas");
    const context = node.getContext("2d", { willReadFrequently: true });
    if (!context) throw new Error("No canvas context");
    const { width, height } = node;
    // Hidden/just-revealed panes can briefly have a 0px backing canvas.
    // Return a non-rendered sample so expect.poll waits for real ink instead
    // of throwing IndexSizeError before Excalidraw finishes its resize.
    if (width === 0 || height === 0) return {
      background: [0, 0, 0], ink: 0, colored: 0, left: 0, right: 0, top: 0, bottom: 0,
      width: 0, height: 0, filter: getComputedStyle(node).filter,
    };
    const pixels = context.getImageData(0, 0, width, height).data;
    const background = [pixels[0], pixels[1], pixels[2]];
    let ink = 0, colored = 0, left = width, right = 0, top = height, bottom = 0;
    for (let i = 0; i < pixels.length; i += 4) {
      const r = pixels[i]!, g = pixels[i + 1]!, b = pixels[i + 2]!;
      if (Math.max(r, g, b) - Math.min(r, g, b) > 5) colored++;
      if (pixels[i + 3]! > 200 && Math.abs(r - background[0]!) > 16) {
        ink++;
        const x = (i / 4) % width, y = Math.floor(i / 4 / width);
        left = Math.min(left, x); right = Math.max(right, x);
        top = Math.min(top, y); bottom = Math.max(bottom, y);
      }
    }
    const scale = width / node.getBoundingClientRect().width;
    return { background, ink, colored, left: left / scale, right: right / scale,
      top: top / scale, bottom: bottom / scale, width: width / scale, height: height / scale,
      filter: getComputedStyle(node).filter };
  }));
}

// Register the known rectangular Block fixtures against the ink bounds of the
// production canvas. SVG transforms are inspected only in a detached document;
// label interiors and connector gaps exclude node borders, so a border-only
// image cannot pass as readable text/arrows. This is SVG test inspection, not a
// Mermaid parser, layout implementation or alternate renderer.
async function blockContentPixels(page: Page, index = 0, dark = false) {
  return page.locator("canvas.static").nth(index).evaluate((canvas, { index, dark }) => {
    if (!(canvas instanceof HTMLCanvasElement) || !canvas.width || !canvas.height) return null;
    const canvasWidth = canvas.width, canvasHeight = canvas.height;
    const source = window.harness.conversionDiagnostics()[index]?.files[0]?.svg?.source;
    if (!source) return null;
    const svg = new DOMParser().parseFromString(source, "image/svg+xml");
    function point(element: Element, x: number, y: number) {
      let value = new DOMPoint(x, y);
      for (let parent: Element | null = element; parent; parent = parent.parentElement) {
        if (parent instanceof SVGGraphicsElement) {
          const matrix = parent.transform.baseVal.consolidate()?.matrix;
          if (matrix) value = value.matrixTransform(matrix);
        }
      }
      return value;
    }
    function box(element: Element) {
      const x = Number(element.getAttribute("x")), y = Number(element.getAttribute("y"));
      const width = Number(element.getAttribute("width")), height = Number(element.getAttribute("height"));
      const start = point(element, x, y), end = point(element, x + width, y + height);
      return { x: start.x, y: start.y, width: end.x - start.x, height: end.y - start.y };
    }
    // Mermaid also emits an empty rect inside each label group. Inspect only
    // painted node/composite boundaries, not those zero-size placeholders.
    const rectangles = [...svg.querySelectorAll(".node rect.label-container")].map((rect) => ({
      ...box(rect), id: rect.closest(".node")?.getAttribute("id"),
    }));
    if (!rectangles.length || rectangles.some((rect) => rect.width <= 0 || rect.height <= 0)) return null;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) throw new Error("No canvas context");
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    const expectedBackground = dark ? 30 : 255;
    const background = [pixels[0]!, pixels[1]!, pixels[2]!];
    if (!background.every((channel) => channel === expectedBackground)) return null;
    const ink = (x: number, y: number) => {
      const offset = (y * canvas.width + x) * 4;
      const channels = [pixels[offset]!, pixels[offset + 1]!, pixels[offset + 2]!];
      // Count only monochrome foreground with the expected polarity and
      // more than 16 levels of channel contrast. Black on dark must not be ink.
      return pixels[offset + 3]! > 200 && Math.max(...channels) - Math.min(...channels) <= 5
        && channels.every((channel) => dark ? channel - expectedBackground > 16 : expectedBackground - channel > 16);
    };
    let left = canvas.width, right = 0, top = canvas.height, bottom = 0;
    for (let y = 0; y < canvas.height; y++) for (let x = 0; x < canvas.width; x++) {
      if (ink(x, y)) { left = Math.min(left, x); right = Math.max(right, x); top = Math.min(top, y); bottom = Math.max(bottom, y); }
    }
    if (left >= right || top >= bottom) return null;
    const minX = Math.min(...rectangles.map((rect) => rect.x));
    const maxX = Math.max(...rectangles.map((rect) => rect.x + rect.width));
    const minY = Math.min(...rectangles.map((rect) => rect.y));
    const maxY = Math.max(...rectangles.map((rect) => rect.y + rect.height));
    const scaleX = (right - left) / (maxX - minX), scaleY = (bottom - top) / (maxY - minY);
    function region(x: number, y: number, width: number, height: number) {
      let count = 0;
      // Sample pixels whose centers lie inside the same geometric region.
      // ceil(start)/floor(end) can produce an empty range for a visible 1.68px
      // boundary band after pane resize. Keep the region and ink thresholds.
      const startX = Math.max(0, Math.ceil(left + (x - minX) * scaleX - 0.5));
      const endX = Math.min(canvasWidth, Math.ceil(left + (x + width - minX) * scaleX - 0.5));
      const startY = Math.max(0, Math.ceil(top + (y - minY) * scaleY - 0.5));
      const endY = Math.min(canvasHeight, Math.ceil(top + (y + height - minY) * scaleY - 0.5));
      for (let py = startY; py < endY; py++) for (let px = startX; px < endX; px++) if (ink(px, py)) count++;
      return count;
    }
    const labels = [...svg.querySelectorAll(".node foreignObject")].map((label) => {
      const bounds = box(label);
      return { text: label.textContent?.trim(), ink: region(bounds.x, bounds.y, bounds.width, bounds.height) };
    });
    const nodes = rectangles.map((rect) => ({ ...rect,
      outlineInk: region(rect.x + 2, rect.y - 1, rect.width - 4, 3),
    }));
    const ordered = [...rectangles].sort((a, b) => a.x - b.x);
    const connections = svg.querySelectorAll("path[marker-end]").length === 2 && ordered.length === 3
      ? ordered.slice(0, -1).map((node, i) => {
        const next = ordered[i + 1]!;
        const x = node.x + node.width + 1.5, width = next.x - x - 1.5;
        const y = node.y + node.height / 2;
        return { lineInk: region(x, y - 1.5, width, 3),
          // Off the connector centerline: arrowhead wings must add real pixels.
          arrowheadInk: region(x, y - 6, width, 4) + region(x, y + 2, width, 4) };
      }) : [];
    return { background, foreground: dark ? "white" : "black", labels, nodes, connections };
  }, { index, dark });
}

const blockFixtures = [
  { name: "blockSimple", labels: ["Client", "API", "Database"], nodeIds: ["A", "B", "C"] },
  { name: "blockArrows", labels: ["Client", "API", "Database"], nodeIds: ["A", "B", "C"] },
  { name: "blockColumns", labels: ["A", "B", "C", "D"], nodeIds: ["A", "B", "C", "D"] },
  { name: "blockNested", labels: ["a", "h", "i", "j", "k", "g", "l", "m", "n", "o", "p", "q", "r"],
    nodeIds: ["a", "group1", "h", "i", "j", "k", "g", "group2", "l", "m", "n", "o", "p", "q", "r"] },
] as const;

async function expectBlockContent(page: Page, fixture: typeof blockFixtures[number], index: number, dark: boolean) {
  await expect.poll(async () => {
    const content = await blockContentPixels(page, index, dark);
    return content && {
      background: content.background, foreground: content.foreground,
      labels: content.labels.filter((label) => label.text).map((label) => ({
        text: label.text!, ink: label.ink, visibleForeground: label.ink > 5,
      })).sort((a, b) => a.text.localeCompare(b.text)),
      boundaries: content.nodes.map((node) => ({
        id: node.id?.slice(node.id.lastIndexOf("-") + 1) ?? "", ink: node.outlineInk, visibleForeground: node.outlineInk > 5,
      })).sort((a, b) => a.id.localeCompare(b.id)),
      connections: content.connections.map((connection) => ({
        lineInk: connection.lineInk, arrowheadInk: connection.arrowheadInk,
        visibleLine: connection.lineInk > 0, visibleArrowhead: connection.arrowheadInk > 0,
      })),
    };
  }).toEqual({
    background: dark ? [30, 30, 30] : [255, 255, 255], foreground: dark ? "white" : "black",
    labels: fixture.labels.map((text) => ({ text, ink: expect.any(Number), visibleForeground: true }))
      .sort((a, b) => a.text.localeCompare(b.text)),
    boundaries: fixture.nodeIds.map((id) => ({ id, ink: expect.any(Number), visibleForeground: true }))
      .sort((a, b) => a.id.localeCompare(b.id)),
    connections: fixture.name === "blockArrows" ? Array.from({ length: 2 }, () => ({
      lineInk: expect.any(Number), arrowheadInk: expect.any(Number), visibleLine: true, visibleArrowhead: true,
    })) : [],
  });
}

for (const fixture of blockFixtures) {
  test(`${fixture.name}: production SVG fallback preserves labels, boundaries and arrows in Light → Dark → Light`, async ({ page }, testInfo) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error" || /warning/i.test(message.text())) errors.push(message.text());
    });
    await page.evaluate(async () => {
      await document.fonts.load("20px Virgil");
      await document.fonts.ready;
    });
    await page.evaluate((name) => window.harness.mountSamples([name]), fixture.name);
    await expect(page.locator('[data-state="ready"]')).toHaveCount(1);
    expect(await page.evaluate(() => window.harness.sceneSummaries())).toEqual([{ count: 1, imageFallback: true }]);
    const diagnostics = await page.evaluate(() => window.harness.conversionDiagnostics()[0]);
    await attachJson(testInfo, "converter-output", {
      dependencies, browserVersion: page.context().browser()?.version(), diagnostics,
    });
    expect(diagnostics?.elements).toEqual([{ type: "image", width: expect.any(Number), height: expect.any(Number) }]);
    expect(diagnostics?.files).toHaveLength(1);
    const file = diagnostics!.files[0]!;
    expect(file.mimeType).toBe("image/svg+xml");
    expect(file.svg?.width).toBeGreaterThan(0);
    expect(file.svg?.height).toBeGreaterThan(0);
    const viewBox = file.svg?.viewBox?.split(/\s+/).map(Number);
    expect(viewBox).toHaveLength(4);
    expect(viewBox?.every(Number.isFinite)).toBe(true);
    expect(viewBox?.[2]).toBeGreaterThan(0);
    expect(viewBox?.[3]).toBeGreaterThan(0);
    expect(diagnostics!.elements[0]!.width).toBe(file.svg?.width);
    expect(diagnostics!.elements[0]!.height).toBe(file.svg?.height);
    expect(file.svg?.labels).toEqual(expect.arrayContaining([...fixture.labels]));
    expect(file.svg?.connectors).toBe(fixture.name === "blockArrows" ? 2 : 0);

    for (const [theme, dark] of [["light", false], ["dark", true], ["light-restored", false]] as const) {
      await page.evaluate((dark) => window.harness.theme(dark), dark);
      await expect.poll(async () => (await scenePixels(page))[0]?.background).toEqual(dark ? [30, 30, 30] : [255, 255, 255]);
      try {
        await expectBlockContent(page, fixture, 0, dark);
      } finally {
        await attachJson(testInfo, `content-${theme}`, {
          content: await blockContentPixels(page, 0, dark), scenes: await scenePixels(page),
        });
        await page.locator(".mermaid-excalidraw-container").screenshot({ path: testInfo.outputPath(`${fixture.name}-${theme}.png`) });
      }
      const scene = (await scenePixels(page))[0]!;
      expect(scene.colored).toBe(0);
      expect(scene.filter).toBe("none");
    }
    const nodes = (await blockContentPixels(page))!.nodes;
    function node(id: string) {
      const value = nodes.find((node) => node.id?.endsWith(`-${id}`));
      expect(value, `Block ${id}`).toBeDefined();
      return value!;
    }
    if (fixture.name === "blockColumns") {
      expect(node("A").width).toBeGreaterThan(node("B").width * 1.5);
      expect(node("D").width).toBeGreaterThan(node("C").width * 1.5);
      expect(node("C").y).toBeGreaterThan(node("A").y);
      expect(node("A").y).toBeCloseTo(node("B").y);
      expect(node("C").y).toBeCloseTo(node("D").y);
    }
    if (fixture.name === "blockNested") {
      for (const [parent, children] of [["group1", ["h", "i", "j", "k"]], ["group2", ["l", "m", "n", "o", "p", "q", "r"]]] as const) {
        const boundary = node(parent);
        for (const id of children) {
          const child = node(id);
          expect(child.x).toBeGreaterThan(boundary.x);
          expect(child.y).toBeGreaterThan(boundary.y);
          expect(child.x + child.width).toBeLessThan(boundary.x + boundary.width);
          expect(child.y + child.height).toBeLessThan(boundary.y + boundary.height);
        }
      }
    }
    expect(errors).toEqual([]);
  });
}

test("multiple Block fallbacks isolate invalid input, reflow and clean up through note switches", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.evaluate(async () => {
    await document.fonts.load("20px Virgil");
    await document.fonts.ready;
    window.harness.mountSamples(["blockSimple", "blockNested", "blockInvalid", "flowchart", "sequence"]);
  });
  await expect(page.locator('[data-state="ready"]')).toHaveCount(4);
  await expect(page.locator('[data-state="error"]')).toHaveCount(1);
  await expect(page.locator(".mermaid-excalidraw-error-detail")).toContainText("Parse error");
  expect(await page.evaluate(() => window.harness.sceneSummaries())).toEqual([
    { count: 1, imageFallback: true }, { count: 1, imageFallback: true }, null,
    { count: expect.any(Number), imageFallback: false }, { count: expect.any(Number), imageFallback: false },
  ]);
  const expectDistinctBlocks = async (dark: boolean) => {
    await expectBlockContent(page, blockFixtures[0], 0, dark);
    await expectBlockContent(page, blockFixtures[3], 1, dark);
  };
  await expectDistinctBlocks(false);
  // Individual assertions avoid an empty array satisfying Array.every().
  for (let i = 0; i < 4; i++) await expect.poll(async () => (await scenePixels(page))[i]?.ink ?? 0).toBeGreaterThan(100);
  await page.evaluate(() => window.harness.theme(true));
  await expectDistinctBlocks(true);
  await page.setViewportSize({ width: 380, height: 900 });
  await expectDistinctBlocks(true);
  for (let i = 0; i < 4; i++) {
    await expect.poll(async () => {
      const scene = (await scenePixels(page))[i];
      return scene !== undefined && scene.ink > 100 && scene.left > 0 && scene.right < scene.width
        && scene.background.every((value) => value === 30);
    }).toBe(true);
  }
  await expect(page.locator('[id^="mermaid-to-excalidraw-"]')).toHaveCount(0);
  await page.evaluate(() => { window.harness.clear(); window.harness.mountSamples(["pie"]); });
  await expect(page.locator("canvas.static")).toHaveCount(1);
  await expect.poll(async () => (await scenePixels(page))[0]?.ink ?? 0).toBeGreaterThan(100);
  await page.evaluate(() => { window.harness.clear(); window.harness.theme(false); window.harness.mountSamples(["blockSimple", "blockNested"]); });
  await expect(page.locator('[data-state="ready"]')).toHaveCount(2);
  await expectDistinctBlocks(false);
  for (let i = 0; i < 2; i++) await expect.poll(async () => (await scenePixels(page))[i]?.ink ?? 0).toBeGreaterThan(100);
  await page.evaluate(() => window.harness.disable());
  await expect(page.locator("canvas")).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("loads the bundled CJS plugin and renders native and SVG fallback types offline", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if ((message.type() === "error" && !message.text().startsWith("Error processing Mermaid diagram:"))
      || /warning/i.test(message.text())) errors.push(message.text());
  });
  await page.route(/^https?:\/\/(?!127\.0\.0\.1)/, (route) => route.abort());
  const remoteRequests: string[] = [];
  page.on("request", (request) => {
    if (/^https?:/.test(request.url()) && !request.url().startsWith("http://127.0.0.1:")) {
      remoteRequests.push(request.url());
    }
  });
  expect(await page.evaluate(() => window.harness.registeredLanguages())).toEqual(["mermaid-excalidraw"]);
  await page.evaluate(() => window.harness.mountSamples(["flowchart", "sequence", "class", "er", "state", "gantt", "pie", "timeline"]));
  await expect(page.locator('[data-state="ready"]')).toHaveCount(8);
  await expect(page.locator(".mermaid-excalidraw-container .excalidraw" )).toHaveCount(8);
  await expect(page.locator(".mermaid-excalidraw-error")).toHaveCount(0);
  await expect(page.locator('[id^="mermaid-to-excalidraw-"]')).toHaveCount(0);
  expect(errors).toEqual([]);
  expect(await page.evaluate(() => window.harness.sceneSummaries())).toEqual([
    ...Array.from({ length: 2 }, () => ({ count: expect.any(Number), imageFallback: false })),
    ...Array.from({ length: 6 }, () => ({ count: 1, imageFallback: true })),
  ]);
  // The child's ready state marks conversion, while scene initialization and
  // fitting wait for Virgil. Start the bounded pixel checks after that actual
  // prerequisite, rather than racing font loading on a cold browser.
  await page.evaluate(async () => {
    await document.fonts.load("20px Virgil");
    await document.fonts.ready;
  });
  expect(await page.evaluate(() => document.fonts.check("20px Virgil"))).toBe(true);
  const diagrams = ["flowchart", "sequence", "class", "er", "state", "gantt", "pie", "timeline"];
  const expectScenes = async (background: number) => {
    // Keep each scene's measured values in assertion failures. A single false
    // predicate loses which diagram/color/layout is still incorrect.
    await expect.poll(async () => (await scenePixels(page)).map((scene, index) => ({
      diagram: diagrams[index], background: scene.background, ink: scene.ink,
      hasInk: scene.ink > 100, colored: scene.colored, filter: scene.filter,
      fitted: scene.left >= 16 && scene.right < scene.width - 16
        && scene.top >= 16 && scene.bottom < scene.height - 48,
    }))).toEqual(diagrams.map((diagram) => ({
      diagram, background: [background, background, background], ink: expect.any(Number),
      hasInk: true, colored: 0, filter: "none", fitted: true,
    })));
  };
  await expectScenes(255);
  await page.locator("main").screenshot({ path: "test-results/diagrams-light.png" });
  await page.evaluate(() => window.harness.theme(true));
  await expect(page.locator(".excalidraw.theme--dark")).toHaveCount(8);
  await expectScenes(30);
  await page.locator("main").screenshot({ path: "test-results/diagrams-dark.png" });
  await page.evaluate(() => window.harness.theme(false));
  await expectScenes(255);
  expect(errors).toEqual([]);
  expect(remoteRequests).toEqual([]);
});

test("Appearance controls persist and redraw roughness 0/1/2 on an open diagram", async ({ page }) => {
  await page.evaluate(() => { window.harness.mountSamples(["flowchart"]); window.harness.openSettings(); });
  await expect.poll(async () => (await scenePixels(page))[0]?.ink ?? 0).toBeGreaterThan(100);
  await expect(page.getByRole("slider", { name: "Font size", exact: true })).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Theme", exact: true })).toHaveValue("follow-obsidian");
  const images = new Set<string>();
  for (const roughness of [0, 1, 2]) {
    const previous = await page.locator("canvas.static").evaluate((canvas) => (canvas as HTMLCanvasElement).toDataURL());
    await page.getByRole("combobox", { name: "Roughness" }).selectOption(String(roughness));
    await expect.poll(() => page.evaluate(() => window.harness.savedSettings()?.roughness)).toBe(roughness);
    await expect.poll(() => page.locator("canvas.static").evaluate((canvas) => (canvas as HTMLCanvasElement).toDataURL())).not.toBe(previous);
    images.add(await page.locator("canvas.static").evaluate((canvas) => (canvas as HTMLCanvasElement).toDataURL()));
  }
  expect(images.size).toBe(3);
  await page.getByRole("slider", { name: "Canvas height" }).fill("800");
  await expect.poll(() => page.locator(".mermaid-excalidraw-container").evaluate((el) => el.clientHeight)).toBe(800);
  await expect.poll(() => page.evaluate(() => window.harness.savedSettings()?.canvasHeight)).toBe(800);
  await page.getByRole("slider", { name: "Canvas padding" }).fill("96");
  await expect.poll(() => page.evaluate(() => window.harness.savedSettings()?.canvasPadding)).toBe(96);
  await page.evaluate(() => window.harness.mountSamples(["sequence"]));
  await expect(page.locator('[data-state="ready"]')).toHaveCount(2);
  await expect.poll(() => page.locator(".mermaid-excalidraw-container").evaluateAll((nodes) => nodes.map((node) => node.clientHeight)))
    .toEqual([800, 800]);
});

test("padding fits a large diagram without clipping, responds to resize and does not enlarge a tiny diagram", async ({ page }) => {
  await page.evaluate(() => {
    window.harness.mount("flowchart LR\n" + Array.from({ length: 10 }, (_, i) => `N${i}[Step ${i}] --> N${i + 1}[Step ${i + 1}]`).join("\n"));
  });
  await expect.poll(async () => (await scenePixels(page))[0]?.ink ?? 0).toBeGreaterThan(100);
  await page.evaluate(() => window.harness.updateSettings({ roughness: 0, canvasPadding: 16 }));
  await expect.poll(async () => (await scenePixels(page))[0]?.left ?? 0).toBeGreaterThan(10);
  const before = (await scenePixels(page))[0]!;
  await page.evaluate(() => window.harness.updateSettings({ canvasPadding: 128 }));
  await expect.poll(async () => (await scenePixels(page))[0]?.left ?? 0).toBeGreaterThan(120);
  const after = (await scenePixels(page))[0]!;
  expect(after.right - after.left).toBeLessThan(before.right - before.left);
  expect(after.right).toBeLessThan(after.width - 120);
  await page.setViewportSize({ width: 380, height: 800 });
  await page.evaluate(() => window.harness.updateSettings({ canvasHeight: 240 }));
  await expect.poll(async () => {
    const scene = (await scenePixels(page))[0];
    return scene && scene.ink > 100 && scene.left > 5 && scene.right < scene.width - 5
      && scene.top > 5 && scene.bottom < scene.height - 48;
  }).toBe(true);
  await page.evaluate(() => { window.harness.clear(); window.harness.mount("flowchart TD\nA[x]"); });
  await expect.poll(async () => (await scenePixels(page))[0]?.ink ?? 0).toBeGreaterThan(20);
  await page.evaluate(() => window.harness.updateSettings({ canvasPadding: 16 }));
  await expect.poll(async () => {
    const scene = (await scenePixels(page))[0];
    return scene && scene.right - scene.left < 100 && scene.bottom - scene.top < 100;
  }).toBe(true);
});

test("theme follows actual custom background contrast, including same-mode CSS changes and colorful input", async ({ page }) => {
  await page.evaluate(() => {
    window.harness.mount('flowchart TD\nA[黒白] --> B[Readable]\nstyle A fill:#ff0000,color:#ffffff,stroke:#00ff00');
    window.harness.mount('classDiagram\nclass User {\n +String 日本語\n}\nstyle User fill:#ff0000,color:#ffffff,stroke:#00ff00');
  });
  await expect(page.locator('[data-state="ready"]')).toHaveCount(2);
  await expect.poll(async () => (await scenePixels(page)).every((scene) => scene.ink > 100 && scene.colored === 0)).toBe(true);
  await page.evaluate(() => {
    document.body.style.setProperty("--background-primary", "rgb(20, 20, 20)");
    window.harness.cssChanged();
  });
  await expect.poll(async () => (await scenePixels(page)).every((scene) => scene.ink > 100
    && scene.background.every((value) => value === 20))).toBe(true);
  await page.evaluate(() => {
    document.body.style.setProperty("--background-primary", "rgb(240, 240, 240)");
    window.harness.theme(true);
  });
  await expect.poll(async () => (await scenePixels(page)).every((scene) => scene.ink > 100
    && scene.background.every((value) => value === 240))).toBe(true);
});

test("diagrams mounted in hidden preview sections render and fit when revealed", async ({ page }) => {
  await page.evaluate(() => {
    document.querySelector("main")!.style.display = "none";
    window.harness.mountSamples(["flowchart", "class", "er", "state"]);
  });
  await expect(page.locator('[data-state="ready"]')).toHaveCount(4);
  await page.evaluate(() => { document.querySelector("main")!.style.display = ""; });
  await expect.poll(async () => (await scenePixels(page)).length === 4
    && (await scenePixels(page)).every((scene) => scene.ink > 100 && scene.width > 0 && scene.height === 600)).toBe(true);
  await page.evaluate(() => { document.querySelector("main")!.style.display = "none"; });
  await expect(page.locator("main")).toBeHidden();
  await page.evaluate(() => {
    const main = document.querySelector("main")!;
    main.style.width = "300px";
    main.style.display = "";
    window.harness.theme(true);
  });
  await expect.poll(async () => (await scenePixels(page)).every((scene) => scene.ink > 100
    && scene.width === 300 && scene.background.every((value) => value === 30))).toBe(true);
});

test("invalid syntax stays inline and displays untrusted error strings as text", async ({ page }) => {
  await page.evaluate(() => window.harness.mountSamples(["invalid", "flowchart"]));
  await expect(page.locator(".mermaid-excalidraw-error")).toContainText("Mermaid diagram could not be rendered.");
  await expect(page.locator(".mermaid-excalidraw-error-detail")).toContainText("Parse error");
  await expect(page.locator('[data-state="ready"]')).toHaveCount(1);
  await expect(page.locator('[id^="mermaid-to-excalidraw-"]')).toHaveCount(0);
  await page.evaluate(() => window.harness.mount('flowchart TD\nA --> <img src=x onerror="window.pwned=1">'));
  await expect(page.locator('[data-state="error"]')).toHaveCount(2);
  expect(await page.evaluate(() => "pwned" in window)).toBe(false);
  await expect(page.locator(".mermaid-excalidraw-error img")).toHaveCount(0);
  await page.evaluate(() => window.harness.mount(`%%{init: {"securityLevel":"loose"}}%%
flowchart TD
A["<b onmouseover='window.pwned=1'>Safe</b>"] --> B[safe]`));
  await expect(page.locator('[data-state="ready"]')).toHaveCount(2);
  expect(await page.evaluate(() => "pwned" in window)).toBe(false);
});

test("20 concurrent diagrams have no errors, survive rerendering and clean up after unload", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if ((message.type() === "error" && !message.text().startsWith("Error processing Mermaid diagram:"))
      || /warning/i.test(message.text())) errors.push(message.text());
  });
  await page.evaluate((source) => {
    for (let i = 0; i < 20; i++) window.harness.mount(source);
  }, samples.flowchart);
  await expect(page.locator('[data-state="ready"]')).toHaveCount(20);
  await expect(page.locator(".mermaid-excalidraw-container .excalidraw")).toHaveCount(20);
  expect(await page.evaluate(() => window.harness.sceneSummaries().every((scene) => scene !== null && !scene.imageFallback && scene.count > 0))).toBe(true);
  const ids = await page.locator("[id]").evaluateAll((elements) => elements.map((element) => element.id));
  expect(new Set(ids).size).toBe(ids.length);
  await page.evaluate(() => window.harness.clear());
  await expect(page.locator("canvas")).toHaveCount(0);
  await page.evaluate(() => { window.harness.mountSamples(["sequence", "er"]); });
  await expect(page.locator('[data-state="ready"]')).toHaveCount(2);
  await page.evaluate(() => window.harness.disable());
  await expect(page.locator("canvas")).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("unload cancels pending work, settings update existing canvases, and narrow panes remain bounded", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.evaluate((source) => {
    for (let i = 0; i < 20; i++) window.harness.mount(source);
    window.harness.clear();
  }, samples.sequence);
  await expect(page.locator("canvas")).toHaveCount(0);
  await page.evaluate(() => window.harness.mountSamples(["flowchart"]));
  await expect(page.locator('[data-state="ready"]')).toHaveCount(1);
  await page.evaluate(() => window.harness.updateSettings({ fontSize: 32, canvasHeight: 240 }));
  await expect(page.locator('[data-state="ready"]')).toHaveCount(1);
  await expect.poll(() => page.locator(".mermaid-excalidraw-container").evaluate((el) => el.clientHeight)).toBe(240);
  expect(await page.evaluate(() => window.harness.savedSettings())).toMatchObject({ fontSize: 32, canvasHeight: 240 });
  await page.setViewportSize({ width: 380, height: 700 });
  await expect.poll(() => page.locator(".mermaid-excalidraw-container").evaluate((el) => el.clientHeight)).toBe(240);
  await page.evaluate(() => window.harness.clear());
  expect(errors).toEqual([]);
});


test("standard Mermaid defaults on and shares native, SVG, inline-error and theme lifecycle", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const names = ["flowchart", "sequence", "class", "er", "state", "blockSimple"] as const;
  await page.evaluate((names) => {
    window.harness.mountSamples([...names], "mermaid");
    window.harness.mount("flowchart LR\nA -->", "mermaid");
    window.harness.mountSamples(["flowchart"]);
  }, names);
  await expect(page.locator('[data-state="ready"]')).toHaveCount(7);
  await expect(page.locator('[data-state="error"]')).toHaveCount(1);
  await expect(page.locator("canvas.static")).toHaveCount(7);
  const scenes = await page.evaluate(() => window.harness.sceneSummaries());
  expect(scenes.slice(0, 2).every((scene) => scene && !scene.imageFallback && scene.count > 1)).toBe(true);
  expect(scenes.slice(2, 6)).toEqual(Array.from({ length: 4 }, () => ({ count: 1, imageFallback: true })));
  expect(scenes[6]).toBeNull();
  const sourceBlocks = await page.evaluate(() => window.harness.hostState().blocks);
  for (const dark of [false, true, false]) {
    await page.evaluate((dark) => window.harness.theme(dark), dark);
    await expect.poll(async () => (await scenePixels(page)).every((scene) =>
      scene.ink > 100 && scene.background.every((value) => value === (dark ? 30 : 255)))).toBe(true);
  }
  await page.evaluate(() => window.harness.updateSettings({ renderStandardMermaid: false }));
  await expect(page.locator(".standard-mermaid")).toHaveCount(7);
  await expect(page.locator("canvas.static")).toHaveCount(1);
  expect(await page.evaluate(() => window.harness.hostState().children)).toBe(1);
  expect(await page.evaluate(() => window.harness.savedSettings()?.renderStandardMermaid)).toBe(false);
  await page.evaluate(() => window.harness.updateSettings({ renderStandardMermaid: true }));
  await expect(page.locator('[data-state="ready"]')).toHaveCount(7);
  await expect(page.locator('[data-state="error"]')).toHaveCount(1);
  await expect(page.locator("canvas.static")).toHaveCount(7);
  expect(await page.evaluate(() => window.harness.hostState().children)).toBe(8);
  expect(await page.evaluate(() => window.harness.hostState().blocks)).toEqual(sourceBlocks);
  await page.evaluate(() => window.harness.disable());
  await expect(page.locator("canvas")).toHaveCount(0);
  await expect(page.locator(".standard-mermaid")).toHaveCount(7);
  expect(await page.evaluate(() => window.harness.hostState().children)).toBe(0);
  expect(await page.evaluate(() => window.harness.hostState().postProcessors)).toEqual([0]);
  expect(errors).toEqual([]);
});

test("standard Mermaid toggle persists across reloads and dedicated blocks remain enabled", async ({ page }) => {
  await page.evaluate(() => {
    window.harness.mountSamples(["sequence"], "mermaid");
    window.harness.mountSamples(["class"]);
    window.harness.openSettings();
  });
  await expect(page.locator('[data-state="ready"]')).toHaveCount(2);
  const toggle = page.getByRole("checkbox", { name: "Render standard mermaid blocks as Excalidraw" });
  await expect(toggle).toBeChecked();
  await toggle.uncheck();
  await expect(page.locator(".standard-mermaid")).toHaveCount(1);
  await expect.poll(() => page.evaluate(() => window.harness.savedSettings()?.renderStandardMermaid)).toBe(false);
  await page.evaluate(async () => { window.harness.disable(); await window.harness.enable(); });
  await expect(page.locator(".standard-mermaid")).toHaveCount(1);
  await expect(page.locator('[data-state="ready"]')).toHaveCount(1);
  await page.evaluate(() => window.harness.updateSettings({ renderStandardMermaid: true }));
  await page.evaluate(async () => { window.harness.disable(); await window.harness.enable(); });
  await expect(page.locator('[data-state="ready"]')).toHaveCount(2);
  await page.evaluate(async () => { window.harness.disable(); await window.harness.enable({ fontSize: 24 }); });
  await expect(page.locator('[data-state="ready"]')).toHaveCount(2);
  await page.evaluate(() => {
    window.harness.clear();
    window.harness.mountSamples(["er"], "mermaid");
    window.harness.mountSamples(["flowchart"]);
  });
  await expect(page.locator('[data-state="ready"]')).toHaveCount(2);
  expect(await page.evaluate(() => window.harness.hostState().children)).toBe(2);
  await page.evaluate(() => window.harness.disable());
  expect(await page.evaluate(() => window.harness.hostState().children)).toBe(0);
  expect(await page.evaluate(() => window.harness.hostState().editorLanguages)).toEqual([]);
});

test("standard Mermaid DOM priority leaves other plugin registrations intact", async ({ page }) => {
  await page.evaluate(() => {
    window.harness.mountSamples(["flowchart"], "mermaid");
    window.harness.addCompetitor(-200);
  });
  await expect(page.locator(".competitor-mermaid")).toHaveCount(1);
  await expect(page.locator("canvas")).toHaveCount(0);
  expect(await page.evaluate(() => window.harness.hostState().editorLanguages)).toEqual(["mermaid-excalidraw", "mermaid"]);
  await page.evaluate(() => window.harness.updateSettings({ renderStandardMermaid: false }));
  await expect(page.locator(".competitor-mermaid")).toHaveCount(1);
  await page.evaluate(() => window.harness.disable());
  expect(await page.evaluate(() => window.harness.hostState().editorLanguages)).toEqual(["mermaid"]);
  await expect(page.locator(".competitor-mermaid")).toHaveCount(1);
  await page.evaluate(async () => {
    await window.harness.enable({ renderStandardMermaid: true });
    window.harness.removeCompetitor();
    window.harness.addCompetitor(0);
  });
  await expect(page.locator('[data-state="ready"]')).toHaveCount(1);
  await expect(page.locator(".competitor-mermaid")).toHaveCount(0);
  await page.evaluate(() => window.harness.updateSettings({ renderStandardMermaid: false }));
  // At equal order 0, the earlier built-in consumes the code first. The
  // competitor's registration still exists; OFF does not reorder it.
  await expect(page.locator(".standard-mermaid")).toHaveCount(1);
  await expect(page.locator(".competitor-mermaid")).toHaveCount(0);
  expect(await page.evaluate(() => window.harness.hostState().editorLanguages)).toEqual(["mermaid-excalidraw", "mermaid"]);
  await page.evaluate(() => { window.harness.disable(); window.harness.removeCompetitor(); });
  await expect(page.locator(".standard-mermaid")).toHaveCount(1);
  expect(await page.evaluate(() => window.harness.hostState().postProcessors)).toEqual([0]);
});

test("source-mode preview caches refresh after toggles, disable and re-enable", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.evaluate(() => {
    window.harness.mountSamples(["flowchart"], "mermaid");
    window.harness.mountSamples(["sequence"]);
  });
  await expect(page.locator('[data-state="ready"]')).toHaveCount(2);
  const sourceBlocks = await page.evaluate(() => window.harness.hostState().blocks);
  await page.evaluate(async () => {
    window.harness.setViewMode("source");
    await window.harness.updateSettings({ renderStandardMermaid: false });
  });
  expect(await page.evaluate(() => window.harness.hostState().previewInvalidated)).toBe(true);
  expect(await page.evaluate(() => window.harness.hostState().children)).toBe(0);
  await page.evaluate(() => window.harness.setViewMode("preview"));
  await expect(page.locator(".standard-mermaid")).toHaveCount(1);
  await expect(page.locator('[data-state="ready"]')).toHaveCount(1);
  await expect(page.locator("canvas.static")).toHaveCount(1);
  await page.evaluate(async () => {
    window.harness.setViewMode("source");
    await window.harness.updateSettings({ renderStandardMermaid: true });
    window.harness.setViewMode("preview");
  });
  await expect(page.locator('[data-state="ready"]')).toHaveCount(2);
  await expect(page.locator("canvas.static")).toHaveCount(2);
  await page.evaluate(() => {
    window.harness.setViewMode("source");
    window.harness.disable();
  });
  expect(await page.evaluate(() => window.harness.hostState().previewInvalidated)).toBe(true);
  expect(await page.evaluate(() => window.harness.hostState().children)).toBe(0);
  await page.evaluate(() => window.harness.setViewMode("preview"));
  await expect(page.locator(".standard-mermaid")).toHaveCount(1);
  await expect(page.locator("canvas")).toHaveCount(0);
  await page.evaluate(async () => {
    window.harness.setViewMode("source");
    await window.harness.enable();
  });
  expect(await page.evaluate(() => window.harness.hostState().previewInvalidated)).toBe(true);
  await page.evaluate(() => window.harness.setViewMode("preview"));
  await expect(page.locator('[data-state="ready"]')).toHaveCount(2);
  await expect(page.locator("canvas.static")).toHaveCount(2);
  expect(await page.evaluate(() => window.harness.hostState().children)).toBe(2);
  expect(await page.evaluate(() => window.harness.hostState().blocks)).toEqual(sourceBlocks);
  expect(errors).toEqual([]);
});

test("rapid standard Mermaid toggles cancel pending conversions without duplicate roots", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.evaluate(async () => {
    window.harness.mountSamples(["flowchart", "sequence", "blockSimple"], "mermaid");
    await window.harness.updateSettings({ renderStandardMermaid: false });
    await window.harness.updateSettings({ renderStandardMermaid: true });
    await window.harness.updateSettings({ renderStandardMermaid: false });
  });
  await expect(page.locator(".standard-mermaid")).toHaveCount(3);
  await expect(page.locator("canvas")).toHaveCount(0);
  expect(await page.evaluate(() => window.harness.hostState().children)).toBe(0);
  await page.evaluate(() => window.harness.updateSettings({ renderStandardMermaid: true }));
  await expect(page.locator('[data-state="ready"]')).toHaveCount(3);
  await expect(page.locator("canvas.static")).toHaveCount(3);
  expect(await page.evaluate(() => window.harness.hostState().children)).toBe(3);
  await page.evaluate(() => window.harness.disable());
  await expect(page.locator("canvas")).toHaveCount(0);
  expect(errors).toEqual([]);
});
