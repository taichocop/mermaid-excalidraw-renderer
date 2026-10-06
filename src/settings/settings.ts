import type { PluginSettings } from "../types";

export const DEFAULT_SETTINGS: Readonly<PluginSettings> = {
  fontSize: 20,
  maxHeight: 600,
};

export const FONT_SIZE_RANGE = { min: 12, max: 48 } as const;
export const HEIGHT_RANGE = { min: 200, max: 1200 } as const;

function boundedInteger(value: unknown, fallback: number, min: number, max: number): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.min(max, Math.max(min, Math.round(value)))
    : fallback;
}

export function validateSettings(data: unknown): PluginSettings {
  const values = typeof data === "object" && data !== null ? data : {};
  return {
    fontSize: boundedInteger("fontSize" in values ? values.fontSize : undefined,
      DEFAULT_SETTINGS.fontSize, FONT_SIZE_RANGE.min, FONT_SIZE_RANGE.max),
    maxHeight: boundedInteger("maxHeight" in values ? values.maxHeight : undefined,
      DEFAULT_SETTINGS.maxHeight, HEIGHT_RANGE.min, HEIGHT_RANGE.max),
  };
}
