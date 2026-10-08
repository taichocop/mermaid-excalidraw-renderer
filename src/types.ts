export interface PluginSettings {
  renderStandardMermaid: boolean;
  fontSize: number;
  /** Legacy setting, used to migrate installations without canvasHeight. */
  maxHeight: number;
  roughness: import("@excalidraw/excalidraw/element/types").ExcalidrawElement["roughness"];
  canvasHeight: number;
  canvasPadding: number;
  themeMode: ThemeMode;
}

export type DiagramTheme = "light" | "dark";
export type ThemeMode = "follow-obsidian";
