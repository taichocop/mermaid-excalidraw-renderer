import { newElementWith } from "@excalidraw/excalidraw";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import type { PluginSettings } from "../types";
import type { ResolvedTheme } from "./resolveTheme";

/** 0.18.1's readonly base has roughness, strokeColor and backgroundColor on every
 * type. Image pixels are handled separately. The public newElementWith helper
 * also invalidates cached shapes when their appearance changes.
 */
export function applyAppearance(
  elements: readonly ExcalidrawElement[], settings: Pick<PluginSettings, "roughness">, colors: ResolvedTheme,
): ExcalidrawElement[] {
  return elements.map((element) => {
    switch (element.type) {
      case "rectangle":
      case "ellipse":
      case "diamond":
        return newElementWith(element, {
          roughness: settings.roughness, strokeColor: colors.foreground,
          backgroundColor: colors.background, fillStyle: "solid", opacity: 100,
        });
      default:
        return newElementWith(element, {
          roughness: settings.roughness, strokeColor: colors.foreground,
          backgroundColor: "transparent", opacity: 100,
        });
    }
  });
}
