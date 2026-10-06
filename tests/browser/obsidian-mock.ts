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
  app = { workspace: { on: (_name: string, callback: () => void) => {
    this.events.push(callback); return callback;
  } } };
  async loadData(): Promise<unknown> { return this.saved; }
  async saveData(data: PluginSettings) { this.saved = data; }
  registerMarkdownCodeBlockProcessor(language: string, processor: Processor) {
    this.processors.set(language, processor);
  }
  registerEvent(_event: unknown) {}
  addSettingTab(_tab: unknown) {}
}

export class PluginSettingTab { constructor(_app: unknown, _plugin: unknown) {} }
export class Notice { constructor(message: string) { console.info(message); } }
export class Setting {}
