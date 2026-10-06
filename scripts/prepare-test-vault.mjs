import { copyFile, mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import * as esbuild from "esbuild";

const { outputFiles } = await esbuild.build({ entryPoints: ["tests/browser/samples.ts"], bundle: true, format: "esm", write: false });
const { samples } = await import(`data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString("base64")}`);
const vault = resolve("test-vault");
const plugin = resolve(vault, ".obsidian/plugins/mermaid-excalidraw-renderer");
await mkdir(plugin, { recursive: true });
for (const file of ["main.js", "manifest.json", "styles.css"]) await copyFile(file, resolve(plugin, file));
await writeFile(resolve(vault, ".obsidian/community-plugins.json"), '["mermaid-excalidraw-renderer"]\n');
await writeFile(resolve(vault, ".obsidian/app.json"), JSON.stringify({ defaultViewMode: "preview" }, null, 2));
const block = (source) => `\n\`\`\`mermaid-excalidraw\n${source}\n\`\`\`\n`;
await writeFile(resolve(vault, "Diagrams.md"), "# Mermaid Excalidraw — manual checks\n" +
  Object.entries(samples).map(([name, source]) => `\n## ${name}\n${block(source)}`).join(""));
await writeFile(resolve(vault, "Multiple diagrams.md"), "# 20 concurrent diagrams\n" +
  Array.from({ length: 20 }, (_, index) => `\n## Diagram ${index + 1}\n${block(samples.flowchart)}`).join(""));
await writeFile(resolve(vault, "Empty note.md"), "# Empty note\n\nSwitch between this note and Diagrams to check cleanup.\n");
console.log(`Prepared test vault: ${vault}`);
