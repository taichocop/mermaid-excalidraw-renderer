import type { DiagramTheme, ThemeMode } from "../types";

export interface ResolvedTheme {
  theme: DiagramTheme;
  background: string;
  foreground: "#000000" | "#ffffff";
}

export function determineTheme(classList: Pick<DOMTokenList, "contains">): DiagramTheme {
  return classList.contains("theme-dark") ? "dark" : "light";
}

/** Compare the contrast of black and white against an opaque sRGB background. */
export function contrastingForeground(rgb: readonly [number, number, number]): ResolvedTheme["foreground"] {
  const linear = rgb.map((channel) => {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  const luminance = 0.2126 * linear[0]! + 0.7152 * linear[1]! + 0.0722 * linear[2]!;
  return (luminance + 0.05) / 0.05 >= 1.05 / (luminance + 0.05) ? "#000000" : "#ffffff";
}

export function resolveTheme(container: HTMLElement, mode: ThemeMode): ResolvedTheme {
  // Keep the mode explicit so fixed light/dark modes can be added here later.
  const theme = mode === "follow-obsidian" ? determineTheme(container.ownerDocument.body.classList) : "light";
  const fallback = theme === "dark" ? "#1e1e1e" : "#ffffff";
  const win = container.ownerDocument.defaultView;
  const canvas = container.ownerDocument.createElement("canvas");
  canvas.width = canvas.height = 1;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!win || !context) return { theme, background: fallback, foreground: theme === "dark" ? "#ffffff" : "#000000" };

  // The container's CSS uses --background-primary. Canvas resolves computed CSS
  // colors (including modern color syntax) and composites alpha onto the fallback.
  context.fillStyle = fallback;
  context.fillRect(0, 0, 1, 1);
  context.fillStyle = win.getComputedStyle(container).backgroundColor;
  context.fillRect(0, 0, 1, 1);
  const [r = 0, g = 0, b = 0] = context.getImageData(0, 0, 1, 1).data;
  return { theme, background: `rgb(${r}, ${g}, ${b})`, foreground: contrastingForeground([r, g, b]) };
}
