import { syntaxTree } from "@codemirror/language";
import { Prec, StateEffect, StateField, type EditorState, type Extension } from "@codemirror/state";
import { Decoration, EditorView, ViewPlugin, WidgetType, type DecorationSet } from "@codemirror/view";
import type { PluginSettings } from "../types";
import { resolveTheme, type ResolvedTheme } from "../appearance/resolveTheme";
import { mermaidFences, selectionTouchesFence } from "./fences";

interface MountedDiagram { dispose(): void }
interface Options {
  isLivePreview(state: EditorState): boolean;
  settings(): PluginSettings;
  mount(source: string, container: HTMLElement, appearance: ResolvedTheme): MountedDiagram;
}

// CM6 may retain DOM when eq() succeeds but adopt the new WidgetType instance.
// DOM ownership must survive that replacement, and may span multiple instances.
interface WidgetMount { disposed: boolean; mount: MountedDiagram | null }
const widgetMounts = new WeakMap<HTMLElement, WidgetMount>();

class DiagramWidget extends WidgetType {
  constructor(private readonly source: string, private readonly height: number,
    private readonly options: Options) { super(); }

  eq(other: DiagramWidget): boolean { return this.source === other.source && this.height === other.height; }
  get estimatedHeight(): number { return this.height; }
  toDOM(view: EditorView): HTMLElement {
    // Obsidian helper on an owner-document fragment keeps CM6 toDOM detached
    // without touching the editor or live body before its measurement phase.
    const container = view.dom.ownerDocument.createDocumentFragment().createDiv();
    container.remove();
    container.className = "mermaid-excalidraw-container mermaid-excalidraw-editor";
    container.setAttribute("aria-label", "Mermaid diagram in Excalidraw view mode");
    container.style.height = `${this.height}px`;
    const ownership: WidgetMount = { disposed: false, mount: null };
    widgetMounts.set(container, ownership);
    // toDOM runs before attachment. Resolve inherited pane CSS only after CM6
    // has installed the widget, in its public DOM-read measurement phase.
    // Starting the Root in the write phase keeps read/write work separate.
    view.requestMeasure({
      key: container,
      read: () => ownership.disposed || !container.isConnected ? null
        : resolveTheme(container, this.options.settings().themeMode),
      write: (appearance) => {
        if (appearance && !ownership.disposed && container.isConnected) {
          ownership.mount = this.options.mount(this.source, container, appearance);
        }
      },
    });
    return container;
  }
  destroy(container: HTMLElement): void {
    const ownership = widgetMounts.get(container);
    if (ownership) { ownership.disposed = true; ownership.mount?.dispose(); }
    widgetMounts.delete(container);
  }
  // Pan/zoom belong to the view-only canvas; the editor owns source editing.
  ignoreEvent(): boolean { return true; }
}

/** StateField supplies block replacements directly, before viewport layout.
 * The view plugin only tracks open views for settings and composition events;
 * it never provides decorations or mutates the editor document or selection.
 */
export class LivePreview {
  readonly extension: Extension;
  private readonly views = new Set<EditorView>();
  private readonly refresh = StateEffect.define<void>();
  private disposed = false;

  constructor(options: Options) {
    const views = this.views;
    const active = () => !this.disposed;
    const composition = StateEffect.define<boolean>();
    const composing = StateField.define<boolean>({
      create: () => false,
      update: (value, tr) => tr.effects.reduce((current, effect) => effect.is(composition) ? effect.value : current, value),
    });
    const build = (state: EditorState, blocks: ReturnType<typeof mermaidFences>): DecorationSet => {
      const settings = options.settings();
      if (!active() || !settings.renderStandardMermaid || !options.isLivePreview(state) || state.field(composing)) {
        return Decoration.none;
      }
      return Decoration.set(blocks.filter((block) => !selectionTouchesFence(state, block)).map((block) =>
        // Block replacements use CM6's default inclusive start. With
        // non-inclusive starts an overlapping inclusive host widget wins before
        // facet precedence is considered. Include the closing line break too,
        // so a host replacement cannot survive as a one-character tail. Keep
        // the end non-inclusive so the next line can draw its own caret/text.
        Decoration.replace({ block: true, inclusiveEnd: false,
          widget: new DiagramWidget(block.source, settings.canvasHeight, options),
        }).range(block.from, Math.min(state.doc.length, block.to + 1))), true);
    };
    const field = StateField.define({
      create(state) {
        const tree = syntaxTree(state), blocks = mermaidFences(state, tree);
        const decorations = build(state, blocks);
        return { tree, blocks, decorations };
      },
      update(value, tr) {
        const tree = syntaxTree(tr.state);
        const changed = tr.docChanged || tree !== value.tree;
        const blocks = changed ? mermaidFences(tr.state, tree) : value.blocks;
        if (!changed && !tr.selection && !tr.reconfigured && !tr.effects.length) return value;
        const decorations = build(tr.state, blocks);
        return { tree, blocks, decorations };
      },
      // Highest precedence replaces only our ranges, so lower-precedence host
      // widgets in these ranges do not materialize. OFF yields an empty set.
      provide: (value) => Prec.highest(EditorView.decorations.from(value, (state) => state.decorations)),
    });
    this.extension = [composing, field, ViewPlugin.define((view) => {
      views.add(view);
      return { destroy() { views.delete(view); } };
    }), EditorView.domEventHandlers({
      compositionstart(_event, view) { view.dispatch({ effects: composition.of(true) }); },
      compositionend(_event, view) {
        // Let CM6 finish handling the event first; never dispatch to an old view.
        queueMicrotask(() => {
          if (!!active() && views.has(view)) view.dispatch({ effects: composition.of(false) });
        });
      },
    })];
  }

  updateSettings(): void {
    if (!this.disposed) for (const view of this.views) view.dispatch({ effects: this.refresh.of() });
  }
  dispose(): void {
    this.disposed = true;
    // Normal Plugin unload removes the extension. Clear any still-registered
    // views as well, to abort pending mounts before the renderer is disposed.
    for (const view of this.views) view.dispatch({ effects: this.refresh.of() });
    this.views.clear();
  }
}
