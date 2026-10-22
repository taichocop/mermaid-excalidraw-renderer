export type PanBy = (deltaX: number, deltaY: number) => void;

/** Excalidraw 0.18.1 listens for pan movement on its importing window, which
 * is not necessarily an adopted canvas's owner window. Own the enlarged
 * viewer gesture through public DOM capture and a public scene-API callback.
 */
export function installCanvasPan(container: HTMLElement,
  start: (canvas: Element) => PanBy | undefined): () => void {
  const win = container.ownerDocument.defaultView;
  if (!win) return () => {};
  let gesture: { id: number; canvas: HTMLElement; x: number; y: number;
    cursor: { value: string; priority: string }; panBy: PanBy } | undefined;
  const cancel = (event: Event) => { event.preventDefault(); event.stopImmediatePropagation(); };
  const finish = () => {
    const current = gesture;
    if (!current) return;
    gesture = undefined;
    win.removeEventListener("pointermove", move, true);
    win.removeEventListener("pointerup", end, true);
    win.removeEventListener("pointercancel", end, true);
    win.removeEventListener("lostpointercapture", end, true);
    win.removeEventListener("blur", finish);
    win.removeEventListener("pagehide", finish);
    // Restore only the temporary declaration we still own. Upstream may have
    // changed the cursor since the gesture began; keep that newer state.
    const style = current.canvas.style;
    if (style.getPropertyValue("cursor") === "grabbing" && style.getPropertyPriority("cursor") === "") {
      // setCssProps has no priority argument. CSSOM preserves a pre-existing
      // priority (or removes an originally absent declaration) without adding one.
      style.setProperty("cursor", current.cursor.value, current.cursor.priority);
    }
    try { current.canvas.releasePointerCapture(current.id); } catch { /* Already released/removed. */ }
  };
  const move = (event: PointerEvent) => {
    if (!gesture || event.pointerId !== gesture.id) return;
    cancel(event);
    if (!event.buttons) { finish(); return; }
    if (!Number.isFinite(event.clientX) || !Number.isFinite(event.clientY)) return;
    const dx = event.clientX - gesture.x, dy = event.clientY - gesture.y;
    gesture.x = event.clientX; gesture.y = event.clientY;
    gesture.panBy(dx, dy);
  };
  const end = (event: PointerEvent) => {
    if (!gesture || event.pointerId !== gesture.id) return;
    cancel(event);
    finish();
  };
  const canvasTarget = (event: PointerEvent) => {
    const target = event.target as Element | null;
    return target?.matches?.("canvas") && target.closest(".mermaid-excalidraw-canvas") ? target : undefined;
  };
  const pairedUp = (event: PointerEvent) => {
    // Rejected buttons and not-ready starts also consumed their down event.
    // Upstream's link handler assumes a preceding down; keep the pair owned.
    if (canvasTarget(event)) cancel(event);
  };
  const down = (event: PointerEvent) => {
    const canvas = canvasTarget(event);
    if (!["mouse", "pen"].includes(event.pointerType) || !canvas) return;
    // Even a not-yet-ready scene must not start an upstream window-global pan.
    cancel(event);
    if (gesture || !event.isPrimary || (event.button !== 0 && event.button !== 1)
      || !Number.isFinite(event.clientX) || !Number.isFinite(event.clientY)) return;
    const panBy = start(canvas);
    if (!panBy) return;
    const element = canvas as HTMLElement;
    gesture = { id: event.pointerId, canvas: element, x: event.clientX, y: event.clientY,
      cursor: { value: element.style.getPropertyValue("cursor"), priority: element.style.getPropertyPriority("cursor") }, panBy };
    // Ordinary class rules cannot override Excalidraw's inline canvas cursor.
    // Use the public Obsidian helper on this canvas only, without !important.
    element.setCssProps({ cursor: "grabbing" });
    (canvas.closest<HTMLElement>(".excalidraw[tabindex]") ?? container).focus({ preventScroll: true });
    win.addEventListener("pointermove", move, { capture: true, passive: false });
    win.addEventListener("pointerup", end, true);
    win.addEventListener("pointercancel", end, true);
    win.addEventListener("lostpointercapture", end, true);
    win.addEventListener("blur", finish);
    win.addEventListener("pagehide", finish);
    try { canvas.setPointerCapture(event.pointerId); } catch { /* Synthetic input may not be active. */ }
  };
  container.addEventListener("pointerdown", down, { capture: true, passive: false });
  container.addEventListener("pointerup", pairedUp, { capture: true, passive: false });
  return () => {
    finish();
    container.removeEventListener("pointerdown", down, true);
    container.removeEventListener("pointerup", pairedUp, true);
  };
}
