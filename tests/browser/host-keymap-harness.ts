import type { Plugin } from "./obsidian-mock";
import type { EditorHarness } from "./editor-harness";

/** Disposable host commands, not Obsidian emulation or native acceptance.
 * Install before viewer mount to reproduce the native prior-capture failure. */
export class HostKeymapHarness {
  private effects: string[] = [];
  private cleanup: (() => void) | null = null;
  constructor(private readonly app: () => Plugin["app"], private readonly editors: EditorHarness) {}

  install(phase: "window" | "document", editor: string): void {
    this.cleanup?.();
    this.effects = [];
    const target = phase === "window" ? window : document;
    const onKey = (event: KeyboardEvent) => {
      if ((!event.metaKey && !event.ctrlKey) || !this.app().keymap.reachesHost(this.app().scope)) return;
      if (event.code === "KeyO") {
        this.effects.push("quickswitcher");
        const input = document.createElement("input");
        input.className = "prompt-input";
        document.body.append(input); input.focus();
      } else if (event.code === "Slash") {
        this.effects.push("comment");
        const { anchor, head } = this.editors.snapshot(editor).ranges[0]!;
        const from = Math.min(anchor, head), to = Math.max(anchor, head);
        const selected = this.editors.view(editor).state.sliceDoc(from, to);
        this.editors.edit(editor, from, to, `%%${selected}%%`);
        this.editors.select(editor, [[from + 2, to + 2]]);
      } else if (event.code === "KeyP") {
        this.effects.push("command-palette");
        const modal = document.createElement("div");
        modal.className = "modal-container";
        modal.setAttribute("role", "dialog");
        document.body.append(modal);
      }
    };
    target.addEventListener("keydown", onKey as EventListener, true);
    this.cleanup = () => target.removeEventListener("keydown", onKey as EventListener, true);
  }
  snapshot() { return { effects: [...this.effects], scopeDepth: this.app().keymap.scopes.length }; }
  clearPrompts() { document.querySelectorAll(".prompt-input, .modal-container").forEach(node => node.remove()); }
}
