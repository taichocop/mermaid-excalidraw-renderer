import { expect, test, type Page } from "@playwright/test";
import { samples } from "./samples";

const note = (source: string = samples.flowchart, language = "mermaid") => `Before\n\n\`\`\`${language}\n${source}\n\`\`\`\n\nAfter`;
const blockStart = 8;
async function boot(page: Page, doc = note(), id = "editor-a") {
  await page.goto("/");
  await page.evaluate(() => window.ready);
  await page.evaluate(({ doc, id }) => window.harness.editors.create(id, doc), { doc, id });
}
async function ink(page: Page, id: string) {
  return page.locator(`#${id} canvas.static`).evaluateAll((nodes) => nodes.map((node) => {
    if (!(node instanceof HTMLCanvasElement) || !node.width || !node.height) return null;
    const data = node.getContext("2d", { willReadFrequently: true })!.getImageData(0, 0, node.width, node.height).data;
    let count = 0;
    for (let i = 0; i < data.length; i += 4) if (data[i + 3]! > 200 && Math.abs(data[i]! - data[0]!) > 16) count++;
    return { count, background: [data[0], data[1], data[2]], filter: getComputedStyle(node).filter };
  }));
}

for (const sample of ["flowchart", "sequence", "class"] as const) {
  test(`real CM6: ${sample} conversion, Light/Dark, resize and appearance settings`, async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await boot(page, note(samples[sample]));
    await expect(page.locator('#editor-a [data-state="ready"]')).toHaveCount(1);
    await expect(page.locator(".host-editor-mermaid")).toHaveCount(0);
    expect(await page.evaluate(() => window.harness.editors.hostMounts)).toBe(0);
    const scenes = await page.evaluate(() => window.harness.mountedScenes());
    expect(scenes).toHaveLength(1);
    expect(scenes[0]!.imageFallback).toBe(sample === "class");
    if (sample === "class") expect(scenes[0]!.types).toEqual(["image"]);
    else {
      expect(scenes[0]!.types).toContain("arrow");
      expect(scenes[0]!.labels.length).toBeGreaterThan(0);
    }
    for (const dark of [false, true, false]) {
      await page.evaluate((dark) => window.harness.theme(dark), dark);
      await expect.poll(async () => (await ink(page, "editor-a"))[0]).toEqual({
        count: expect.any(Number), background: dark ? [30, 30, 30] : [255, 255, 255], filter: "none",
      });
      await expect.poll(async () => (await ink(page, "editor-a"))[0]?.count ?? 0).toBeGreaterThan(100);
    }
    await page.evaluate(async () => {
      document.getElementById("editor-a")!.style.width = "420px";
      await window.harness.updateSettings({ fontSize: 28, roughness: 2, canvasHeight: 360, canvasPadding: 40 });
    });
    await expect(page.locator('#editor-a [data-state="ready"]')).toHaveCount(1);
    await expect.poll(async () => page.locator(".mermaid-excalidraw-editor").evaluate((node) => node.getBoundingClientRect().height)).toBe(360);
    await expect.poll(async () => (await ink(page, "editor-a"))[0]?.count ?? 0).toBeGreaterThan(100);
    expect(errors).toEqual([]);
  });
}

test("real CM6: OFF restores host, dedicated widgets stay independent, Source mode/unload/re-enable preserve source", async ({ page }) => {
  const doc = `${note()}\n\n${note(samples.sequence, "mermaid-excalidraw")}`;
  await boot(page, doc);
  const original = await page.evaluate(() => window.harness.editors.snapshot("editor-a"));
  await expect(page.locator('[data-state="ready"]')).toHaveCount(2);
  await expect(page.locator(".mermaid-excalidraw-editor")).toHaveCount(1);
  await expect(page.locator(".host-editor-dedicated .mermaid-excalidraw-container")).toHaveCount(1);
  await page.evaluate(() => window.harness.updateSettings({ renderStandardMermaid: false }));
  await expect(page.locator(".host-editor-mermaid")).toHaveCount(1);
  await expect(page.locator(".mermaid-excalidraw-editor")).toHaveCount(0);
  await expect(page.locator('[data-state="ready"]')).toHaveCount(1);
  await page.evaluate(() => window.harness.updateSettings({ renderStandardMermaid: true }));
  await expect(page.locator('[data-state="ready"]')).toHaveCount(2);
  expect(await page.evaluate(() => window.harness.editors.snapshot("editor-a"))).toEqual(original);
  await page.evaluate(() => window.harness.editors.mode("editor-a", false));
  await expect(page.locator(".mermaid-excalidraw-container")).toHaveCount(0);
  await expect(page.locator(".cm-content")).toContainText("```mermaid");
  await page.evaluate(() => window.harness.editors.mode("editor-a", true));
  await expect(page.locator('[data-state="ready"]')).toHaveCount(2);
  await page.evaluate(() => window.harness.disable());
  await expect(page.locator(".mermaid-excalidraw-container")).toHaveCount(0);
  await expect(page.locator(".host-editor-mermaid")).toHaveCount(1);
  await expect(page.locator(".host-editor-dedicated")).toHaveCount(0);
  expect(await page.locator("#editor-a .cm-line").allTextContents()).toEqual(expect.arrayContaining([
    "```mermaid-excalidraw", ...samples.sequence.split("\n"), "```",
  ]));
  expect(await page.evaluate(() => window.harness.editors.snapshot("editor-a"))).toEqual(original);
  await page.evaluate(() => window.harness.enable());
  await expect(page.locator('[data-state="ready"]')).toHaveCount(2);
  expect(await page.evaluate(() => window.harness.editors.snapshot("editor-a"))).toEqual(original);
  await page.evaluate(() => window.harness.editors.destroy("editor-a"));
  expect(await page.evaluate(() => window.harness.mountedScenes())).toEqual([]);
});

test("real CM6: cursor/fence and spanning selections uncover source, latest edit/Undo/Redo/IME events leave selection intact", async ({ page }) => {
  const doc = note("flowchart LR\nA[Original] --> B[Target]");
  await boot(page, doc);
  await expect(page.locator('[data-state="ready"]')).toHaveCount(1);
  await page.evaluate((from) => window.harness.editors.select("editor-a", [[from, from]]), blockStart);
  await expect(page.locator(".mermaid-excalidraw-container")).toHaveCount(0);
  const originalPos = doc.indexOf("Original");
  await page.evaluate((pos) => {
    const h = window.harness.editors;
    h.select("editor-a", [[pos, pos + 8]]);
    h.view("editor-a").focus();
    h.composition("editor-a", true);
    h.edit("editor-a", pos, pos + 8, "Latest");
    h.composition("editor-a", false);
  }, originalPos);
  await expect(page.locator(".cm-content")).toContainText("Latest");
  expect(await page.evaluate(() => document.activeElement === window.harness.editors.view("editor-a").contentDOM)).toBe(true);
  const selected = await page.evaluate(() => window.harness.editors.snapshot("editor-a"));
  await page.evaluate(() => window.harness.updateSettings({ roughness: 0 }));
  expect(await page.evaluate(() => window.harness.editors.snapshot("editor-a"))).toEqual(selected);
  await page.evaluate(() => window.harness.editors.select("editor-a", [[0, 0]]));
  await expect(page.locator('[data-state="ready"]')).toHaveCount(1);
  expect((await page.evaluate(() => window.harness.mountedScenes()))[0]?.labels).toContain("Latest");
  expect(await page.evaluate(() => window.harness.editors.undo("editor-a"))).toBe(true);
  expect((await page.evaluate(() => window.harness.editors.snapshot("editor-a"))).doc).toBe(doc);
  await expect(page.locator(".mermaid-excalidraw-container")).toHaveCount(0);
  expect(await page.evaluate(() => window.harness.editors.redo("editor-a"))).toBe(true);
  await page.evaluate(() => window.harness.editors.select("editor-a", [[0, 0]]));
  await expect(page.locator('[data-state="ready"]')).toHaveCount(1);
  expect((await page.evaluate(() => window.harness.mountedScenes()))[0]?.labels).toContain("Latest");
  await page.evaluate(() => {
    const h = window.harness.editors;
    h.select("editor-a", [[h.snapshot("editor-a").doc.length, 0]]);
  });
  await expect(page.locator(".mermaid-excalidraw-container")).toHaveCount(0);
});

test("real CM6: multiple panes, errors, scroll, rapid replacement and destroy isolate async results", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const doc = `${note("not valid Mermaid")}\n\n${note(samples.sequence)}`;
  await boot(page, doc);
  await page.evaluate((doc) => window.harness.editors.create("editor-b", doc), note(samples.class));
  await expect(page.locator('[data-state="ready"]')).toHaveCount(2);
  await expect(page.locator('[data-state="error"]')).toHaveCount(1);
  await page.evaluate(() => {
    const h = window.harness.editors;
    // Switch the whole note twice while conversions are queued/in progress.
    h.edit("editor-a", 0, h.snapshot("editor-a").doc.length, "Before\n\n```mermaid\nflowchart LR\nA[Stale]-->B\n```\nAfter");
    h.select("editor-a", [[0, 0]]);
  });
  await expect(page.locator('#editor-a [data-state="loading"], #editor-a [data-state="ready"]')).toHaveCount(1);
  await page.evaluate(() => {
    const h = window.harness.editors;
    h.edit("editor-a", 0, h.snapshot("editor-a").doc.length, "Before\n\n```mermaid\nflowchart LR\nA[Current]-->B\n```\nAfter");
    h.select("editor-a", [[0, 0]]);
    h.destroy("editor-b");
  });
  await expect(page.locator('[data-state="ready"]')).toHaveCount(1);
  expect((await page.evaluate(() => window.harness.mountedScenes())).map((scene) => scene.labels)).toEqual([["Current", "B"]]);
  await page.evaluate(() => {
    const view = window.harness.editors.view("editor-a");
    view.scrollDOM.style.height = "250px";
    view.scrollDOM.style.overflow = "auto";
    view.scrollDOM.scrollTop = 200;
    view.requestMeasure();
  });
  await expect(page.locator('#editor-a .mermaid-excalidraw-container')).toHaveCount(1);
  await page.evaluate(() => window.harness.editors.destroy("editor-a"));
  expect(await page.evaluate(() => window.harness.mountedScenes())).toEqual([]);
  await page.waitForTimeout(100);
  expect(errors).toEqual([]);
});

test("real CM6: standard source resource guard runs before conversion/network and adjacent text stays editable", async ({ page, baseURL }) => {
  const requests: string[] = [];
  page.on("request", (request) => { if (!request.url().startsWith(`${baseURL}/`) && !request.url().startsWith("data:")) requests.push(request.url()); });
  await boot(page, note('flowchart LR\nA@{ img: "https://example.invalid/image.png" }'));
  await expect(page.locator('[data-state="error"]')).toHaveCount(1);
  await expect(page.locator('[role="alert"]')).toContainText("Resource-capable Mermaid syntax");
  await page.evaluate(() => window.harness.editors.edit("editor-a", 0, 6, "Still editable"));
  await expect(page.locator(".cm-content")).toContainText("Still editable");
  expect(requests).toEqual([]);
});


test("real CM6: arrow-key entry reveals source, next-line typing preserves the block", async ({ page }) => {
  const doc = note("flowchart LR\nA[Keyboard]-->B");
  await boot(page, doc);
  await expect(page.locator('[data-state="ready"]')).toHaveCount(1);
  await page.evaluate(() => {
    const h = window.harness.editors;
    h.select("editor-a", [[7, 7]]); // Blank line immediately before opening fence.
    h.view("editor-a").focus();
  });
  await page.keyboard.press("ArrowRight");
  await expect(page.locator(".mermaid-excalidraw-container")).toHaveCount(0);
  expect((await page.evaluate(() => window.harness.editors.snapshot("editor-a"))).ranges).toEqual([{ anchor: 8, head: 8 }]);
  await page.keyboard.press("ArrowLeft");
  await expect(page.locator('[data-state="ready"]')).toHaveCount(1);
  const afterFence = doc.lastIndexOf("```") + 4;
  await page.evaluate((pos) => {
    const h = window.harness.editors;
    h.select("editor-a", [[pos, pos]]);
    h.view("editor-a").focus();
  }, afterFence);
  await page.keyboard.type("Adjacent text");
  expect((await page.evaluate(() => window.harness.editors.snapshot("editor-a"))).doc).toBe(doc.slice(0, afterFence) + "Adjacent text" + doc.slice(afterFence));
  await expect(page.locator('[data-state="ready"]')).toHaveCount(1);
  expect((await page.evaluate(() => window.harness.mountedScenes()))[0]?.labels).toContain("Keyboard");
});


test("real CM6: initial attached-pane background, spaced fence and destruction before mount", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => window.ready);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.evaluate((doc) => {
    window.harness.editors.create("discarded", doc, "#123456");
    window.harness.editors.destroy("discarded"); // Before requestMeasure can run.
  }, note());
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  expect(await page.evaluate(() => window.harness.mountedScenes())).toEqual([]);
  const doc = note("flowchart LR\nA[Pane]-->B").replace("```mermaid", "``` mermaid");
  await page.evaluate((doc) => {
    window.harness.theme(true);
    window.harness.editors.create("editor-a", doc, "#fcead2");
  }, doc);
  await expect(page.locator('[data-state="ready"]')).toHaveCount(1);
  expect((await page.evaluate(() => window.harness.mountedScenes()))[0]?.background).toBe("rgb(252, 234, 210)");
  await expect.poll(async () => (await ink(page, "editor-a"))[0]?.background).toEqual([252, 234, 210]);
  await expect.poll(async () => (await ink(page, "editor-a"))[0]?.count ?? 0).toBeGreaterThan(100);
  expect(errors).toEqual([]);
});

test("real CM6: a Sequence revealed by scrolling fits after offscreen mounting and resize", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await page.evaluate(() => window.ready);
  const doc = `${note(samples.flowchart)}\n\n${Array.from({ length: 80 }, (_, i) => `Body line ${i}`).join("\n")}\n\n${note(samples.sequence)}`;
  await page.evaluate((doc) => {
    const h = window.harness.editors;
    h.create("editor-a", doc);
    h.view("editor-a").scrollDOM.style.height = "420px";
    h.view("editor-a").scrollDOM.style.overflowY = "auto";
    h.view("editor-a").requestMeasure();
  }, doc);
  await expect.poll(async () => (await page.evaluate(() => window.harness.mountedScenes())).some((scene) => scene.source.startsWith("flowchart") && scene.ready)).toBe(true);
  await page.evaluate(() => {
    const view = window.harness.editors.view("editor-a");
    view.scrollDOM.scrollTop = view.scrollDOM.scrollHeight;
    view.requestMeasure();
  });
  await expect.poll(async () => (await page.evaluate(() => window.harness.mountedScenes())).some((scene) => scene.source.startsWith("sequenceDiagram") && scene.ready)).toBe(true);
  const visibleInk = async () => (await ink(page, "editor-a")).at(-1)?.count ?? 0;
  await expect.poll(visibleInk).toBeGreaterThan(100);
  await page.evaluate(() => {
    document.getElementById("editor-a")!.style.width = "480px";
    window.harness.editors.view("editor-a").requestMeasure();
  });
  await expect.poll(visibleInk).toBeGreaterThan(100);
  await page.evaluate(() => window.harness.editors.destroy("editor-a"));
  expect(await page.evaluate(() => window.harness.mountedScenes())).toEqual([]);
  expect(errors).toEqual([]);
});
