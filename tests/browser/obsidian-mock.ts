import type { SettingDefinitionItem } from "obsidian";
import type { PluginSettings } from "../../src/types";
import { StateEffect, StateField, type Extension } from "@codemirror/state";

export const livePreviewMode = StateEffect.define<boolean>();
export const editorLivePreviewField = StateField.define<boolean>({
  create: () => true,
  update: (value, tr) => tr.effects.reduce((current, effect) => effect.is(livePreviewMode) ? effect.value : current, value),
});

// Model owner-document-preserving Obsidian DOM helpers in the fixture only.
Node.prototype.createEl = function (tag, options) {
  const doc = this.nodeType === 9 ? this as Document : this.ownerDocument!;
  const element = doc.createElement(tag);
  if (typeof options === "string") element.className = options;
  else if (options?.cls) element.className = Array.isArray(options.cls) ? options.cls.join(" ") : options.cls;
  this.appendChild(element);
  return element;
};
Node.prototype.createDiv = function (options) { return this.createEl("div", options); };
Node.prototype.instanceOf = function <T>(type: { new(): T }): this is Node & T {
  // Detached XML documents have no defaultView. Model constructorWin by walking
  // the node's real prototype chain, rather than using the importing realm.
  for (let proto = Object.getPrototypeOf(this); proto; proto = Object.getPrototypeOf(proto)) {
    if (proto.constructor.name === type.name) return true;
  }
  return false;
};

export class MarkdownRenderChild {
  private loaded = false;
  private cleanups: (() => void)[] = [];
  constructor(public containerEl: HTMLElement) {}
  load() { if (!this.loaded) { this.loaded = true; this.onload(); } }
  unload() { if (this.loaded) { this.loaded = false; for (const cleanup of this.cleanups.splice(0).reverse()) cleanup(); this.onunload(); } }
  register(cleanup: () => void) { this.cleanups.push(cleanup); }
  onload() {}
  onunload() {}
}

type Context = { addChild(child: MarkdownRenderChild): void };
type Processor = (source: string, element: HTMLElement, context: Context) => void;
type PostProcessor = (element: HTMLElement, context: Context) => void;

// Model the observed 1.14.4 host: ordered DOM postprocessors are separate from
// the editor's language registry. Built-in Mermaid consumes remaining code at 0.
export class MarkdownPreviewRenderer {
  static postProcessors: { processor: PostProcessor; order: number }[] = [];
  static codeBlockProcessors = new Map<string, Processor>();
  static registerPostProcessor(processor: PostProcessor, order = 0) {
    this.postProcessors.push({ processor, order });
    this.postProcessors.sort((a, b) => a.order - b.order);
  }
  static unregisterPostProcessor(processor: PostProcessor) {
    this.postProcessors = this.postProcessors.filter((entry) => entry.processor !== processor);
  }
  static createCodeBlockPostProcessor(language: string, handler: Processor): PostProcessor {
    return (element, context) => {
      for (const code of element.querySelectorAll(`code.language-${language}`)) {
        const source = (code.textContent ?? "").replace(/\n$/, "");
        const block = document.createElement("div");
        block.className = `block-language-${language}`;
        code.parentElement?.replaceWith(block);
        handler(source, block, context);
      }
    };
  }
  static process(element: HTMLElement, context: Context) {
    for (const { processor } of this.postProcessors) processor(element, context);
  }
}
const builtInMermaid = MarkdownPreviewRenderer.createCodeBlockPostProcessor("mermaid", (source, element) => {
  element.className = "standard-mermaid";
  // Placeholder, not an alternate Mermaid renderer or native-host proof.
  element.textContent = `Obsidian standard Mermaid: ${source}`;
});
MarkdownPreviewRenderer.registerPostProcessor(builtInMermaid);

export class MarkdownView {
  mode: "preview" | "source" = "preview";
  rerenders = 0;
  previewMode: { rerender(full?: boolean): void };
  constructor(refresh: () => void) {
    this.previewMode = { rerender: (full) => {
      if (full !== true) throw new Error("Expected full preview rerender");
      this.rerenders++;
      refresh();
    } };
  }
  getMode() { return this.mode; }
}

// Public parent-scope/stack model only; the real host's event order is supplied
// separately by the regression fixture, before any viewer is mounted.
export class Scope {
  constructor(readonly parent?: Scope) {}
}
export class Keymap {
  readonly scopes: Scope[] = [];
  pushScope(scope: Scope) { this.scopes.push(scope); }
  popScope(scope: Scope) {
    const index = this.scopes.lastIndexOf(scope);
    if (index !== -1) this.scopes.splice(index, 1);
  }
  reachesHost(host: Scope): boolean {
    for (let scope: Scope | undefined = this.scopes.at(-1) ?? host; scope; scope = scope.parent) {
      if (scope === host) return true;
    }
    return false;
  }
}

export class Plugin {
  editorExtensions: Extension[] = [];
  editorExtensionsChanged: () => void = () => {};
  registerEditorExtension(extension: Extension) {
    this.editorExtensions.push(extension);
    this.editorExtensionsChanged();
    this.register(() => {
      this.editorExtensions = this.editorExtensions.filter((entry) => entry !== extension);
      this.editorExtensionsChanged();
    });
  }
  processors = new Map<string, Processor>();
  events: (() => void)[] = [];
  private cleanups: (() => void)[] = [];
  saved: unknown = null;
  settingTab: PluginSettingTab | null = null;
  app = { keymap: new Keymap(), scope: new Scope(), workspace: {
    views: [] as MarkdownView[],
    on: (_name: string, callback: () => void) => { this.events.push(callback); return callback; },
    onLayoutReady: (callback: () => void) => callback(),
    getLeavesOfType: (_type: string) => this.app.workspace.views.map((view) => ({ view })),
  } };
  async loadData(): Promise<unknown> { return this.saved; }
  async saveData(data: PluginSettings) { this.saved = JSON.parse(JSON.stringify(data)); }
  register(cleanup: () => void) { this.cleanups.push(cleanup); }
  registerMarkdownPostProcessor(processor: PostProcessor, sortOrder = 0) {
    MarkdownPreviewRenderer.registerPostProcessor(processor, sortOrder);
    this.register(() => MarkdownPreviewRenderer.unregisterPostProcessor(processor));
    return processor;
  }
  registerMarkdownCodeBlockProcessor(language: string, handler: Processor, sortOrder = 0) {
    const processor = MarkdownPreviewRenderer.createCodeBlockPostProcessor(language, handler);
    MarkdownPreviewRenderer.registerPostProcessor(processor, sortOrder);
    if (MarkdownPreviewRenderer.codeBlockProcessors.has(language)) throw new Error(`Code block postprocessor for language ${language} is already registered`);
    MarkdownPreviewRenderer.codeBlockProcessors.set(language, handler);
    this.processors.set(language, handler);
    this.editorExtensionsChanged();
    this.register(() => {
      MarkdownPreviewRenderer.codeBlockProcessors.delete(language);
      this.processors.delete(language);
      MarkdownPreviewRenderer.unregisterPostProcessor(processor);
      this.editorExtensionsChanged();
    });
    return processor;
  }
  registerEvent(event: unknown) { this.register(() => { this.events = this.events.filter((callback) => callback !== event); }); }
  addSettingTab(tab: PluginSettingTab) { this.settingTab = tab; }
  onunload() {}
  unload() { for (const cleanup of this.cleanups.splice(0).reverse()) cleanup(); this.onunload(); }
}

export class PluginSettingTab {
  containerEl = Object.assign(document.createElement("aside"), { empty(this: HTMLElement) { this.replaceChildren(); } });
  constructor(_app: unknown, _plugin: unknown) {}
  getSettingDefinitions(): SettingDefinitionItem[] { return []; }
  getControlValue(_key: string): unknown { return undefined; }
  async setControlValue(_key: string, _value: unknown): Promise<void> {}
  display() {
    this.containerEl.replaceChildren();
    // Only the six public control types used here, not an alternate host API.
    for (const definition of this.getSettingDefinitions()) {
      if (!("control" in definition) || !definition.control) continue;
      const control = definition.control;
      const setting = new Setting(this.containerEl).setName(definition.name);
      const value = this.getControlValue(control.key) ?? control.defaultValue;
      const changed = (value: unknown) => this.setControlValue(control.key, value);
      if (control.type === "toggle") setting.addToggle(c => c.setValue(Boolean(value)).onChange(changed));
      if (control.type === "slider") setting.addSlider(c => c.setLimits(control.min, control.max, control.step)
        .setValue(Number(value)).onChange(changed));
      if (control.type === "dropdown") setting.addDropdown(c => c.addOptions(control.options)
        .setValue(String(value)).onChange(changed));
    }
  }
}
export class Notice { constructor(message: string) { console.info(message); } }
export class Setting {
  private row: HTMLDivElement;
  private label: HTMLLabelElement;
  constructor(container: HTMLElement) {
    this.row = document.createElement("div");
    this.label = document.createElement("label");
    this.row.append(this.label);
    container.append(this.row);
  }
  setName(name: string) { this.label.textContent = name; return this; }
  setDesc(description: string) { this.row.title = description; return this; }
  setHeading() { this.row.setAttribute("role", "heading"); return this; }
  addToggle(build: (control: Toggle) => void) {
    const input = document.createElement("input");
    input.type = "checkbox";
    input.setAttribute("aria-label", this.label.textContent ?? "");
    this.row.append(input);
    build(new Toggle(input));
    return this;
  }
  addDropdown(build: (control: Dropdown) => void) {
    const input = document.createElement("select");
    input.setAttribute("aria-label", this.label.textContent ?? "");
    this.row.append(input);
    build(new Dropdown(input));
    return this;
  }
  addSlider(build: (control: Slider) => void) {
    const input = document.createElement("input");
    input.type = "range";
    input.setAttribute("aria-label", this.label.textContent ?? "");
    this.row.append(input);
    build(new Slider(input));
    return this;
  }
}
class Dropdown {
  constructor(private input: HTMLSelectElement) {}
  addOption(value: string, label: string) { this.input.add(new Option(label, value)); return this; }
  addOptions(options: Record<string, string>) { Object.entries(options).forEach(([value, label]) => this.addOption(value, label)); return this; }
  setValue(value: string) { this.input.value = value; return this; }
  onChange(callback: (value: string) => Promise<void>) { this.input.onchange = () => { void callback(this.input.value); }; return this; }
}
class Slider {
  constructor(private input: HTMLInputElement) {}
  setLimits(min: number, max: number, step: number) { Object.assign(this.input, { min, max, step }); return this; }
  setValue(value: number) { this.input.value = String(value); return this; }
  setDynamicTooltip() { return this; }
  onChange(callback: (value: number) => Promise<void>) { this.input.oninput = () => { void callback(Number(this.input.value)); }; return this; }
}

class Toggle {
  constructor(private input: HTMLInputElement) {}
  setValue(value: boolean) { this.input.checked = value; return this; }
  onChange(callback: (value: boolean) => Promise<void>) { this.input.onchange = () => { void callback(this.input.checked); }; return this; }
}
