import * as mock from "./obsidian-mock";
import type { PluginSettings } from "../../src/types";
import type { DiagramData } from "../../src/renderer/conversion";
import { samples } from "./samples";

interface TestPlugin extends mock.Plugin {
  settings: PluginSettings;
  onload(): Promise<void>;
  onunload(): void;
  updateSettings(settings: PluginSettings): Promise<void>;
}
type PluginClass = new () => TestPlugin;
let plugin: TestPlugin;
const children = new Set<mock.MarkdownRenderChild>();

const harness = {
  async boot(Plugin: PluginClass) { plugin = new Plugin(); await plugin.onload(); },
  mount(source: string) {
    const block = document.createElement("section");
    document.querySelector("main")?.appendChild(block);
    const processor = plugin.processors.get("mermaid-excalidraw");
    if (!processor) throw new Error("Processor not registered");
    processor(source, block, { addChild(child) { children.add(child); child.load(); } });
  },
  mountSamples(names: (keyof typeof samples)[]) { names.forEach((name) => harness.mount(samples[name])); },
  clear() {
    for (const child of children) child.unload();
    children.clear();
    document.querySelector("main")?.replaceChildren();
  },
  disable() { plugin.onunload(); },
  theme(dark: boolean) {
    document.body.className = dark ? "theme-dark" : "theme-light";
    for (const callback of plugin.events) callback();
  },
  updateSettings(settings: Partial<PluginSettings>) { return plugin.updateSettings({ ...plugin.settings, ...settings }); },
  savedSettings() { return plugin.saved; },
  registeredLanguages() { return [...plugin.processors.keys()]; },
  openSettings() {
    if (!plugin.settingTab) throw new Error("Settings tab not registered");
    plugin.settingTab.display();
    document.body.append(plugin.settingTab.containerEl);
  },
  cssChanged() { for (const callback of plugin.events) callback(); },
  sceneSummaries() {
    return [...children].map((child) => {
      const data: unknown = Reflect.get(child, "data");
      if (typeof data !== "object" || data === null || !("elements" in data) || !Array.isArray(data.elements)) return null;
      return { count: data.elements.length, imageFallback: "files" in data && data.files !== undefined };
    });
  },
  // Test-only converter diagnostics. Keep sceneSummaries' existing shape and
  // never insert decoded SVG into the host DOM or call private Excalidraw APIs.
  conversionDiagnostics() {
    return [...children].map((child) => {
      const value: unknown = Reflect.get(child, "data");
      if (typeof value !== "object" || value === null || !("elements" in value) || !Array.isArray(value.elements)) return null;
      const data = value as DiagramData;
      return {
        elements: data.elements.map((element) => ({ type: element.type, width: element.width, height: element.height })),
        files: Object.values(data.files ?? {}).map((file) => {
          if (file.mimeType !== "image/svg+xml" || !file.dataURL.startsWith("data:image/svg+xml;base64,")) return { mimeType: file.mimeType, svg: null };
          const bytes = Uint8Array.from(atob(file.dataURL.slice(file.dataURL.indexOf(",") + 1)), (char) => char.charCodeAt(0));
          const source = new TextDecoder().decode(bytes);
          const svg = new DOMParser().parseFromString(source, "image/svg+xml").documentElement;
          return { mimeType: file.mimeType, svg: {
            source, width: Number(svg.getAttribute("width")), height: Number(svg.getAttribute("height")),
            viewBox: svg.getAttribute("viewBox"),
            labels: [...svg.querySelectorAll("foreignObject, text")].map((label) => label.textContent?.trim()),
            connectors: svg.querySelectorAll("path[marker-end]").length,
          } };
        }),
      };
    });
  },
};

declare global {
  interface Window {
    harness: typeof harness;
    pluginModule: { exports: { default?: PluginClass } };
    requirePlugin: (name: string) => typeof mock;
  }
}
window.harness = harness;
window.pluginModule = { exports: {} };
window.requirePlugin = (name) => {
  if (name === "obsidian") return mock;
  throw new Error(`Unexpected runtime require: ${name}`);
};
