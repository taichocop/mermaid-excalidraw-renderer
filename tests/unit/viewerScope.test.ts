import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { Scope } from "obsidian";
import { installViewOnlyBoundary } from "../../src/renderer/viewOnlyBoundary";

// Small focus-event fixture: the browser suite separately exercises real DOM,
// prior host capture and the production bundle. No real app/window exists here.
class FixtureNode {
  readonly children = new Set<FixtureNode>();
  constructor(readonly ownerDocument: FixtureDocument) {}
  contains(node: FixtureNode) { return this === node || this.children.has(node); }
  instanceOf(type: typeof FixtureNode) { return this instanceof type; }
}
class FixtureDocument extends EventTarget {
  readonly defaultView = new EventTarget();
  activeElement: FixtureNode | null = null;
  active = true;
  hasFocus() { return this.active; }
  focus(next: FixtureNode | null) {
    const previous = this.activeElement;
    this.activeElement = next;
    if (previous) this.emitFocus("focusout", previous, next);
    if (next) this.emitFocus("focusin", next, previous);
  }
  private emitFocus(type: string, target: FixtureNode, relatedTarget: FixtureNode | null) {
    const event = new Event(type);
    Object.defineProperties(event, { target: { value: target }, relatedTarget: { value: relatedTarget } });
    this.dispatchEvent(event);
  }
}
beforeEach(() => vi.stubGlobal("Node", FixtureNode));
afterEach(() => vi.unstubAllGlobals());
const keymap = () => ({ pushScope: vi.fn(), popScope: vi.fn() });
const install = (node: FixtureNode, keys: ReturnType<typeof keymap>) => installViewOnlyBoundary(node as unknown as HTMLElement, keys);

it("keeps one scope across internal focus and restores host keys on null/outside focus", () => {
  const doc = new FixtureDocument(), viewer = new FixtureNode(doc), control = new FixtureNode(doc), outside = new FixtureNode(doc);
  viewer.children.add(control);
  const keys = keymap(), dispose = install(viewer, keys);
  expect(keys.pushScope).not.toHaveBeenCalled();
  doc.focus(viewer); doc.focus(control);
  expect(keys.pushScope).toHaveBeenCalledTimes(1);
  expect(keys.popScope).not.toHaveBeenCalled();
  doc.focus(null);
  expect(keys.popScope).toHaveBeenCalledWith(keys.pushScope.mock.calls[0]![0]);
  doc.focus(viewer); doc.focus(outside);
  expect(keys.pushScope).toHaveBeenCalledTimes(2);
  expect(keys.popScope).toHaveBeenCalledTimes(2);
  dispose(); dispose(); doc.focus(viewer);
  expect(keys.pushScope).toHaveBeenCalledTimes(2);
  expect(keys.popScope).toHaveBeenCalledTimes(2);
});

it("transfers scope between viewers and removes only the disposed viewer's scope", () => {
  const doc = new FixtureDocument(), first = new FixtureNode(doc), second = new FixtureNode(doc), keys = keymap();
  const disposeFirst = install(first, keys), disposeSecond = install(second, keys);
  doc.focus(first); doc.focus(second);
  expect(keys.pushScope).toHaveBeenCalledTimes(2);
  expect(keys.popScope).toHaveBeenCalledExactlyOnceWith(keys.pushScope.mock.calls[0]![0]);
  disposeFirst();
  expect(keys.popScope).toHaveBeenCalledTimes(1);
  disposeSecond();
  expect(keys.popScope).toHaveBeenLastCalledWith(keys.pushScope.mock.calls[1]![0]);
  doc.focus(first); doc.focus(second);
  expect(keys.pushScope).toHaveBeenCalledTimes(2);
});

it("uses the owner window for blur/refocus/pagehide and unregisters it on disposal", () => {
  const doc = new FixtureDocument(), viewer = new FixtureNode(doc), keys = keymap();
  doc.activeElement = viewer; doc.active = false;
  const dispose = install(viewer, keys);
  expect(keys.pushScope).not.toHaveBeenCalled();
  const unrelatedWindow = new EventTarget();
  vi.stubGlobal("window", unrelatedWindow);
  doc.active = true; unrelatedWindow.dispatchEvent(new Event("focus"));
  expect(keys.pushScope).not.toHaveBeenCalled();
  doc.defaultView.dispatchEvent(new Event("focus"));
  expect(keys.pushScope).toHaveBeenCalledTimes(1);
  unrelatedWindow.dispatchEvent(new Event("blur"));
  expect(keys.popScope).not.toHaveBeenCalled();
  doc.defaultView.dispatchEvent(new Event("blur"));
  expect(keys.popScope).toHaveBeenCalledTimes(1);
  doc.defaultView.dispatchEvent(new Event("focus"));
  doc.defaultView.dispatchEvent(new Event("pagehide"));
  expect(keys.popScope).toHaveBeenCalledTimes(2);
  dispose(); doc.defaultView.dispatchEvent(new Event("focus"));
  expect(keys.pushScope).toHaveBeenCalledTimes(2);
});


it("registers Escape on the parentless scope, so an earlier host dispatcher can close the Modal", () => {
  const register = vi.spyOn(Scope.prototype, "register");
  const doc = new FixtureDocument(), viewer = new FixtureNode(doc), keys = keymap();
  const close = vi.fn();
  const dispose = installViewOnlyBoundary(viewer as unknown as HTMLElement, keys, { onEscape: close });
  doc.focus(viewer);
  expect(keys.pushScope).toHaveBeenCalledTimes(1);
  expect(register).toHaveBeenCalledWith(null, "Escape", expect.any(Function));
  const event = new Event("keydown", { cancelable: true }) as KeyboardEvent;
  const handler = register.mock.calls[0]![2];
  expect(handler(event, { key: "Escape", vkey: "Escape", modifiers: "" })).toBe(false);
  expect(event.defaultPrevented).toBe(true);
  expect(close).toHaveBeenCalledTimes(1);
  dispose();
  expect(keys.popScope).toHaveBeenCalledTimes(1);
  register.mockRestore();
});


it("inherits the Modal scope for Tab but shadows app shortcuts and canvas navigation", () => {
  const register = vi.spyOn(Scope.prototype, "register");
  const parent = new Scope(), doc = new FixtureDocument(), viewer = new FixtureNode(doc), keys = keymap();
  const dispose = installViewOnlyBoundary(viewer as unknown as HTMLElement, keys, { parentScope: parent });
  doc.focus(viewer);
  expect(Reflect.get(keys.pushScope.mock.calls[0]![0], "parent")).toBe(parent);
  const handler = register.mock.calls[0]![2];
  const context = { key: "", vkey: "", modifiers: "" };
  const key = (value: string, options = {}) => {
    const event = new Event("keydown", { cancelable: true }) as KeyboardEvent;
    Object.assign(event, { key: value, code: "", ctrlKey: false, metaKey: false, altKey: false, shiftKey: false }, options);
    return event;
  };
  expect(handler(key("Tab"), context)).toBeUndefined();
  expect(handler(key("Tab", { shiftKey: true }), context)).toBeUndefined();
  expect(handler(key("+", { code: "Equal", metaKey: true }), context)).toBe(true);
  for (const value of ["o", "p", "/", "s", "c", "v"]) {
    const event = key(value, { metaKey: true });
    expect(handler(event, context)).toBe(false);
    expect(event.defaultPrevented).toBe(true);
  }
  dispose(); register.mockRestore();
});
