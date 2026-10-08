import * as cmState from "@codemirror/state";
import * as cmView from "@codemirror/view";
import * as cmLanguage from "@codemirror/language";
import { EditorHarness } from "./editor-harness";
import * as mock from "./obsidian-mock";
import type { PluginSettings } from "../../src/types";
import type { DiagramData } from "../../src/renderer/conversion";
import { samples } from "./samples";
import { validateSettings } from "../../src/settings/settings";

interface TestPlugin extends mock.Plugin {
  settings: PluginSettings;
  onload(): Promise<void>;
  onunload(): void;
  updateSettings(settings: PluginSettings): Promise<void>;
}
type PluginClass = new () => TestPlugin;
let plugin: TestPlugin;
const editors = new EditorHarness(() => plugin.editorExtensions);
const children = new Set<mock.MarkdownRenderChild>();

type Block = { source: string; language: string };
const blocks: Block[] = [];
let pluginClass: PluginClass;
let competitor: mock.Plugin | null = null;
let readingView: mock.MarkdownView;
let previewInvalidated = false;
function clearRendered() {
  for (const child of [...children]) child.unload();
  children.clear();
  document.getElementById("reading")?.replaceChildren();
}
function renderBlock({ source, language }: Block) {
  const block = document.createElement("section");
  const pre = document.createElement("pre");
  const code = document.createElement("code");
  code.className = `language-${language}`;
  code.textContent = source + "\n";
  pre.append(code);
  block.append(pre);
  document.getElementById("reading")?.appendChild(block);
  mock.MarkdownPreviewRenderer.process(block, { addChild(child) {
    children.add(child);
    child.register(() => children.delete(child));
    child.load();
  } });
}
const harness = {
  editors,
  async boot(Plugin: PluginClass) {
    pluginClass = Plugin;
    plugin = new Plugin();
    plugin.editorExtensionsChanged = () => editors.reconfigure();
    readingView = new mock.MarkdownView(() => {
      if (readingView.mode === "preview") harness.rerender();
      else {
        // A full refresh invalidates a hidden preview, even while editing.
        // Rebuild when the user returns to Reading view.
        clearRendered();
        previewInvalidated = true;
      }
    });
    plugin.app.workspace.views = [readingView];
    await plugin.onload();
  },
  mount(source: string, language = "mermaid-excalidraw") {
    const block = { source, language };
    blocks.push(block);
    renderBlock(block);
  },
  mountSamples(names: (keyof typeof samples)[], language = "mermaid-excalidraw") {
    names.forEach((name) => harness.mount(samples[name], language));
  },
  rerender() { previewInvalidated = false; clearRendered(); blocks.forEach(renderBlock); },
  clear() { blocks.length = 0; clearRendered(); },
  disable() { plugin.unload(); },
  async enable(saved: unknown = plugin.saved) {
    plugin = new pluginClass();
    plugin.editorExtensionsChanged = () => editors.reconfigure();
    plugin.saved = saved;
    plugin.app.workspace.views = [readingView];
    await plugin.onload();
  },
  hostState() {
    return { editorLanguages: [...mock.MarkdownPreviewRenderer.codeBlockProcessors.keys()],
      postProcessors: mock.MarkdownPreviewRenderer.postProcessors.map(({ order }) => order),
      children: children.size, rerenders: readingView.rerenders, previewInvalidated, blocks: [...blocks] };
  },
  setViewMode(mode: "preview" | "source") {
    readingView.mode = mode;
    const main = document.getElementById("reading");
    if (main) main.hidden = mode === "source";
    if (mode === "preview" && previewInvalidated) harness.rerender();
  },
  addCompetitor(order = -200) {
    competitor = new mock.Plugin();
    competitor.registerMarkdownCodeBlockProcessor("mermaid", (source, element) => {
      element.className = "competitor-mermaid";
      element.textContent = `Competitor: ${source}`;
    }, order);
    harness.rerender();
  },
  removeCompetitor() { competitor?.unload(); competitor = null; harness.rerender(); },
  theme(dark: boolean) {
    document.body.className = dark ? "theme-dark" : "theme-light";
    for (const callback of plugin.events) callback();
  },
  updateSettings(settings: Partial<PluginSettings>) { return plugin.updateSettings({ ...plugin.settings, ...settings }); },
  savedSettings() { return plugin.saved === null ? null : validateSettings(plugin.saved); },
  registeredLanguages() { return [...plugin.processors.keys()]; },
  openSettings() {
    if (!plugin.settingTab) throw new Error("Settings tab not registered");
    plugin.settingTab.display();
    document.body.append(plugin.settingTab.containerEl);
  },
  cssChanged() { for (const callback of plugin.events) callback(); },
  mountedScenes() {
    const renderer: unknown = Reflect.get(plugin, "renderer");
    if (typeof renderer !== "object" || renderer === null) return [];
    const mounts: unknown = Reflect.get(renderer, "mounts");
    if (!(mounts instanceof Set)) return [];
    return [...mounts].map((mount: unknown) => {
      if (typeof mount !== "object" || mount === null) throw new Error("Invalid mount");
      const data = Reflect.get(mount, "data") as DiagramData | null;
      const appearance = Reflect.get(mount, "appearance") as { background: string };
      return { source: Reflect.get(mount, "source") as string, ready: !!data, background: appearance.background,
        imageFallback: !!data?.files, types: data?.elements.map((element) => element.type) ?? [],
        labels: data?.elements.flatMap((element) => {
          if ("text" in element) return [element.text];
          return "label" in element && element.label?.text ? [element.label.text] : [];
        }) ?? [],
      };
    });
  },
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
    requirePlugin: (name: string) => unknown;
  }
}
window.harness = harness;
window.pluginModule = { exports: {} };
window.requirePlugin = (name) => {
  if (name === "obsidian") return mock;
  if (name === "@codemirror/state") return cmState;
  if (name === "@codemirror/view") return cmView;
  if (name === "@codemirror/language") return cmLanguage;
  throw new Error(`Unexpected runtime require: ${name}`);
};
