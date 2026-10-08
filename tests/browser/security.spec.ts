import { expect, test } from "@playwright/test";

test("diagram config cannot inject host CSS, change security or bypass input limits", async ({ page }) => {
  const requests: string[] = [];
  await page.route(/^https?:\/\/(?!127\.0\.0\.1)/, (route) => {
    requests.push(route.request().url());
    return route.abort();
  });
  await page.goto("/");
  await page.evaluate(() => window.ready);
  const before = await page.locator("body").evaluate((body) => getComputedStyle(body).backgroundColor);
  await page.evaluate(() => window.harness.mount(`---
config:
  securityLevel: loose
  themeCSS: "body { background: magenta !important; }"
  dompurifyConfig:
    ADD_TAGS: [script]
---
flowchart LR
  A["<b onmouseover='window.pwned=1'>Safe</b>"] --> B[safe]`));
  await expect(page.locator('[data-state="ready"]')).toHaveCount(1);
  expect(await page.evaluate(() => "pwned" in window)).toBe(false);
  expect(await page.locator("body").evaluate((body) => getComputedStyle(body).backgroundColor)).toBe(before);
  expect(requests).toEqual([]);
  await page.evaluate(() => window.harness.mount(`%%{init: {"maxTextSize": 999999}}%%\n${"x".repeat(50_001)}`));
  await expect(page.locator('[data-state="error"]')).toHaveCount(1);
  await expect(page.locator(".mermaid-excalidraw-error-detail")).toContainText("50,000 character limit");
  await page.evaluate(() => window.harness.mount(`%%{init: {"maxEdges": 999999}}%%\nflowchart LR\n${Array.from({ length: 501 }, (_, i) => `A${i} --> A${i + 1}`).join("\n")}`));
  await expect(page.locator('[data-state="error"]')).toHaveCount(2);
  await expect(page.locator(".mermaid-excalidraw-error-detail").last()).toContainText("500");
});

test("standard and dedicated blocks reject resource syntax before any network request", async ({ page }) => {
  const requests: string[] = [];
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await page.evaluate(() => window.ready);
  // Intercept every request after boot, including same-origin relative images.
  await page.route("**/*", (route) => {
    requests.push(route.request().url());
    return route.fulfill({ contentType: "image/png", body: Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aWZ8AAAAASUVORK5CYII=", "base64") });
  });
  const sources = [
    'sequenceDiagram\nparticipant A\nproperties A: {"icon": "/relative-image.png"}\nA->>A: Safe',
    'sequenceDiagram\nparticipant A\nproperties A: {"icon": "relative-image.png"}\nA->>A: Safe',
    'sequenceDiagram;participant A;PrOpErTiEs A: {"icon": "/relative-image.png"}',
    'sequenceDiagram\nparticipant A\ndetails A: sequence-resource-metadata\nA->>A: Safe',
    'flowchart LR\nA@{ img: "https://security-test.invalid/image.png", label: "Remote", h: 40 } --> B[Local]',
    'flowchart LR\nA@{ img: "//security-test.invalid/image.png" }',
    'flowchart LR\nA@{ img: "/relative-image.png" }',
    'flowchart LR\nA@{ "img": "data:image/svg+xml;base64,PHN2Zy8+" }',
    String.raw`flowchart LR
A@{ "\u0069mg": "\u0068ttps://security-test.invalid/image.png" }`,
    'flowchart LR\nA["<img src=/relative-image.png>"]',
    'flowchart LR\nA["<svg><image href=/relative-image.png /></svg>"]',
    'flowchart LR\nA["![Remote](/relative-image.png)"]',
    'flowchart LR\nA["#60;img src=/relative-image.png#62;"]',
    'flowchart LR\nA["&lt;img src=/relative-image.png&gt;"]',
    'flowchart LR\nA["ﬂ°lt¶ßimg sﬂ°°114¶ßc=/relative-image.pngﬂ°gt¶ß"]',
    'flowchart LR\nA[Local]\nstyle A fill:url(/relative-image.png)',
    'flowchart LR\nA[Local]\nclassDef net fill:image-set("/relative-image.png" 1x)',
    'flowchart LR\nA[Local]\nstyle A fill:u/**/rl(/relative-image.png)',
    String.raw`flowchart LR
A[Local]
classDef net fill:u\72l(/relative-image.png)`,
    '---\nconfig:\n  themeVariables:\n    fontFamily: "Arial; background-image: url(/relative-image.png)"\n---\nflowchart LR\nA[Local]',
    '%%{init: {"themeCSS":"@import \'/relative-style.css\';"}}%%\nflowchart LR\nA[Local]',
  ];
  await page.evaluate(() => {
    // Upstream details imports actor properties from a host DOM element.
    const metadata = document.createElement("div");
    metadata.id = "sequence-resource-metadata";
    metadata.textContent = JSON.stringify({ properties: { icon: "/relative-image.png" } });
    document.body.append(metadata);
  });
  for (const language of ["mermaid", "mermaid-excalidraw"]) {
    await page.evaluate(({ sources, language }) => {
      for (const source of sources) window.harness.mount(source, language);
      window.harness.mountSamples(["flowchart", "sequence", "class"], language);
    }, { sources, language });
  }
  await expect(page.locator('[data-state="error"]')).toHaveCount(sources.length * 2);
  await expect(page.locator('[data-state="ready"]')).toHaveCount(6);
  const messages = await page.locator(".mermaid-excalidraw-error-detail").allTextContents();
  expect(messages.every((message) => message.includes("Resource-capable Mermaid syntax is not supported"))).toBe(true);
  expect(requests).toEqual([]);
  await page.evaluate(() => document.getElementById("sequence-resource-metadata")?.remove());
  await page.evaluate(() => window.harness.disable());
  await expect(page.locator("canvas")).toHaveCount(0);
  expect(errors).toEqual([]);
});
