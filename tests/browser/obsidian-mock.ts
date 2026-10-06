import type { PluginSettings } from "../../src/types";

export class MarkdownRenderChild {
  private loaded = false;
  constructor(public containerEl: HTMLElement) {}
  load() { if (!this.loaded) { this.loaded = true; this.onload(); } }
  unload() { if (this.loaded) { this.loaded = false; this.onunload(); } }
  onload() {}
  onunload() {}
}

type Processor = (source: string, element: HTMLElement, context: { addChild(child: MarkdownRenderChild): void }) => void;

export class Plugin {
  processors = new Map<string, Processor>();
  events: (() => void)[] = [];
  saved: PluginSettings | null = null;
  settingTab: PluginSettingTab | null = null;
  app = { workspace: { on: (_name: string, callback: () => void) => {
    this.events.push(callback); return callback;
  } } };
  async loadData(): Promise<unknown> { return this.saved; }
  async saveData(data: PluginSettings) { this.saved = data; }
  registerMarkdownCodeBlockProcessor(language: string, processor: Processor) {
    this.processors.set(language, processor);
  }
  registerEvent(_event: unknown) {}
  addSettingTab(tab: PluginSettingTab) { this.settingTab = tab; }
}

export class PluginSettingTab {
  containerEl = Object.assign(document.createElement("aside"), { empty(this: HTMLElement) { this.replaceChildren(); } });
  constructor(_app: unknown, _plugin: unknown) {}
  display() {}
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
