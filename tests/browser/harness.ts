import * as mock from "./obsidian-mock";
import type { PluginSettings } from "../../src/types";
import { samples } from "./samples";

interface TestPlugin extends mock.Plugin {
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
  updateSettings(settings: PluginSettings) { return plugin.updateSettings(settings); },
  savedSettings() { return plugin.saved; },
  registeredLanguages() { return [...plugin.processors.keys()]; },
  sceneSummaries() {
    return [...children].map((child) => {
      const data: unknown = Reflect.get(child, "data");
      if (typeof data !== "object" || data === null || !("elements" in data) || !Array.isArray(data.elements)) return null;
      return { count: data.elements.length, imageFallback: "files" in data && data.files !== undefined };
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
