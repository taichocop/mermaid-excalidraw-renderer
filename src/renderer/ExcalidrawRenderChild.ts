import { MarkdownRenderChild } from "obsidian";
import type { DiagramMount } from "./DiagramMount";

/** Reading view keeps its public MarkdownRenderChild ownership and cleanup. */
export class ExcalidrawRenderChild extends MarkdownRenderChild {
  private mount: DiagramMount | null = null;

  constructor(container: HTMLElement, private readonly createMount: () => DiagramMount,
    private readonly onDispose: () => void) { super(container); }

  // Retain test-only scene diagnostics for the Reading view harness.
  get data() { return this.mount?.data ?? null; }

  onload(): void { this.mount = this.createMount(); }
  onunload(): void {
    this.mount?.dispose();
    this.mount = null;
    this.onDispose();
  }
}
