import type { EditorState } from "@codemirror/state";
import type { Tree } from "@lezer/common";

export interface MermaidFence { from: number; to: number; source: string }

/** Read fence boundaries from the host's public syntax tree, never from DOM.
 * Lezer Markdown uses FencedCode/CodeMark. Obsidian's stream grammar exposes
 * HyperMD-codeblock-begin/end tokens instead. Unknown or partial trees, open
 * fences and container-prefixed fences are left to the host (fail closed).
 */
export function mermaidFences(state: EditorState, tree: Tree): MermaidFence[] {
  const blocks: MermaidFence[] = [];
  let opening: number | null = null;
  const add = (from: number, to: number) => {
    const first = state.doc.lineAt(from), last = state.doc.lineAt(to);
    if (last.number <= first.number) return;
    const match = /^ {0,3}(`{3,}|~{3,})[\t ]*mermaid[\t ]*$/.exec(first.text);
    if (!match?.[1]) return;
    const closing = /^ {0,3}(`{3,}|~{3,})[\t ]*$/.exec(last.text)?.[1];
    if (!closing || closing[0] !== match[1][0] || closing.length < match[1].length) return;
    blocks.push({ from: first.from, to: last.to,
      source: state.sliceDoc(first.to + 1, Math.max(first.to + 1, last.from - 1)) });
  };
  tree.iterate({ enter(node) {
    if (node.name === "FencedCode") {
      const marks = node.node.getChildren("CodeMark");
      if (marks.length === 2) add(marks[0]!.from, marks[1]!.from);
      return false;
    }
    if (node.name.includes("HyperMD-codeblock-begin")) opening = state.doc.lineAt(node.from).from;
    if (node.name.includes("HyperMD-codeblock-end") && opening !== null) {
      add(opening, node.from);
      opening = null;
    }
  } });
  return blocks;
}

/** Include every selection, spanning selections, and the fence lines. */
export function selectionTouchesFence(state: EditorState, block: MermaidFence): boolean {
  return state.selection.ranges.some((range) => range.from <= block.to && range.to >= block.from);
}
