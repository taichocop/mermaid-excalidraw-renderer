import { appendFile, readFile, readdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

/** Preserve the licenses of packages actually included by esbuild, plus fonts. */
export const bundledNotices = {
  name: "bundled-notices",
  setup(build) {
    build.onEnd(async (result) => {
      if (result.errors.length || !result.metafile) return;
      const packages = new Set();
      for (const input of Object.keys(result.metafile.inputs)) {
        const marker = input.lastIndexOf("node_modules/");
        if (marker < 0) continue;
        const remainder = input.slice(marker + "node_modules/".length);
        const name = remainder.split("/").slice(0, remainder.startsWith("@") ? 2 : 1).join("/");
        packages.add(input.slice(0, marker) + "node_modules/" + name);
      }
      const notices = ["Third-party notices for Mermaid Excalidraw Renderer\n"];
      for (const path of [...packages].sort()) {
        const pkg = JSON.parse(await readFile(resolve(path, "package.json"), "utf8"));
        notices.push(`\n${pkg.name}@${pkg.version} (${typeof pkg.license === "string" ? pkg.license : "see license text"})\n`);
        const files = (await readdir(path)).filter((name) => /^(licen[cs]e|copying|notice)(\.|$)/i.test(name));
        for (const file of files) notices.push(await readFile(resolve(path, file), "utf8"));
        if (pkg.name === "@excalidraw/excalidraw") notices.push(await readFile("licenses/excalidraw-LICENSE.txt", "utf8"));
      }
      notices.push("\nExcalidraw font notices (font metadata and upstream licenses)\n");
      for (const file of (await readdir("licenses/fonts")).sort()) {
        notices.push(`\n--- ${file} ---\n${await readFile(resolve("licenses/fonts", file), "utf8")}`);
      }
      const text = notices.join("\n");
      await writeFile("THIRD_PARTY_NOTICES.txt", text);
      // Keep the three-file runtime installation self-contained, including attribution.
      await appendFile(build.initialOptions.outfile, `\n/*\n${text.replaceAll("*/", "* /")}\n*/\n`);
    });
  },
};
