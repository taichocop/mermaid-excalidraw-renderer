import { expect, test } from "@playwright/test";

// This instrumentation belongs only to a disposable test page. Production code
// does not replace Function, WebAssembly, storage, clipboard or launch APIs.
test("local rendering and blocked export do not enter retained dynamic, file or storage capabilities", async ({ page }, testInfo) => {
  await page.addInitScript(() => {
    const report = { generated: [] as string[][], wasm: [] as string[], sinks: [] as string[], requires: [] as string[], launches: 0 };
    const consumers: ((params: { files: FileSystemFileHandle[] }) => unknown)[] = [];
    Object.assign(window, { retainedReport: report, retainedLaunchConsumers: consumers });
    const originalFunction = Function;
    Reflect.set(window, "Function", new Proxy(originalFunction, {
      apply(target, receiver, args: string[]) {
        report.generated.push(args.map(String));
        return Reflect.apply(target, receiver, args);
      },
      construct(target, args: string[], newTarget) {
        report.generated.push(args.map(String));
        return Reflect.construct(target, args, newTarget);
      },
    }));
    for (const name of ["instantiate", "instantiateStreaming", "compile", "compileStreaming", "Module", "Instance"]) {
      const original: unknown = Reflect.get(WebAssembly, name);
      if (typeof original !== "function") continue;
      Reflect.set(WebAssembly, name, new Proxy(original, {
        apply(target, receiver, args: unknown[]) {
          report.wasm.push(name);
          return Reflect.apply(target, receiver, args);
        },
        construct(target, args: unknown[], newTarget) {
          report.wasm.push(name);
          return Reflect.construct(target, args, newTarget);
        },
      }));
    }
    // Model the renderer's window + Node-like process combination without any
    // Node capability. A mistaken environment branch can only hit these sinks.
    Reflect.set(window, "process", { versions: { node: "22.0.0-fixture" }, env: {}, argv: [],
      on: () => report.sinks.push("process.on"), exit: () => report.sinks.push("process.exit") });
    let bridge: (name: string) => unknown;
    Object.defineProperty(window, "requirePlugin", {
      configurable: true,
      get: () => bridge,
      set: (value: (name: string) => unknown) => {
        bridge = (name: string) => {
          report.requires.push(name);
          if (name === "fs" || name === "path" || name.startsWith("node:")) {
            report.sinks.push(`require.${name}`);
            throw new Error("Disposable Node sink");
          }
          return value(name);
        };
      },
    });
    Reflect.set(window, "LaunchParams", class {});
    Object.defineProperty(window, "launchQueue", { configurable: true, value: { setConsumer: (consumer: (params: { files: FileSystemFileHandle[] }) => unknown) => {
      report.launches++;
      consumers.push(consumer);
    } } });
    Object.defineProperty(navigator, "clipboard", { value: {
      read: async () => { report.sinks.push("clipboard.read"); return []; },
      readText: async () => { report.sinks.push("clipboard.readText"); return "Synthetic"; },
      write: async () => { report.sinks.push("clipboard.write"); },
      writeText: async () => { report.sinks.push("clipboard.writeText"); },
    } });
    document.execCommand = command => { report.sinks.push(`execCommand.${command}`); return true; };
    for (const name of ["getItem", "setItem", "removeItem", "clear", "key"] as const) {
      Storage.prototype[name] = () => { report.sinks.push(`storage.${name}`); return null; };
    }
    for (const name of ["showOpenFilePicker", "showSaveFilePicker", "showDirectoryPicker"]) {
      Reflect.set(window, name, async () => { report.sinks.push(name); throw new Error("Disposable file sink"); });
    }
  });
  const requests: string[] = [], errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto("/");
  await page.evaluate(() => window.ready);
  await page.route("**/*", route => { requests.push(route.request().url()); return route.abort(); });
  await page.evaluate(() => {
    window.harness.mountSamples(["flowchart", "class"], "mermaid");
    window.harness.mountSamples(["sequence"]);
    window.harness.mount("venn-beta\n  set A\n  set B\n  union A,B");
  });
  await expect(page.locator('[data-state="ready"]')).toHaveCount(4);
  await page.evaluate(() => document.fonts.load("20px Virgil"));
  await expect.poll(() => page.locator("canvas.static").evaluateAll(nodes => nodes.every(node => {
    const canvas = node as HTMLCanvasElement;
    return canvas.width > 0 && canvas.height > 0 && canvas.getContext("2d")!.getImageData(0, 0, canvas.width, canvas.height).data
      .some((value, index) => index % 4 === 0 && value < 200);
  }))).toBe(true);
  for (const opener of await page.getByRole("button", { name: "Open enlarged Mermaid diagram" }).all()) {
    await opener.click();
    const modal = page.getByRole("dialog"), canvas = modal.locator("canvas.interactive");
    await canvas.click();
    const blocked = await canvas.evaluate(node => {
      const data = new DataTransfer(); data.setData("text/plain", "Synthetic source stays text");
      const event = new ClipboardEvent("copy", { bubbles: true, cancelable: true, clipboardData: data });
      node.ownerDocument.dispatchEvent(event);
      return event.defaultPrevented && data.getData("text/plain") === "Synthetic source stays text";
    });
    expect(blocked).toBe(true);
    await canvas.click({ button: "right" });
    await expect(page.locator(".context-menu")).toHaveCount(0);
    for (const shortcut of ["Control+Shift+E", "Control+o", "Control+s", "Control+v", "?"]) {
      await page.keyboard.press(shortcut);
      await expect(page.getByRole("dialog")).toHaveCount(1);
    }
    await modal.getByRole("button", { name: "Zoom in", exact: true }).click();
    await modal.getByRole("button", { name: "Fit to content" }).click();
    await modal.getByRole("button", { name: "Close preview" }).click();
  }
  await page.evaluate(async () => {
    // Only the empty launch path is exercised; no file handles or host files.
    const consumers = Reflect.get(window, "retainedLaunchConsumers") as ((params: { files: FileSystemFileHandle[] }) => unknown)[];
    for (const consumer of consumers) await consumer({ files: [] });
    window.harness.disable();
  });
  await expect(page.locator("canvas")).toHaveCount(0);
  const report = await page.evaluate(() => Reflect.get(window, "retainedReport") as {
    generated: string[][]; wasm: string[]; sinks: string[]; requires: string[]; launches: number;
  });
  expect(report.generated).toEqual([]);
  expect(report.wasm).toEqual([]);
  expect(report.sinks).toEqual([]);
  expect(report.requires.length).toBeGreaterThan(0);
  expect(report.requires.every(name => ["obsidian", "@codemirror/state", "@codemirror/view", "@codemirror/language"].includes(name))).toBe(true);
  expect(report.launches).toBeGreaterThan(0);
  expect(requests).toEqual([]);
  expect(errors).toEqual([]);
  // Positive controls show that zero observations above are not broken probes.
  const control = await page.evaluate(async () => {
    const value = new Function('return "synthetic-counter-control"')() as string;
    await WebAssembly.instantiate(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]));
    const values = Reflect.get(window, "retainedReport") as { generated: string[][]; wasm: string[] };
    return { value, generated: values.generated.length, wasm: values.wasm };
  });
  expect(control).toEqual({ value: "synthetic-counter-control", generated: 1, wasm: ["instantiate"] });
  await testInfo.attach("retained-capabilities-synthetic-probes", { body: JSON.stringify({ report, requests, errors, control }), contentType: "application/json" });
});
