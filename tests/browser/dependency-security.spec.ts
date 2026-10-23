import { expect, test } from "@playwright/test";
import type { DOMPurify } from "dompurify";

declare global { interface Window { dependencyPurify: DOMPurify } }

test("bundled sanitizer rejects href attributeName in XHTML mode", async ({ page }, testInfo) => {
  await page.route("**/main.js", async route => {
    const response = await route.fetch(), body = await response.text();
    // Observe the actual bundled instance through its public version field.
    // Only this test response gains a reference; runtime source is unchanged.
    const pattern = /(\w+)\.version="(3\.\d+\.\d+)"/g;
    expect([...body.matchAll(pattern)]).toHaveLength(1);
    await route.fulfill({ response, body: body.replace(pattern,
      (_match, instance: string, version: string) =>
        `(window.dependencyPurify=${instance}).version="${version}"`) });
  });
  await page.goto("/"); await page.evaluate(() => window.ready);
  const result = await page.evaluate(() => {
    // Benign regression for GHSA-c6gr-qvv4-5v3f. These non-default options
    // exercise the dependency patch; the plugin does not enable XHTML mode.
    // No executable URL, event handler, navigation or network sink is used.
    const output = window.dependencyPurify.sanitize(
      '<svg xmlns="http://www.w3.org/2000/svg"><animate attributeName="href" values="alpha;beta" /></svg>',
      { PARSER_MEDIA_TYPE: "application/xhtml+xml", ADD_TAGS: ["animate"], ADD_ATTR: ["attributeName", "values"] },
    );
    const doc = new DOMParser().parseFromString(output, "application/xhtml+xml");
    const animation = doc.getElementsByTagName("animate")[0];
    return { version: window.dependencyPurify.version, output, parseErrors: doc.getElementsByTagName("parsererror").length,
      animationPresent: !!animation, attributeName: animation?.getAttribute("attributeName"),
      values: animation?.getAttribute("values") };
  });
  await testInfo.attach("bundled-sanitizer", { body: JSON.stringify(result), contentType: "application/json" });
  expect(result.parseErrors).toBe(0);
  expect(result.animationPresent).toBe(true);
  expect(result.values).toBe("alpha;beta");
  expect(result.attributeName).toBeNull();
});
