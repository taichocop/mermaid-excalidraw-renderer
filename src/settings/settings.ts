import type { PluginSettings } from "../types";

export const DEFAULT_SETTINGS: Readonly<PluginSettings> = {
  renderStandardMermaid: true,
  fontSize: 20,
  maxHeight: 600,
  roughness: 1,
  canvasHeight: 600,
  canvasPadding: 32,
  themeMode: "follow-obsidian",
};

export const FONT_SIZE_RANGE = { min: 12, max: 48 } as const;
export const HEIGHT_RANGE = { min: 200, max: 1200 } as const;
export const CANVAS_HEIGHT_RANGE = { min: 240, max: 1200 } as const;
export const CANVAS_PADDING_RANGE = { min: 16, max: 128 } as const;
// 0.18.1 declares roughness as number; its shipped UI uses these three values.
export const ROUGHNESS_OPTIONS = [0, 1, 2] as const;

function boundedInteger(value: unknown, fallback: number, min: number, max: number): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.min(max, Math.max(min, Math.round(value)))
    : fallback;
}

export function validateSettings(data: unknown): PluginSettings {
  const values = typeof data === "object" && data !== null ? data : {};
  const legacyHeight = "maxHeight" in values ? values.maxHeight : undefined;
  const roughness = "roughness" in values ? values.roughness : undefined;
  const renderStandardMermaid = "renderStandardMermaid" in values ? values.renderStandardMermaid : undefined;
  return {
    renderStandardMermaid: typeof renderStandardMermaid === "boolean"
      ? renderStandardMermaid : DEFAULT_SETTINGS.renderStandardMermaid,
    fontSize: boundedInteger("fontSize" in values ? values.fontSize : undefined,
      DEFAULT_SETTINGS.fontSize, FONT_SIZE_RANGE.min, FONT_SIZE_RANGE.max),
    maxHeight: boundedInteger("maxHeight" in values ? values.maxHeight : undefined,
      DEFAULT_SETTINGS.maxHeight, HEIGHT_RANGE.min, HEIGHT_RANGE.max),
    roughness: typeof roughness === "number" && ROUGHNESS_OPTIONS.some((value) => value === roughness)
      ? roughness : DEFAULT_SETTINGS.roughness,
    canvasHeight: boundedInteger("canvasHeight" in values ? values.canvasHeight : legacyHeight,
      DEFAULT_SETTINGS.canvasHeight, CANVAS_HEIGHT_RANGE.min, CANVAS_HEIGHT_RANGE.max),
    canvasPadding: boundedInteger("canvasPadding" in values ? values.canvasPadding : undefined,
      DEFAULT_SETTINGS.canvasPadding, CANVAS_PADDING_RANGE.min, CANVAS_PADDING_RANGE.max),
    themeMode: DEFAULT_SETTINGS.themeMode,
  };
}
