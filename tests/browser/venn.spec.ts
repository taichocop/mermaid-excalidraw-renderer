import { expect, test } from "@playwright/test";
import { vennFixtures, twoSets, threeSets, invalidUnion, injectedError, nativeFlow } from "./venn-fixtures";
import { attachVennEvidence, expectVennPixels, preparedVenn, vennGeometry, vennPixels } from "./venn-assertions";
import { expectBoundedInk, expectNoMenuChrome } from "./chrome-assertions";
import { watchErrors } from "./pie-assertions";

test.beforeEach(async ({ page }) => {
  await page.route("**/favicon.ico", route => route.fulfill({ status: 204 }));
  await page.goto("/"); await page.evaluate(() => window.ready);
});

for (const fixture of vennFixtures) {
  test(`${fixture.name}: SVG fallback preserves emitted geometry, every label and semantic overlap in Light → Dark → Light`, async ({ page }, info) => {
    const assertErrors = watchErrors(page);
    await page.evaluate(source => window.harness.mount(source), fixture.source);
    const initial = await preparedVenn(page, fixture.source);
    const original = await vennGeometry(page, initial.rawFile.dataURL);
    expect(original.sets).toHaveLength(fixture.sets);
    expect(original.labels.map(t => t.text.replace(/^"|"$/g, "")).sort()).toEqual([...fixture.labels].sort());
    expect(original.zeroStrokeCircles).toBe(0);
    for (const set of original.sets) {
      expect(Number(set.paint.fillOpacity)).toBeGreaterThan(0); expect(Number(set.paint.fillOpacity)).toBeLessThan(1);
      expect(Number.parseFloat(set.paint.strokeWidth)).toBeGreaterThan(0);
    }
    if (fixture.name === "sizes") {
      const [alpha, beta] = original.sets;
      expect(alpha!.box.width * alpha!.box.height).toBeGreaterThan(beta!.box.width * beta!.box.height * 1.4);
    }
    const ids: string[] = [];
    for (const dark of [false, true, false]) {
      await page.evaluate(dark => window.harness.theme(dark), dark);
      const prepared = await preparedVenn(page, fixture.source);
      const normalized = await vennGeometry(page, prepared.file.dataURL);
      expect(normalized.structure).toEqual(original.structure);
      expect(normalized.labels).toEqual(original.labels); expect(normalized.contours).toEqual(original.contours);
      expect(normalized.viewBox).toEqual(original.viewBox); expect(normalized.regions).toEqual(original.regions);
      expect([normalized.width, normalized.height]).toEqual([initial.scene.raw!.elements[0]!.width, initial.scene.raw!.elements[0]!.height]);
      expect(normalized.sets.map(s => ({ box: s.box, ...s.paint, fill: null, stroke: null })))
        .toEqual(original.sets.map(s => ({ box: s.box, ...s.paint, fill: null, stroke: null })));
      expect(normalized.intersections.map(s => s.paint.fillOpacity)).toEqual(original.intersections.map(s => s.paint.fillOpacity));
      const viewer = page.locator(".mermaid-excalidraw-container");
      let pixels;
      try { pixels = await expectVennPixels(viewer, normalized, prepared.file.dataURL, dark); }
      finally { await attachVennEvidence(info, `${fixture.name}-${dark ? "dark" : "light"}`, prepared,
        { original, normalized, pixels: pixels ?? await vennPixels(viewer, normalized, prepared.file.dataURL, dark) }, viewer); }
      expect(normalized.sets.every(s => s.paint.fill === (dark ? "rgb(255, 255, 255)" : "rgb(0, 0, 0)"))).toBe(true);
      ids.push(prepared.file.id);
      await expectNoMenuChrome(viewer);
    }
    expect(ids[0]).not.toBe(ids[1]); expect(ids[0]).toBe(ids[2]);
    assertErrors();
  });
}

test("independent Venn scenes and files coexist with native Flowchart, parser errors stay text-only", async ({ page }, info) => {
  const assertErrors = watchErrors(page, 2);
  await page.evaluate(({ twoSets, threeSets, invalidUnion, injectedError, nativeFlow }) => {
    for (const source of [twoSets, invalidUnion, threeSets, injectedError, nativeFlow]) window.harness.mount(source);
  }, { twoSets, threeSets, invalidUnion, injectedError, nativeFlow });
  await expect(page.locator('[data-state="ready"]')).toHaveCount(3);
  await expect(page.getByRole("alert")).toHaveCount(2);
  for (const alert of await page.getByRole("alert").all()) await expect(alert).toContainText("unknown set identifier: B");
  await expect(page.locator("#venn-injection,[role=alert] b,[role=alert] img,[role=alert] script")).toHaveCount(0);
  const first = await preparedVenn(page, twoSets), second = await preparedVenn(page, threeSets);
  const geometries = [await vennGeometry(page, first.file.dataURL), await vennGeometry(page, second.file.dataURL)];
  const viewers = page.locator('[data-state="ready"]');
  for (const dark of [false, true, false]) {
    await page.evaluate(dark => window.harness.theme(dark), dark);
    for (const [index, source] of [twoSets, threeSets].entries()) {
      const prepared = await preparedVenn(page, source);
      await expectVennPixels(viewers.nth(index), geometries[index]!, prepared.file.dataURL, dark);
    }
    const a = await preparedVenn(page, twoSets), b = await preparedVenn(page, threeSets);
    expect(a.file.id).not.toBe(b.file.id); expect(a.rawFile.id).not.toBe(b.rawFile.id);
    const flow = (await page.evaluate(source => window.harness.sceneDiagnostics().find(s => s.source === source), nativeFlow))!;
    expect(flow.raw!.files).toBeUndefined(); expect(flow.raw!.elements.some(e => e.type === "image")).toBe(false);
    expect(flow.raw!.elements.some(e => e.type === "arrow")).toBe(true);
    expect(await page.evaluate(() => window.harness.mountedScenes().at(-1)?.labels)).toEqual(expect.arrayContaining(["Idea", "Result"]));
    await expectBoundedInk(viewers.nth(2));
  }
  await info.attach("coexistence", { body: JSON.stringify(await page.evaluate(() => window.harness.sceneDiagnostics())), contentType: "application/json" });
  assertErrors();
});

test("Venn auto-fit survives narrow/wide resize, initially hidden panes, settings and disposal", async ({ page }) => {
  test.setTimeout(180_000);
  const assertErrors = watchErrors(page);
  await page.locator("main").evaluate(node => { node.style.display = "none"; });
  await page.evaluate(source => window.harness.mount(source), threeSets);
  const initial = await preparedVenn(page, threeSets);
  const geometry = await vennGeometry(page, initial.file.dataURL);
  await page.locator("main").evaluate(node => { node.style.display = ""; });
  const viewer = page.locator(".mermaid-excalidraw-container");
  for (const width of [1100, 360, 700, 1100]) {
    await page.setViewportSize({ width, height: 900 });
    await expectVennPixels(viewer, geometry, initial.file.dataURL, false);
  }
  await page.evaluate(() => window.harness.viewDiagnostics(true));
  await page.evaluate(() => window.harness.rerender());
  const rerender = await preparedVenn(page, threeSets);
  await expectVennPixels(viewer, geometry, rerender.file.dataURL, false);
  await page.evaluate(() => window.harness.updateSettings({ roughness: 2, canvasHeight: 420, canvasPadding: 48 }));
  await expect.poll(() => viewer.evaluate(node => node.clientHeight)).toBe(420);
  expect((await preparedVenn(page, threeSets)).file.dataURL).toBe(rerender.file.dataURL);
  await expectVennPixels(viewer, geometry, rerender.file.dataURL, false);
  await page.evaluate(() => window.harness.updateSettings({ fontSize: 24 }));
  const redraw = await preparedVenn(page, threeSets);
  await expectVennPixels(viewer, await vennGeometry(page, redraw.file.dataURL), redraw.file.dataURL, false);
  await page.evaluate(source => { window.harness.clear(); window.harness.mount(source); }, twoSets);
  const next = await preparedVenn(page, twoSets);
  await expectVennPixels(viewer, await vennGeometry(page, next.file.dataURL), next.file.dataURL, false);
  expect(Buffer.from(next.file.dataURL.split(",")[1]!, "base64").toString()).not.toContain("Innovation");
  await page.evaluate(() => window.harness.viewDiagnostics(true));
  await viewer.getByRole("button", { name: "Open enlarged Mermaid diagram" }).click();
  await page.evaluate(() => window.harness.clear());
  await expect(page.locator("canvas,[role=dialog]")).toHaveCount(0);
  expect(await page.evaluate(() => window.harness.viewDiagnostics())).toEqual([]);
  expect(await page.evaluate(() => window.harness.retainedViewDiagnostics())).toEqual([
    { root: false, data: false, converted: false, scene: false }, { root: false, data: false, converted: false, scene: false },
  ]);
  await page.evaluate(source => { window.harness.mount(source); window.harness.clear(); window.harness.mount(source); }, twoSets);
  const last = await preparedVenn(page, twoSets);
  await expectVennPixels(viewer, await vennGeometry(page, last.file.dataURL), last.file.dataURL, false);
  await page.evaluate(() => { window.harness.viewDiagnostics(true); window.harness.disable(); });
  await expect(page.locator("canvas,[role=dialog]")).toHaveCount(0);
  expect(await page.evaluate(() => window.harness.hostState().children)).toBe(0);
  expect((await page.evaluate(() => window.harness.retainedViewDiagnostics())).every(c => !c.root && !c.data && !c.converted && !c.scene)).toBe(true);
  assertErrors();
});

test("passive Venn opens with click/Enter/Space; Modal keeps overlap, optimized Fit, exact Reset and focus cycle", async ({ page }) => {
  test.setTimeout(180_000);
  const assertErrors = watchErrors(page);
  await page.evaluate(source => window.harness.mount(source), threeSets);
  const prepared = await preparedVenn(page, threeSets), geometry = await vennGeometry(page, prepared.file.dataURL);
  const inline = page.locator(".mermaid-excalidraw-container");
  const opener = inline.getByRole("button", { name: "Open enlarged Mermaid diagram" });
  await expectVennPixels(inline, geometry, prepared.file.dataURL, false);
  expect(await opener.evaluate(node => [0, 1].map(deltaMode => {
    const event = new WheelEvent("wheel", { deltaY: 4, deltaMode, bubbles: true, cancelable: true });
    node.dispatchEvent(event); return event.defaultPrevented;
  }))).toEqual([false, false]);
  for (const activation of ["click", "Enter", "Space"]) {
    await opener.focus(); if (activation === "click") await opener.click(); else await page.keyboard.press(activation);
    const modal = page.getByRole("dialog"), viewer = modal.locator(".mermaid-excalidraw-enlarged");
    await expect(modal).toHaveCount(1); await expectNoMenuChrome(viewer);
    const controls = modal.locator(".mermaid-excalidraw-controls button");
    await expect(controls).toHaveCount(5);
    const stops = [modal.getByRole("button", { name: "Close dialog", exact: true }), ...Array.from({ length: 5 }, (_, i) => controls.nth(i))];
    await stops[0]!.focus();
    for (let i = 1; i <= stops.length; i++) { await page.keyboard.press("Tab"); await expect(stops[i % stops.length]!).toBeFocused(); }
    for (let i = stops.length - 1; i >= 0; i--) { await page.keyboard.press("Shift+Tab"); await expect(stops[i]!).toBeFocused(); }
    for (const dark of [false, true, false]) {
      await page.evaluate(dark => window.harness.theme(dark), dark);
      const current = await preparedVenn(page, threeSets);
      await expectVennPixels(viewer, geometry, current.file.dataURL, dark);
    }
    const level = modal.getByLabel("Zoom level");
    const fit = await level.textContent(); expect(Number.parseInt(fit!)).toBeGreaterThan(100);
    await modal.getByRole("button", { name: "Reset zoom" }).click(); await expect(level).toHaveText("100%");
    await expectVennPixels(viewer, geometry, prepared.file.dataURL, false);
    await modal.getByRole("button", { name: "Zoom in", exact: true }).click(); await expect(level).toHaveText("120%");
    await modal.getByRole("button", { name: "Zoom out", exact: true }).click(); await expect(level).toHaveText("100%");
    await modal.getByRole("button", { name: "Fit to content" }).click(); await expect(level).toHaveText(fit!);
    await expectVennPixels(viewer, geometry, prepared.file.dataURL, false);
    if (activation === "Enter") await modal.getByRole("button", { name: "Close preview" }).click(); else await page.keyboard.press("Escape");
    await expect(modal).toHaveCount(0); await expect(opener).toBeFocused();
  }
  assertErrors();
});

test("production normalization preserves generic translucent fills, empty fills, stroke and zero-stroke markers", async ({ page }, info) => {
  const assertErrors = watchErrors(page);
  await page.evaluate(source => window.harness.mount(source), twoSets);
  await preparedVenn(page, twoSets);
  // Replace only this disposable converter BinaryFile before a production
  // appearance redraw. No alternate normalizer or upstream API is invoked.
  await page.evaluate(async () => {
    const scene = window.harness.sceneDiagnostics()[0]!;
    const file = Object.values(scene.raw!.files!)[0]!;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="360" height="30" id="semantic-controls">
      <rect x="5" y="5" width="20" height="20" fill="red" fill-opacity=".25" stroke-width="2"/>
      <ellipse cx="45" cy="15" rx="10" ry="10" fill="red" style="fill-opacity:25%;stroke-width:2"/>
      <path d="M65 5h20v20H65Z" fill="red" fill-opacity=".25" style="fill-opacity:1;stroke-width:2"/>
      <rect x="95" y="5" width="20" height="20" fill="red" fill-opacity="1" style="fill-opacity:.25;stroke-width:2"/>
      <rect x="125" y="5" width="20" height="20" fill="none" fill-opacity=".25" stroke-width="2"/>
      <rect x="155" y="5" width="20" height="20" style="fill:none;fill-opacity:.25;stroke-width:2"/>
      <rect x="185" y="5" width="20" height="20" style="fill:transparent;stroke-width:2"/>
      <rect x="215" y="5" width="20" height="20" fill="red" opacity=".25" stroke-width="2"/>
      <circle cx="255" cy="15" r="10" fill="red" stroke-width="0"/>
      <circle cx="285" cy="15" r="10" fill="red" stroke-width="0px"/>
      <circle cx="315" cy="15" r="10" fill="none" stroke-width="0"/>
      <circle cx="345" cy="15" r="10" style="fill:none" stroke-width="0px"/>
    </svg>`;
    file.dataURL = `data:image/svg+xml;base64,${btoa(svg)}` as typeof file.dataURL;
    await window.harness.updateSettings({ roughness: 2 });
  });
  for (const dark of [false, true]) {
    await page.evaluate(dark => window.harness.theme(dark), dark);
    let prepared = await preparedVenn(page, twoSets);
    await expect.poll(async () => {
      prepared = await preparedVenn(page, twoSets);
      return Buffer.from(prepared.file.dataURL.split(",")[1]!, "base64").toString().includes("semantic-controls");
    }).toBe(true);
    const pixels = await page.evaluate(async ({ dataURL, dark }) => {
      const image = new Image(); image.src = dataURL; await image.decode();
      const canvas = document.createElement("canvas"); canvas.width = 360; canvas.height = 30;
      const context = canvas.getContext("2d", { willReadFrequently: true })!;
      context.fillStyle = dark ? "#1e1e1e" : "white"; context.fillRect(0, 0, 360, 30); context.drawImage(image, 0, 0);
      return Array.from({ length: 12 }, (_, index) => ({
        center: [...context.getImageData(15 + index * 30, 15, 1, 1).data],
        edge: [...context.getImageData(15 + index * 30, 5, 1, 1).data],
      }));
    }, { dataURL: prepared.file.dataURL, dark });
    const bg = dark ? 30 : 255, fg = dark ? 255 : 0;
    for (const index of [0, 1, 3]) {
      expect(Math.abs(pixels[index]!.center[0]! - (bg * .75 + fg * .25))).toBeLessThanOrEqual(2);
      expect(Math.abs(pixels[index]!.edge[0]! - fg)).toBeLessThanOrEqual(2);
    }
    for (const index of [2, 4, 5, 6, 7, 10, 11]) expect(pixels[index]!.center).toEqual([bg, bg, bg, 255]);
    for (const index of [8, 9]) expect(pixels[index]!.center).toEqual([fg, fg, fg, 255]);
    await info.attach(`generic-fill-${dark ? "dark" : "light"}`, { body: JSON.stringify(pixels), contentType: "application/json" });
  }
  assertErrors();
});

test("Mermaid handDrawn look remains an SVG image rather than editable native shapes", async ({ page }, info) => {
  const assertErrors = watchErrors(page);
  const source = `---\nconfig:\n  look: handDrawn\n---\n${threeSets}`;
  await page.evaluate(source => window.harness.mount(source), source);
  const prepared = await preparedVenn(page, source);
  const viewer = page.locator(".mermaid-excalidraw-container");
  for (const dark of [false, true]) {
    await page.evaluate(dark => window.harness.theme(dark), dark);
    const current = await preparedVenn(page, source);
    const structure = await vennGeometry(page, current.file.dataURL);
    expect(structure.labels.map(t => t.text.replace(/^"|"$/g, "")).sort()).toEqual([...vennFixtures[2].labels].sort());
    await expectBoundedInk(viewer);
    await attachVennEvidence(info, `handDrawn-${dark ? "dark" : "light"}`, current, structure, viewer);
  }
  const before = (await preparedVenn(page, source)).file.dataURL;
  await page.evaluate(() => window.harness.updateSettings({ roughness: 2 }));
  expect((await preparedVenn(page, source)).file.dataURL).toBe(before);
  expect(prepared.scene.raw!.elements[0]!.type).toBe("image");
  assertErrors();
});
