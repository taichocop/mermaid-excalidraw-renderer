import { markdown } from "@codemirror/lang-markdown";
import { syntaxTree, forceParsing } from "@codemirror/language";
import { Compartment, EditorState, EditorSelection, StateField, type Extension, type Range } from "@codemirror/state";
import { Decoration, EditorView, WidgetType, keymap } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap, undo, redo } from "@codemirror/commands";
import { editorLivePreviewField, livePreviewMode, MarkdownPreviewRenderer, type MarkdownRenderChild } from "./obsidian-mock";

/** Real CM6 editor, with a small explicit host widget simulation. This is not
 * Obsidian's stream parser, live-preview implementation or IME/native proof. */
export class EditorHarness {
  private readonly editors = new Map<string, { view: EditorView; compartment: Compartment }>();
  hostMounts = 0;
  hostDisposals = 0;

  constructor(private readonly extensions: () => Extension[]) {}

  create(id: string, doc: string, background?: string): void {
    this.destroy(id);
    const countMount = () => this.hostMounts++;
    const countDisposal = () => this.hostDisposals++;
    const hostChildren = new WeakMap<HTMLElement, MarkdownRenderChild[]>();
    class HostWidget extends WidgetType {
      constructor(private readonly source: string, private readonly language: string,
        private readonly processor: ReturnType<typeof MarkdownPreviewRenderer.codeBlockProcessors.get>) { super(); }
      eq(other: HostWidget) { return this.source === other.source && this.language === other.language && this.processor === other.processor; }
      toDOM(view: EditorView) {
        countMount();
        const element = view.dom.ownerDocument.createElement("div");
        const children: MarkdownRenderChild[] = [];
        hostChildren.set(element, children);
        if (this.language === "mermaid") {
          element.className = "host-editor-mermaid";
          element.textContent = `Host Mermaid: ${this.source}`;
        } else {
          element.className = "host-editor-dedicated";
          this.processor?.(this.source, element, {
            addChild(child) { children.push(child); child.load(); },
          });
        }
        return element;
      }
      destroy(element: HTMLElement) {
        countDisposal();
        hostChildren.get(element)?.forEach((child) => child.unload());
        hostChildren.delete(element);
      }
    }
    const host = StateField.define({
      create: (state) => buildHost(state),
      update: (_value, tr) => buildHost(tr.state),
      provide: (field) => EditorView.decorations.from(field),
    });
    function buildHost(state: EditorState) {
      const ranges: Range<Decoration>[] = [];
      if (state.field(editorLivePreviewField)) syntaxTree(state).iterate({ enter(node) {
        if (node.name !== "FencedCode") return;
        const marks = node.node.getChildren("CodeMark"), info = node.node.getChild("CodeInfo");
        if (!info || marks.length !== 2) return false;
        const language = state.sliceDoc(info.from, info.to);
        if (!["mermaid", "mermaid-excalidraw"].includes(language)) return false;
        const processor = MarkdownPreviewRenderer.codeBlockProcessors.get(language);
        // The host has a built-in standard renderer, but no dedicated renderer
        // after the plugin unregisters. Leave unknown languages as source.
        if (language === "mermaid-excalidraw" && !processor) return false;
        if (state.selection.ranges.some((range) => range.from <= node.to && range.to >= node.from)) return false;
        const first = state.doc.lineAt(node.from), last = state.doc.lineAt(marks[1]!.from);
        const source = state.sliceDoc(first.to + 1, last.from - 1);
        ranges.push(Decoration.replace({ block: true, widget: new HostWidget(source, language, processor)
        }).range(first.from, Math.min(state.doc.length, last.to + 1)));
        return false;
      } });
      return Decoration.set(ranges, true);
    }
    const compartment = new Compartment();
    const parent = document.createElement("section");
    parent.id = id;
    if (background) parent.style.setProperty("--background-primary", background);
    document.querySelector("main")!.append(parent);
    const view = new EditorView({ parent, state: EditorState.create({ doc, extensions: [
      markdown(), history(), keymap.of([...defaultKeymap, ...historyKeymap]), EditorState.allowMultipleSelections.of(true), editorLivePreviewField,
      host, compartment.of(this.extensions()),
    ] }) });
    this.editors.set(id, { view, compartment });
    forceParsing(view, doc.length);
  }
  reconfigure(): void {
    for (const { view, compartment } of this.editors.values()) view.dispatch({ effects: compartment.reconfigure(this.extensions()) });
  }
  view(id: string): EditorView {
    const editor = this.editors.get(id);
    if (!editor) throw new Error(`No editor: ${id}`);
    return editor.view;
  }
  select(id: string, ranges: [number, number][]) {
    const view = this.view(id);
    view.dispatch({ selection: EditorSelection.create(ranges.map(([anchor, head]) => EditorSelection.range(anchor, head))) });
  }
  edit(id: string, from: number, to: number, insert: string) {
    this.view(id).dispatch({ changes: { from, to, insert }, userEvent: "input.type" });
  }
  mode(id: string, live: boolean) { this.view(id).dispatch({ effects: livePreviewMode.of(live) }); }
  undo(id: string) { return undo(this.view(id)); }
  redo(id: string) { return redo(this.view(id)); }
  composition(id: string, start: boolean) {
    this.view(id).contentDOM.dispatchEvent(new CompositionEvent(start ? "compositionstart" : "compositionend", { bubbles: true }));
  }
  snapshot(id: string) {
    const view = this.view(id);
    return { doc: view.state.doc.toString(), ranges: view.state.selection.ranges.map(({ anchor, head }) => ({ anchor, head })),
      live: view.state.field(editorLivePreviewField) };
  }
  destroy(id: string) {
    this.editors.get(id)?.view.destroy();
    this.editors.delete(id);
    document.getElementById(id)?.remove();
  }
}
