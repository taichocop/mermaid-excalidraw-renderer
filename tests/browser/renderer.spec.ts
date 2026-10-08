import { expect, test, type Page } from "@playwright/test";
import { samples } from "./samples";

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => window.ready);
});

declare global { interface Window { ready: Promise<void> } }

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
  await expect.poll(async () => (await scenePixels(page)).every((scene) => scene.ink > 100 && scene.colored === 0
    && scene.background.every((value) => value === 255))).toBe(true);
  await page.locator("main").screenshot({ path: "test-results/diagrams-light.png" });
  await page.evaluate(() => window.harness.theme(true));
  await expect(page.locator(".excalidraw.theme--dark")).toHaveCount(8);
  await expect.poll(async () => (await scenePixels(page)).every((scene) => scene.ink > 100 && scene.colored === 0
    && scene.background.every((value) => value === 30) && scene.filter === "none")).toBe(true);
  await page.locator("main").screenshot({ path: "test-results/diagrams-dark.png" });
  await page.evaluate(() => window.harness.theme(false));
  await expect.poll(async () => (await scenePixels(page)).every((scene) => scene.ink > 100
    && scene.background.every((value) => value === 255))).toBe(true);
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
A["<img src=x onerror='window.pwned=1'>"] --> B[safe]`));
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
