import { expect, it, vi } from "vitest";
import type { ReactElement } from "react";
import type { DiagramData, ConversionResult } from "../../src/renderer/conversion";
const mocks = vi.hoisted(() => ({ render: vi.fn(), unmount: vi.fn() }));
vi.mock("react-dom/client", () => ({ createRoot: () => mocks }));
vi.mock("../../src/renderer/ExcalidrawView", () => ({
  DiagramErrorBoundary: () => null, ExcalidrawView: () => null, InlineError: () => null,
}));
vi.mock("../../src/appearance/resolveTheme", () => ({ resolveTheme: () => ({ theme: "light", background: "white", foreground: "#000000" }) }));
vi.mock("@excalidraw/mermaid-to-excalidraw", () => ({ parseMermaidToExcalidraw: vi.fn() }));
import { MermaidConverter } from "../../src/renderer/conversion";
import { DiagramMount } from "../../src/renderer/DiagramMount";
import { DEFAULT_SETTINGS } from "../../src/settings/settings";

it("discards out-of-order results even from a converter that ignores cancellation and disposes exactly once", async () => {
  const pending: { signal: AbortSignal; resolve: (result: ConversionResult) => void }[] = [];
  const converter = new MermaidConverter();
  vi.spyOn(converter, "convert").mockImplementation((_source, _settings, signal) => new Promise((resolve) => pending.push({ signal, resolve })));
  const container = { style: {}, dataset: {} } as HTMLElement;
  const cleanup = vi.fn();
  const mount = new DiagramMount(container, "flowchart LR\nA-->B", DEFAULT_SETTINGS,
    { theme: "light", background: "white", foreground: "#000000" }, converter, cleanup);
  mocks.render.mockClear(); mocks.unmount.mockClear();
  mount.load();
  mount.updateSettings({ ...DEFAULT_SETTINGS, fontSize: 24 });
  expect(pending[0]!.signal.aborted).toBe(true);
  const current: DiagramData = { elements: [] };
  pending[1]!.resolve({ status: "success", data: current });
  await Promise.resolve();
  expect(mount.data).toBe(current);
  const rendered = mocks.render.mock.calls.length;
  pending[0]!.resolve({ status: "error", message: "Old failure", cause: null });
  await Promise.resolve();
  expect(mocks.render.mock.calls).toHaveLength(rendered);
  mount.updateSettings({ ...DEFAULT_SETTINGS, fontSize: 28 });
  mount.dispose(); mount.dispose();
  expect(pending[2]!.signal.aborted).toBe(true);
  const before = mocks.render.mock.calls.length;
  pending[2]!.resolve({ status: "success", data: current });
  await Promise.resolve();
  expect(mocks.render.mock.calls).toHaveLength(before);
  expect(mocks.unmount).toHaveBeenCalledTimes(1);
  expect(cleanup).toHaveBeenCalledTimes(1);
  expect(mount.data).toBeNull();
});

it("passes errors as React text props and keeps adjacent sessions independent", async () => {
  const converter = new MermaidConverter();
  vi.spyOn(converter, "convert").mockResolvedValueOnce({ status: "error", message: "<img src=x>", cause: null })
    .mockResolvedValueOnce({ status: "success", data: { elements: [] } });
  const make = () => new DiagramMount({ style: {}, dataset: {} } as HTMLElement, "invalid", DEFAULT_SETTINGS,
    { theme: "light", background: "white", foreground: "#000000" }, converter, vi.fn());
  const bad = make(), good = make();
  mocks.render.mockClear();
  bad.load(); good.load();
  await Promise.resolve();
  const rendered = mocks.render.mock.calls.map(([element]) => (element as ReactElement<{ children: ReactElement<{ message?: string }> }>).props.children.props);
  expect(rendered.some((props) => props.message === "<img src=x>")).toBe(true);
  expect(bad.containerEl.dataset.state).toBe("error");
  expect(good.containerEl.dataset.state).toBe("ready");
  bad.dispose(); good.dispose();
});
