import { expect, test, type Page } from "@playwright/test";
import { observeFitAPI, expectFit, fitState } from "./auto-fit-helpers";
import { expectNoMenuChrome } from "./chrome-assertions";
import { preparedSvg } from "./quadrant-assertions";
import { directions, syntaxes, directionFixture, invisible, invisibleControl, edges, edgeFixture, shapes,
  basicSubgraph, nestedSubgraph, directedSubgraph, externallyConnectedSubgraph, invalid } from "./flowchart-fixtures";
import { nativeScene, nodeOf, textOf, expectDirection, expectNativePixels, regionPixels, nativeRegions, expectCleanHeadlessPixels,
  subgraphGeometry, expectSubgraphPixels, expectContains, attachFlowchartEvidence, type NativeScene } from "./flowchart-assertions";

const readbackWarning = "Canvas2D: Multiple readback operations using getImageData are faster with the willReadFrequently attribute set to true. See: https://html.spec.whatwg.org/multipage/canvas.html#concept-canvas-will-read-frequently";
const captured = new WeakMap<Page, { page: string[]; console: string[] }>();
test.beforeEach(async ({ page }) => {
  const messages = { page: [] as string[], console: [] as string[] }; captured.set(page, messages);
  page.on("pageerror", error => messages.page.push(error.message));
  page.on("console", message => {
    if (["error", "warning"].includes(message.type()) && message.text() !== readbackWarning) messages.console.push(message.text());
  });
  await page.route("**/favicon.ico", route => route.fulfill({ status: 204 }));
  await observeFitAPI(page);
  await page.goto("/"); await page.evaluate(() => window.ready);
});
test.afterEach(async ({ page }, info) => {
  const messages = captured.get(page)!;
  expect(messages.page).toEqual([]);
  if (info.title.includes("subgraph fallback")) {
    expect(messages.console).toHaveLength(1);
    expect(messages.console[0]).toMatch(/^Error processing Mermaid diagram: Error: SubGraph element not found\n/);
  } else if (info.title.includes("invalid isolation")) {
    expect(messages.console).toHaveLength(1);
    expect(messages.console[0]).toMatch(/^\[Mermaid Excalidraw Renderer\] Conversion failed/);
    expect(messages.console[0]).toContain("Parse error");
  } else expect(messages.console).toEqual([]);
});
const viewer = (page: Page, index = 0) => page.locator("#reading .mermaid-excalidraw-container").nth(index);
async function mount(page: Page, source: string, language = "mermaid-excalidraw") {
  await page.evaluate(({ source, language }) => window.harness.mount(source, language), { source, language });
  await expect(viewer(page)).toHaveAttribute("data-state", "ready");
  await expectFit(page, viewer(page), 0, 3);
}
function edgeBetween(scene: NativeScene, from: string, to: string) {
  const a = nodeOf(scene, from), b = nodeOf(scene, to);
  const edge = scene.find(element => element.type === "arrow" && element.startBinding?.elementId === a.id && element.endBinding?.elementId === b.id);
  if (!edge || edge.type !== "arrow") throw new Error(`Missing edge: ${from} → ${to}`);
  return edge;
}

for (const syntax of syntaxes) for (const direction of directions) {
  test(`${syntax} ${direction}: native nodes, bound labelled arrows and projected text/shaft/head ink in Light/Dark`, async ({ page }, info) => {
    await mount(page, directionFixture(syntax, direction), "mermaid");
    const scene = await nativeScene(page);
    expect(scene.filter(element => element.type === "rectangle")).toHaveLength(3);
    expect(scene.filter(element => element.type === "arrow")).toHaveLength(2);
    expectDirection(scene, direction);
    textOf(scene, "Next");
    for (const [from, to] of [["Input", "Process"], ["Process", "Output"]]) {
      const edge = edgeBetween(scene, from!, to!);
      expect(edge.startArrowhead).toBeNull(); expect(edge.endArrowhead).toBe("arrow");
    }
    for (const dark of [false, true]) {
      await page.evaluate(dark => window.harness.theme(dark), dark);
      await expect.poll(() => page.evaluate(() => window.harness.sceneDiagnostics()[0]?.appearance?.theme)).toBe(dark ? "dark" : "light");
      const current = await nativeScene(page);
      expectDirection(current, direction);
      const pixels = await expectNativePixels(page, viewer(page), 0, current);
      await expectFit(page, viewer(page), 0, 3);
      await attachFlowchartEvidence(page, viewer(page), info, `${syntax}-${direction}-${dark ? "dark" : "light"}`, pixels);
    }
  });
}

test("invisible layout link records the upstream visible headless-line limitation and its rank effect against a no-link control", async ({ page }, info) => {
  await mount(page, invisible);
  const scene = await nativeScene(page), a = nodeOf(scene, "Input"), b = nodeOf(scene, "Layout only");
  const hidden = edgeBetween(scene, "Input", "Layout only"), visible = edgeBetween(scene, "Input", "Output");
  expect(hidden.startArrowhead).toBeNull(); expect(hidden.endArrowhead).toBeNull();
  expect(hidden.opacity).toBe(100); expect(hidden.strokeWidth).toBe(2); expect(hidden.strokeStyle).toBe("solid");
  expect(visible.endArrowhead).toBe("arrow");
  expect(b.x + b.width / 2).toBeGreaterThan(a.x + a.width / 2);
  const pixels = await expectNativePixels(page, viewer(page), 0, scene);
  expect(pixels!.find(region => region.name === hidden.id && region.kind === "shaft")!.ink).toBeGreaterThan(2);
  const absentHeads = await expectCleanHeadlessPixels(page, viewer(page), 0);
  await attachFlowchartEvidence(page, viewer(page), info, "upstream-visible-invisible-link", { pixels, absentHeads, negativeHeadRoughness: 0 });
  await page.evaluate(() => { window.harness.clear(); window.fitApis = []; });
  await mount(page, invisibleControl);
  const control = await nativeScene(page), ca = nodeOf(control, "Input"), cb = nodeOf(control, "Layout only");
  expect(control.filter(element => element.type === "arrow")).toHaveLength(1);
  edgeBetween(control, "Input", "Output");
  expect(Math.abs(cb.x + cb.width / 2 - ca.x - ca.width / 2)).toBeLessThan(ca.width / 4);
  expect(cb.y).toBeGreaterThan(ca.y + ca.height);
  // The independently declared node has a vertical open corridor. Sample it
  // outside all node/text bounds and outside the visible A→C edge's region.
  const points = [{ x: ca.x + ca.width / 2, y: ca.y + ca.height }, { x: cb.x + cb.width / 2, y: cb.y }];
  const excluded = nativeRegions(control).excluded;
  const corridor = await regionPixels(page, viewer(page), 0, [{ name: "no-link-corridor", kind: "shaft", x: Math.min(points[0]!.x, points[1]!.x), y: points[0]!.y,
    width: Math.abs(points[1]!.x - points[0]!.x), height: points[1]!.y - points[0]!.y, points }], excluded);
  expect(corridor![0]!.samples).toBeGreaterThan(0); expect(corridor![0]!.ink).toBe(0);
  await expectNativePixels(page, viewer(page), 0, control);
  await attachFlowchartEvidence(page, viewer(page), info, "no-link-control", corridor);
});

for (const edge of edges) {
  test(`${edge.name} edge: measured native style, width, label, bindings and shaft/head pixels in Light/Dark`, async ({ page }, info) => {
    await mount(page, edgeFixture(edge.syntax));
    for (const dark of [false, true]) {
      await page.evaluate(dark => window.harness.theme(dark), dark);
      const scene = await nativeScene(page), arrow = edgeBetween(scene, "Source", "Target");
      expect(scene.filter(element => element.type === "arrow")).toHaveLength(1);
      expect(arrow.strokeStyle).toBe(edge.style); expect(arrow.strokeWidth).toBe(edge.width);
      expect(arrow.startArrowhead).toBe(edge.start); expect(arrow.endArrowhead).toBe(edge.end);
      expect(arrow.points.length).toBeGreaterThanOrEqual(2);
      if (edge.label) expect(textOf(scene, edge.label).containerId).toBe(arrow.id);
      expectDirection(scene, "LR", ["Source", "Target"]);
      const pixels = await expectNativePixels(page, viewer(page), 0, scene);
      await expectFit(page, viewer(page), 0, 3);
      const absentHeads = edge.name === "line" ? await expectCleanHeadlessPixels(page, viewer(page), 0) : null;
      await attachFlowchartEvidence(page, viewer(page), info, `${edge.name}-${dark ? "dark" : "light"}`, { pixels, absentHeads, negativeHeadRoughness: absentHeads ? 0 : null });
    }
  });
}

test("basic shapes retain rectangle/rounded/ellipse/diamond bounds, wrapped labels, separate outlines and clipping-free fit", async ({ page }, info) => {
  await mount(page, shapes);
  const scene = await nativeScene(page);
  const expected = [["Rectangle", "rectangle"], ["Rounded", "rectangle"], ["Circle", "ellipse"], ["Diamond", "diamond"]] as const;
  for (const [label, type] of expected) {
    const node = nodeOf(scene, label), text = textOf(scene, label);
    expect(node.type).toBe(type); expect(node.width).toBeGreaterThan(40); expect(node.height).toBeGreaterThan(40);
    expectContains(node, text);
    // Horizontal edges meet side centers. Top/bottom outline probes cannot
    // be satisfied by those shafts or by the interior label.
    const outlines = await regionPixels(page, viewer(page), 0, [
      { x: node.x, y: node.y, width: node.width, height: 0, name: label + "-top", kind: "outline" },
      { x: node.x, y: node.y + node.height, width: node.width, height: 0, name: label + "-bottom", kind: "outline" },
    ]);
    expect(outlines!.every(region => region.ink > 5)).toBe(true);
  }
  expect(nodeOf(scene, "Rectangle").roundness).toBeNull();
  expect(nodeOf(scene, "Rounded").roundness).toEqual({ type: 3 });
  // Excalidraw text sizing can turn Mermaid's circle into an ellipse. Fix the
  // emitted type and readable label, without promising exact-circle geometry.
  const pixels = await expectNativePixels(page, viewer(page), 0, scene);
  await expectFit(page, viewer(page), 0, 3);
  await attachFlowchartEvidence(page, viewer(page), info, "basic-shapes", pixels);
});

for (const fixture of [
  { name: "basic", source: basicSubgraph, labels: ["Basic group", "Alpha", "Beta"], groups: ["Basic group"], nodes: ["Alpha", "Beta"], direction: "LR" },
  { name: "nested", source: nestedSubgraph, labels: ["Outer", "Inner", "Alpha", "Beta", "Gamma", "Delta"], groups: ["Outer", "Inner"], nodes: ["Alpha", "Beta", "Gamma", "Delta"], direction: "LR" },
  { name: "internal direction", source: directedSubgraph, labels: ["Internal LR", "Alpha", "Beta"], groups: ["Internal LR"], nodes: ["Alpha", "Beta"], direction: "LR" },
  { name: "external connection inherits parent direction", source: externallyConnectedSubgraph, labels: ["External connection", "Alpha", "Beta", "Outside"], groups: ["External connection"], nodes: ["Alpha", "Beta", "Outside"], direction: "TB" },
]) {
  test(`${fixture.name} subgraph fallback: boundaries, labels, nested containment, Mermaid direction and visible SVG ink in Light/Dark`, async ({ page }, info) => {
    await mount(page, fixture.source);
    expect(await page.evaluate(() => window.harness.sceneSummaries())).toEqual([{ count: 1, imageFallback: true }]);
    const { source } = await preparedSvg(page);
    const geometry = await subgraphGeometry(page, source);
    expect(geometry.labels.map(label => label.text).sort()).toEqual([...fixture.labels].sort());
    expect(geometry.boundaries.map(group => group.name).sort()).toEqual([...fixture.groups].sort());
    expect(geometry.nodes.map(node => node.name).sort()).toEqual([...fixture.nodes].sort());
    const alpha = geometry.nodes.find(node => node.name === "Alpha")!, beta = geometry.nodes.find(node => node.name === "Beta")!;
    if (fixture.direction === "LR") expect(beta.x).toBeGreaterThan(alpha.x + alpha.width);
    else expect(beta.y).toBeGreaterThan(alpha.y + alpha.height);
    const outer = geometry.boundaries[0]!;
    for (const node of geometry.nodes.filter(node => node.name !== "Outside")) expectContains(outer, node);
    for (const boundary of geometry.boundaries) expectContains(boundary, geometry.labels.find(label => label.text === boundary.name)!);
    if (fixture.name === "nested") {
      const inner = geometry.boundaries.find(group => group.name === "Inner")!;
      expectContains(outer, inner);
      for (const label of ["Gamma", "Delta"]) expectContains(inner, geometry.nodes.find(node => node.name === label)!);
      expect(geometry.nodes.find(node => node.name === "Delta")!.y).toBeGreaterThan(geometry.nodes.find(node => node.name === "Gamma")!.y);
    }
    expect(geometry.edges).toHaveLength(fixture.name === "basic" || fixture.name === "internal direction" ? 1 : 2);
    // Grouping is one fallback image; do not claim native Excalidraw groups.
    expect(await page.evaluate(() => window.harness.sceneDiagnostics()[0]!.normalized!.elements.map(element => element.groupIds))).toEqual([[]]);
    for (const dark of [false, true]) {
      await page.evaluate(dark => window.harness.theme(dark), dark);
      const prepared = await preparedSvg(page), current = await subgraphGeometry(page, prepared.source);
      expect(current).toEqual(geometry);
      const pixels = await expectSubgraphPixels(page, viewer(page), 0, current);
      await expectFit(page, viewer(page), 0, 3);
      await attachFlowchartEvidence(page, viewer(page), info, `subgraph-${fixture.name}-${dark ? "dark" : "light"}`, { geometry: current, pixels });
    }
  });
}

test("multiple Flowcharts and graph isolate scenes and invalid isolation renders a text-only parse error", async ({ page }, info) => {
  await page.evaluate(({ one, bad, two, three }) => {
    window.harness.mount(one, "mermaid"); window.harness.mount(bad); window.harness.mount(two); window.harness.mount(three, "mermaid");
  }, { one: directionFixture("flowchart", "LR"), bad: invalid, two: directionFixture("graph", "BT"), three: edgeFixture("<-->") });
  await expect(page.locator('[data-state="ready"]')).toHaveCount(3);
  await expect(page.locator('[data-state="error"]')).toHaveCount(1);
  await expect(page.getByRole("alert")).toContainText("Parse error");
  await expect(page.getByRole("alert")).toContainText("</b>");
  await expect(page.locator("#flowchart-injection, [role=alert] b, [role=alert] img, [role=alert] script")).toHaveCount(0);
  const scenes = [await nativeScene(page, 0), await nativeScene(page, 2), await nativeScene(page, 3)];
  expectDirection(scenes[0]!, "LR"); expectDirection(scenes[1]!, "BT");
  expect(new Set(scenes.flatMap(scene => scene.map(element => element.id))).size).toBe(scenes.reduce((sum, scene) => sum + scene.length, 0));
  for (const [mountIndex, apiIndex, sceneIndex] of [[0, 0, 0], [2, 1, 1], [3, 2, 2]]) {
    await expectFit(page, viewer(page, mountIndex), apiIndex!, 3);
    await expectNativePixels(page, viewer(page, mountIndex), apiIndex!, scenes[sceneIndex!]!);
  }
  await attachFlowchartEvidence(page, viewer(page), info, "multiple-and-invalid", await page.getByRole("alert").allTextContents());
});

test("Flowchart lifecycle keeps fit and current scenes through hidden reveal, theme, resize, rerender, note switch and disable", async ({ page }, info) => {
  await page.evaluate(() => { document.getElementById("reading")!.hidden = true; });
  await page.evaluate(source => window.harness.mount(source), directionFixture("flowchart", "LR"));
  await expect(viewer(page)).toHaveAttribute("data-state", "ready");
  await page.evaluate(() => { document.getElementById("reading")!.hidden = false; });
  for (const width of [1100, 340, 760]) {
    await page.setViewportSize({ width, height: 900 });
    await expectFit(page, viewer(page), 0, 3);
    const current = await nativeScene(page);
    expectDirection(current, "LR");
    for (const [from, to] of [["Input", "Process"], ["Process", "Output"]]) {
      expect(edgeBetween(current, from!, to!).endArrowhead).toBe("arrow");
    }
    await expectNativePixels(page, viewer(page), 0, current, false);
    await expectNoMenuChrome(viewer(page));
  }
  await page.evaluate(() => window.harness.theme(true));
  await expectNativePixels(page, viewer(page), 0, await nativeScene(page));
  await page.evaluate(() => window.harness.setViewMode("source")); await expect(viewer(page)).toBeHidden();
  await page.evaluate(() => window.harness.setViewMode("preview")); await expectFit(page, viewer(page), 0, 3);
  await page.evaluate(() => { window.harness.viewDiagnostics(true); window.harness.rerender(); });
  await expect(viewer(page)).toHaveAttribute("data-state", "ready");
  await expect.poll(() => page.evaluate(() => window.fitApis.length)).toBe(2);
  expectDirection(await nativeScene(page), "LR");
  await expectFit(page, viewer(page), 1, 3);
  expect(await page.evaluate(() => window.harness.retainedViewDiagnostics())).toEqual([{ root: false, data: false, converted: false, scene: false }]);
  await page.evaluate(source => { window.harness.viewDiagnostics(true); window.harness.clear(); window.harness.mount(source); }, directionFixture("graph", "RL"));
  await expect(viewer(page)).toHaveAttribute("data-state", "ready");
  await expect.poll(() => page.evaluate(() => window.fitApis.length)).toBe(3);
  expectDirection(await nativeScene(page), "RL");
  await expectNativePixels(page, viewer(page), 2, await nativeScene(page));
  await page.evaluate(() => window.harness.viewDiagnostics(true));
  await page.getByRole("button", { name: "Open enlarged Mermaid diagram" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(1);
  await page.evaluate(() => window.harness.disable());
  await expect(page.locator("canvas, [role=dialog]")).toHaveCount(0);
  expect(await page.evaluate(() => window.harness.hostState().children)).toBe(0);
  expect(await page.evaluate(() => window.harness.viewDiagnostics())).toEqual([]);
  expect((await page.evaluate(() => window.harness.retainedViewDiagnostics())).every(cache => !cache.root && !cache.data && !cache.converted && !cache.scene)).toBe(true);
  await info.attach("disposed-flowchart-roots", { body: JSON.stringify(await page.evaluate(() => window.harness.retainedViewDiagnostics())), contentType: "application/json" });
});

for (const language of ["mermaid", "mermaid-excalidraw"]) {
  test(`${language} Live Preview Flowchart preserves source, selection, OFF routing, composition and Undo/Redo`, async ({ page }, info) => {
    const doc = `Before\n\n\`\`\`${language}\n${directionFixture("flowchart", "RL")}\n\`\`\`\n\nAfter`;
    await page.evaluate(doc => window.harness.editors.create("flowchart-editor", doc), doc);
    const editor = page.locator("#flowchart-editor"), inline = editor.locator(".mermaid-excalidraw-container");
    await expect(inline).toHaveAttribute("data-state", "ready");
    const before = await page.evaluate(() => window.harness.editors.snapshot("flowchart-editor"));
    expectDirection(await nativeScene(page), "RL");
    await expectNativePixels(page, inline, 0, await nativeScene(page));
    await page.evaluate(() => window.harness.updateSettings({ renderStandardMermaid: false }));
    if (language === "mermaid") {
      await expect(editor.locator(".host-editor-mermaid")).toHaveCount(1); await expect(inline).toHaveCount(0);
    } else await expect(inline).toHaveAttribute("data-state", "ready");
    expect(await page.evaluate(() => window.harness.editors.snapshot("flowchart-editor"))).toEqual(before);
    await page.evaluate(() => window.harness.updateSettings({ renderStandardMermaid: true }));
    await expect(inline).toHaveAttribute("data-state", "ready");
    const position = doc.indexOf("Input");
    await page.evaluate(position => {
      const editors = window.harness.editors; editors.select("flowchart-editor", [[position, position + 5]]);
      editors.view("flowchart-editor").focus(); editors.composition("flowchart-editor", true);
      editors.edit("flowchart-editor", position, position + 5, "Latest"); editors.composition("flowchart-editor", false);
    }, position);
    await expect(inline).toHaveCount(0); await expect(editor.locator(".cm-content")).toContainText("Latest");
    expect(await page.evaluate(() => document.activeElement === window.harness.editors.view("flowchart-editor").contentDOM)).toBe(true);
    await page.evaluate(() => { const editors = window.harness.editors; editors.select("flowchart-editor", [[0, 0]]); });
    await expect(inline).toHaveAttribute("data-state", "ready"); textOf(await nativeScene(page), "Latest");
    expect(await page.evaluate(() => window.harness.editors.undo("flowchart-editor"))).toBe(true);
    expect((await page.evaluate(() => window.harness.editors.snapshot("flowchart-editor"))).doc).toBe(doc);
    expect(await page.evaluate(() => window.harness.editors.redo("flowchart-editor"))).toBe(true);
    await page.evaluate(() => window.harness.editors.select("flowchart-editor", [[0, 0]]));
    await expect(inline).toHaveAttribute("data-state", "ready"); textOf(await nativeScene(page), "Latest");
    await attachFlowchartEvidence(page, inline, info, `${language}-live-preview`, await page.evaluate(() => window.harness.editors.snapshot("flowchart-editor")));
    await page.evaluate(() => { window.harness.viewDiagnostics(true); window.harness.editors.destroy("flowchart-editor"); });
    await expect(page.locator("canvas")).toHaveCount(0);
    expect(await page.evaluate(() => window.harness.mountedScenes())).toEqual([]);
  });
}

test("Flowchart fit still enlarges a small scene and shrinks a larger scene without clipping", async ({ page }, info) => {
  await mount(page, edgeFixture("-->"));
  expect((await fitState(page))!.zoom).toBeGreaterThan(1);
  const small = await fitState(page);
  await page.evaluate(() => { window.harness.clear(); window.fitApis = []; });
  const large = `flowchart LR\n${Array.from({ length: 10 }, (_, i) => `N${i}[Stage ${i}] --> N${i + 1}[Stage ${i + 1}]`).join("\n")}`;
  await mount(page, large);
  const state = await expectFit(page, viewer(page), 0, 3);
  expect(state.zoom).toBeLessThan(1);
  const largeScene = await nativeScene(page);
  expect(largeScene.filter(element => element.type === "rectangle")).toHaveLength(11);
  expect(largeScene.filter(element => element.type === "arrow")).toHaveLength(10);
  for (let i = 0; i < 10; i++) {
    const edge = edgeBetween(largeScene, `Stage ${i}`, `Stage ${i + 1}`);
    expect(edge.startArrowhead).toBeNull(); expect(edge.endArrowhead).toBe("arrow");
  }
  await expectNativePixels(page, viewer(page), 0, largeScene, false);
  await attachFlowchartEvidence(page, viewer(page), info, "small-large-fit", { small, large: state });
});
