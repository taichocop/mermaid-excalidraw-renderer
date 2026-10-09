import { Scope, type Keymap } from "obsidian";

export type ViewerKeymap = Pick<Keymap, "pushScope" | "popScope">;

/** Only navigation shortcuts enter the embedded editor. Excalidraw 0.18.1
 * handles some export/dialog shortcuts before its viewMode check. */
export function isViewNavigationKey(event: Pick<KeyboardEvent, "key" | "code" | "ctrlKey" | "metaKey" | "altKey" | "shiftKey">): boolean {
  // Match the pinned upstream zoom keyTest by physical code, including shifted
  // and numpad variants (key characters vary with keyboard layout).
  const command = event.ctrlKey || event.metaKey;
  if (["Equal", "NumpadAdd", "Minus", "NumpadSubtract"].includes(event.code)
    && (command || event.shiftKey)) return true;
  if (["Digit0", "Numpad0"].includes(event.code) && (command || event.shiftKey)) return true;
  if (event.altKey || command) return false;
  if (event.shiftKey && ["Digit1", "Digit2", "Digit3"].includes(event.code)) return true;
  return ["Tab", "Escape", " ", "ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End"].includes(event.key);
}

const NAVIGATION_CONTROLS = ".zoom-actions, .scroll-back-to-content";

/** A scoped DOM integration boundary, not a patch of upstream internals or
 * host clipboard/network APIs. Capture precedes upstream document copy handlers
 * even when the native Edit menu targets the document rather than the canvas.
 * The disposer must run on unmount so host editors retain their normal behavior.
 */
export function installViewOnlyBoundary(container: HTMLElement, keymap: ViewerKeymap): () => void {
  const doc = container.ownerDocument;
  const win = doc.defaultView;
  const inside = (target: EventTarget | null): target is Node => {
    const node = target as Node | null;
    return node !== null && typeof node.instanceOf === "function"
      && node.instanceOf(Node) && container.contains(node);
  };
  const focused = () => inside(doc.activeElement);
  // Host keymaps can run before our document capture. A public parentless
  // Scope prevents inherited host commands while focus is in this viewer;
  // navigation still reaches the canvas through the existing DOM allowlist.
  const scope = new Scope();
  let scopeActive = false;
  const releaseScope = () => {
    if (scopeActive) { scopeActive = false; keymap.popScope(scope); }
  };
  const syncScope = () => {
    if (focused() && doc.hasFocus()) {
      if (!scopeActive) { keymap.pushScope(scope); scopeActive = true; }
    } else releaseScope();
  };
  const onFocusOut = (event: FocusEvent) => {
    if (inside(event.target) && !inside(event.relatedTarget)) releaseScope();
  };
  const cancel = (event: Event) => { event.preventDefault(); event.stopImmediatePropagation(); };
  const onClipboard = (event: Event) => {
    if (inside(event.target) || focused()) cancel(event);
  };
  const onKey = (event: KeyboardEvent) => {
    const navigationControl = inside(event.target) && event.target.instanceOf(Element)
      && event.target.closest(NAVIGATION_CONTROLS) && event.key === "Enter";
    if ((inside(event.target) || focused()) && !navigationControl && !isViewNavigationKey(event)) cancel(event);
  };
  const onBlocked = (event: Event) => { if (inside(event.target)) cancel(event); };
  const onInteraction = (event: Event) => {
    if (!inside(event.target)) return;
    // Retain mouse/pen canvas pan/zoom and the public zoom controls. Block the
    // built-in help/library/editor buttons before their handlers, including
    // touch long-press (upstream opens context menus from a timer, not a DOM
    // contextmenu event). Touch editing is outside desktop support.
    const target = event.target;
    if (!target.instanceOf(Element)) return;
    if (event.type === "pointerdown" && (event as PointerEvent).pointerType === "touch") { cancel(event); return; }
    if (!target.matches("canvas") && !target.closest(NAVIGATION_CONTROLS)) cancel(event);
  };
  const listeners: [string, EventListener][] = [
    ...["copy", "cut", "paste"].map(type => [type, onClipboard] as [string, EventListener]),
    ["keydown", onKey as EventListener],
    ...["contextmenu", "dragstart", "dragenter", "dragover", "drop"].map(type => [type, onBlocked] as [string, EventListener]),
    ["pointerdown", onInteraction], ["click", onInteraction], ["dblclick", onBlocked],
  ];
  const capture = { capture: true };
  for (const [type, handler] of listeners) doc.addEventListener(type, handler, capture);
  doc.addEventListener("focusin", syncScope, capture);
  doc.addEventListener("focusout", onFocusOut, capture);
  win?.addEventListener("focus", syncScope);
  win?.addEventListener("blur", releaseScope);
  win?.addEventListener("pagehide", releaseScope);
  syncScope();
  return () => {
    releaseScope();
    doc.removeEventListener("focusin", syncScope, capture);
    doc.removeEventListener("focusout", onFocusOut, capture);
    win?.removeEventListener("focus", syncScope);
    win?.removeEventListener("blur", releaseScope);
    win?.removeEventListener("pagehide", releaseScope);
    for (const [type, handler] of listeners) doc.removeEventListener(type, handler, capture);
  };
}
