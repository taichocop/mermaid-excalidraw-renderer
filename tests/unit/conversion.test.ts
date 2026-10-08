import { describe, expect, it, vi } from "vitest";

// Unit tests exercise our wrapper, not upstream's DOM-dependent parser.
vi.mock("@excalidraw/mermaid-to-excalidraw", () => ({ parseMermaidToExcalidraw: vi.fn() }));
import { MermaidConverter, createMermaidConfig, errorMessage } from "../../src/renderer/conversion";
import { DEFAULT_SETTINGS } from "../../src/settings/settings";

describe("conversion wrapper", () => {
  it("passes safe config and preserves fallback files", async () => {
    const data = { elements: [], files: {} };
    const parse = vi.fn().mockResolvedValue(data);
    const result = await new MermaidConverter(parse).convert("pie", DEFAULT_SETTINGS, new AbortController().signal);
    expect(result).toEqual({ status: "success", data });
    expect(parse).toHaveBeenCalledWith("pie", expect.objectContaining({
      securityLevel: "strict", suppressErrorRendering: true,
      themeVariables: { fontSize: "20px" },
    }));
    expect(createMermaidConfig(32).secure).toContain("securityLevel");
  });
  it("catches a parse rejection and keeps the queue usable", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const parse = vi.fn().mockRejectedValueOnce(new Error("Parse error on line 2")).mockResolvedValueOnce({ elements: [] });
    const converter = new MermaidConverter(parse);
    expect(await converter.convert("invalid", DEFAULT_SETTINGS, new AbortController().signal))
      .toMatchObject({ status: "error", message: "Parse error on line 2" });
    expect((await converter.convert("valid", DEFAULT_SETTINGS, new AbortController().signal)).status).toBe("success");
    log.mockRestore();
  });
  it("serializes concurrent tasks and skips queued cancelled children", async () => {
    let finish: ((value: { elements: [] }) => void) | undefined;
    const parse = vi.fn().mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    const converter = new MermaidConverter(parse);
    const first = new AbortController();
    const second = new AbortController();
    const pendingFirst = converter.convert("one", DEFAULT_SETTINGS, first.signal);
    const pendingSecond = converter.convert("two", DEFAULT_SETTINGS, second.signal);
    await Promise.resolve();
    expect(parse).toHaveBeenCalledTimes(1);
    first.abort();
    second.abort();
    finish?.({ elements: [] });
    expect(await pendingFirst).toEqual({ status: "cancelled" });
    expect(await pendingSecond).toEqual({ status: "cancelled" });
    expect(parse).toHaveBeenCalledTimes(1);
  });
  it("reports empty and oversized sources before invoking upstream", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const parse = vi.fn();
    const converter = new MermaidConverter(parse);
    expect((await converter.convert("", DEFAULT_SETTINGS, new AbortController().signal)).status).toBe("error");
    expect((await converter.convert("x".repeat(50_001), DEFAULT_SETTINGS, new AbortController().signal)).status).toBe("error");
    expect(parse).not.toHaveBeenCalled();
    expect(errorMessage({ untrusted: "<script>" })).toBe("Unknown diagram rendering error.");
    log.mockRestore();
  });
  it.each([
    'A@{ img: "https://example.invalid/a.png" }',
    'A@{ "img": "/relative.png" }',
    String.raw`A@{ "\u0069mg": "relative.png" }`,
    'A@{ shape: rect, label: "Even benign metadata is refused" }',
    '<img src=relative.png>',
    '<svg><feImage href="relative.png" /></svg>',
    '<video poster="relative.png">',
    '<meta http-equiv="refresh" content="0;URL=relative">',
    '![image](relative.png)',
    'fill:url(relative.png)',
    'fill:image-set("relative.png" 1x)',
    'fill:image("relative.png")',
    '@import "relative.css"',
    String.raw`fill:u\72l(relative.png)`,
    'fill:u/**/rl(relative.png)',
    '#60;img s#114;c=relative.png#62;',
    '&lt;img s&#114;c=relative.png&gt;',
    'ﬂ°lt¶ßimg sﬂ°°114¶ßc=relative.pngﬂ°gt¶ß',
    '//example.invalid/a.png',
    'https:example.invalid/a.png',
    'data:image/svg+xml;base64,PHN2Zy8+',
    'file:relative.png',
    'blob:some-image',
  ])("rejects resource-capable source before calling upstream: %s", async (source) => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const parse = vi.fn().mockResolvedValue({ elements: [] });
    const converter = new MermaidConverter(parse);
    expect(await converter.convert(source, DEFAULT_SETTINGS, new AbortController().signal))
      .toMatchObject({ status: "error", message: expect.stringContaining("Resource-capable Mermaid syntax") });
    expect(parse).not.toHaveBeenCalled();
    // Refusal must not poison later diagrams in the same conversion queue.
    expect((await converter.convert("flowchart LR\nA[Safe] --> B[Local]", DEFAULT_SETTINGS, new AbortController().signal)).status).toBe("success");
    expect(parse).toHaveBeenCalledTimes(1);
    log.mockRestore();
  });
});
