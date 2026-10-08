import {
  parseMermaidToExcalidraw,
  type MermaidConfig,
} from "@excalidraw/mermaid-to-excalidraw";
import type { PluginSettings } from "../types";

export type DiagramData = Awaited<ReturnType<typeof parseMermaidToExcalidraw>>;
export type ConversionResult =
  | { status: "success"; data: DiagramData }
  | { status: "error"; message: string; cause: unknown }
  | { status: "cancelled" };

export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message || error.name;
  if (typeof error === "string") return error;
  return "Unknown diagram rendering error.";
}

// The published wrapper's type exposes only a subset of Mermaid config. Its
// implementation spreads the supplied object into Mermaid's public initialize().
// Structural typing supplies the documented security options without a cast.
interface SecureMermaidConfig extends MermaidConfig {
  securityLevel: "strict";
  secure: string[];
  suppressErrorRendering: boolean;
  themeCSS: string;
}

export function createMermaidConfig(fontSize: number): SecureMermaidConfig {
  return {
    startOnLoad: false,
    themeVariables: { fontSize: `${fontSize}px` },
    securityLevel: "strict",
    secure: ["secure", "securityLevel", "startOnLoad", "maxTextSize", "maxEdges",
      "suppressErrorRendering", "themeCSS", "dompurifyConfig"],
    suppressErrorRendering: true,
    themeCSS: "",
    maxEdges: 500,
    maxTextSize: 50_000,
  };
}

/** Serialize across blocks, and skip work queued by a child that has unloaded. */
export class MermaidConverter {
  private queue: Promise<void> = Promise.resolve();

  constructor(private readonly parse: typeof parseMermaidToExcalidraw = parseMermaidToExcalidraw) {}

  convert(source: string, settings: PluginSettings, signal: AbortSignal): Promise<ConversionResult> {
    const task = this.queue.then(async (): Promise<ConversionResult> => {
      if (signal.aborted) return { status: "cancelled" };
      try {
        if (source.length > 50_000) throw new Error("Diagram exceeds the 50,000 character limit.");
        if (!source.trim()) throw new Error("The Mermaid code block is empty.");
        const data = await this.parse(source, createMermaidConfig(settings.fontSize));
        return signal.aborted ? { status: "cancelled" } : { status: "success", data };
      } catch (cause: unknown) {
        if (signal.aborted) return { status: "cancelled" };
        console.error("[Mermaid Excalidraw Renderer] Conversion failed", cause);
        return { status: "error", message: errorMessage(cause), cause };
      }
    });
    this.queue = task.then(() => undefined, () => undefined);
    return task;
  }
}
