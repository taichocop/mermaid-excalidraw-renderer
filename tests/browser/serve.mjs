import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import * as esbuild from "esbuild";

await esbuild.build({ entryPoints: ["tests/browser/harness.ts"], bundle: true, format: "iife",
  outfile: "tests/browser/build/harness.js", platform: "browser" });
const routes = new Map([
  ["/", ["tests/browser/index.html", "text/html"]],
  ["/harness.js", ["tests/browser/build/harness.js", "text/javascript"]],
  ["/main.js", ["main.js", "text/javascript"]],
  ["/styles.css", ["styles.css", "text/css"]],
]);
createServer(async (req, res) => {
  const route = routes.get(req.url);
  if (!route) { res.writeHead(404).end(); return; }
  try {
    res.writeHead(200, { "Content-Type": route[1] });
    res.end(await readFile(route[0]));
  } catch { res.writeHead(500).end(); }
}).listen(4173, "127.0.0.1", () => console.log("Browser harness: http://127.0.0.1:4173"));
