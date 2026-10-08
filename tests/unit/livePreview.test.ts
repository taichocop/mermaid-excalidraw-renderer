import { describe, expect, it, vi } from "vitest";
import { EditorSelection, EditorState, StateEffect, StateField, RangeSet } from "@codemirror/state";
import { Decoration, EditorView } from "@codemirror/view";
import { markdown } from "@codemirror/lang-markdown";
import { ensureSyntaxTree, syntaxTree } from "@codemirror/language";
import { NodeType, Tree } from "@lezer/common";
import { mermaidFences, selectionTouchesFence } from "../../src/editor/fences";
import { LivePreview } from "../../src/editor/LivePreview";
import { DEFAULT_SETTINGS } from "../../src/settings/settings";

const fence = (body = "flowchart LR\nA --> B", language = "mermaid") => `Before\n\n\`\`\`${language}\n${body}\n\`\`\`\n\nAfter`;
function state(doc: string) {
  const state = EditorState.create({ doc, extensions: [markdown(), EditorState.allowMultipleSelections.of(true)] });
  ensureSyntaxTree(state, doc.length, 1000);
  return state;
}
function blocks(doc: string) { const s = state(doc); return mermaidFences(s, syntaxTree(s)); }

describe("public syntax-tree fence discovery", () => {
  it("uses Lezer fence boundaries, preserves fresh source and handles tilde/long fences", () => {
    expect(blocks(fence())).toEqual([{ from: 8, to: 43, source: "flowchart LR\nA --> B" }]);
    expect(blocks("~~~mermaid\npie\n~~~")[0]?.source).toBe("pie");
    expect(blocks("````mermaid\nflowchart LR\n```\n````")[0]?.source).toBe("flowchart LR\n```");
    expect(blocks(fence("sequenceDiagram\nA->>B: Latest"))[0]?.source).toContain("Latest");
  });
  it.each([
    fence("flowchart LR", "mermaid-excalidraw"), fence("pie", "javascript"),
    "```mermaid\npie", "```mermaid\npie\n~~~,", "Inline `mermaid`", 
    "> ```mermaid\n> pie\n> ```", "```text\n```mermaid\npie\n```", "```mermaid extra\npie\n```",
  ])("leaves dedicated, other languages, open/container fences and inline code to the host: %s", (doc) => {
    expect(blocks(doc)).toEqual([]);
  });
  it.each(["``` mermaid", "```  mermaid\t", "~~~\tmermaid"])("accepts valid whitespace before the language: %s", (opening) => {
    const closing = opening.startsWith("~") ? "~~~" : "```";
    expect(blocks(`${opening}\nflowchart LR\nA-->B\n${closing}`)[0]?.source).toBe("flowchart LR\nA-->B");
  });
  it("accepts an empty closed block for the common converter's safe error", () => {
    expect(blocks("```mermaid\n```")[0]?.source).toBe("");
  });
  it("adapts Obsidian stream token trees without scanning arbitrary Markdown", () => {
    const doc = "Before\n```mermaid\nflowchart LR\nA-->B\n```\nAfter";
    const s = EditorState.create({ doc });
    const begin = NodeType.define({ id: 1, name: "HyperMD-codeblock_HyperMD-codeblock-begin" });
    const end = NodeType.define({ id: 2, name: "HyperMD-codeblock_HyperMD-codeblock-end" });
    const tree = new Tree(NodeType.define({ id: 0, name: "Document", top: true }),
      [new Tree(begin, [], [], 3), new Tree(end, [], [], 3)], [7, doc.lastIndexOf("```")], doc.length);
    expect(mermaidFences(s, tree)).toEqual([{ from: 7, to: 40, source: "flowchart LR\nA-->B" }]);
    expect(mermaidFences(s, Tree.empty)).toEqual([]);
    expect(mermaidFences(s, new Tree(tree.type, [tree.children[0]!], [7], 17))).toEqual([]);
  });
  it("uncovers opening/closing fences, reverse/spanning and multiple selections", () => {
    const s = state(fence()), block = mermaidFences(s, syntaxTree(s))[0]!;
    for (const [from, to] of [[block.from, block.from], [block.to, block.to], [0, s.doc.length], [block.to, block.from]]) {
      expect(selectionTouchesFence(s.update({ selection: EditorSelection.single(from!, to!) }).state, block)).toBe(true);
    }
    expect(selectionTouchesFence(s, block)).toBe(false);
    const multiple = s.update({ selection: EditorSelection.create([EditorSelection.cursor(0), EditorSelection.cursor(block.from + 2)]) }).state;
    expect(selectionTouchesFence(multiple, block)).toBe(true);
  });
});

describe("CM6 StateField decorations", () => {
  it("only directly provides replacements in Live Preview, without document/history changes", () => {
    let settings = { ...DEFAULT_SETTINGS };
    const mode = StateEffect.define<boolean>();
    const live = StateField.define({ create: () => true, update: (value, tr) => tr.effects.reduce((v, e) => e.is(mode) ? e.value : v, value) });
    const editor = new LivePreview({ settings: () => settings, isLivePreview: (s) => s.field(live), mount: vi.fn() });
    let s = EditorState.create({ doc: fence(), extensions: [markdown(), live, editor.extension] });
    const decorations = () => s.facet(EditorView.decorations).filter((value) => typeof value !== "function");
    expect(decorations().map((set) => set.size)).toContain(1);
    const original = s.doc.toString();
    s = s.update({ selection: { anchor: 22 } }).state;
    expect(decorations().map((set) => set.size)).toContain(0);
    s = s.update({ selection: { anchor: 0 } }).state;
    expect(decorations().map((set) => set.size)).toContain(1);
    s = s.update({ effects: mode.of(false) }).state;
    expect(decorations().map((set) => set.size)).toContain(0);
    settings = { ...settings, renderStandardMermaid: false };
    s = s.update({ effects: mode.of(true) }).state;
    expect(decorations().map((set) => set.size)).toContain(0);
    expect(s.doc.toString()).toBe(original);
  });
});


it.each([true, false])("inclusive host replacement with trailing newline is fully shadowed (newline=%s)", (newline) => {
  const doc = newline ? fence() : "Before\n\n```mermaid\nflowchart LR\nA-->B\n```";
  const extension = new LivePreview({ settings: () => DEFAULT_SETTINGS, isLivePreview: () => true, mount: vi.fn() });
  const s = EditorState.create({ doc, extensions: [markdown(), extension.extension] });
  const own = s.facet(EditorView.decorations).find((set) => typeof set !== "function")!;
  if (typeof own === "function") throw new Error("Block decorations must be provided directly");
  const block = mermaidFences(s, syntaxTree(s))[0]!;
  const host = Decoration.set([Decoration.replace({ block: true, host: true }).range(block.from, Math.min(doc.length, block.to + 1))]);
  const visible: { from: number; to: number; host: boolean }[] = [];
  RangeSet.spans([own, host], 0, doc.length, {
    span() {},
    point(from, to, value) { visible.push({ from, to, host: value.spec.host === true }); },
  });
  expect(visible).toEqual([{ from: block.from, to: Math.min(doc.length, block.to + 1), host: false }]);
  expect(s.doc.toString()).toBe(doc);
});
