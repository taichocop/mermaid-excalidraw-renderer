import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import postcss from "postcss";
import selectorParser from "postcss-selector-parser";

const excalidrawDist = resolve("node_modules/@excalidraw/excalidraw/dist/prod");
const scope = "mermaid-excalidraw-container";

async function fontData(path) {
  return `data:font/woff2;base64,${(await readFile(path)).toString("base64")}`;
}

/** Excalidraw publishes fonts as URL strings, rather than JS asset imports. */
export const inlineExcalidrawFonts = {
  name: "inline-excalidraw-fonts",
  setup(build) {
    build.onLoad({ filter: /@excalidraw[\\/]excalidraw[\\/]dist[\\/](prod|dev)[\\/].*\.js$/ }, async ({ path }) => {
      let contents = await readFile(path, "utf8");
      const pattern = /(["'])(\.\/fonts\/[^"']+\.woff2)\1/g;
      for (const match of [...contents.matchAll(pattern)]) {
        const data = await fontData(resolve(dirname(path), match[2]));
        contents = contents.replaceAll(match[0], JSON.stringify(data));
      }
      return { contents, loader: "js", resolveDir: dirname(path) };
    });
  },
};

export async function buildStyles() {
  const css = postcss.parse(await readFile(resolve(excalidrawDist, "index.css"), "utf8"));
  const animations = new Map();
  css.walkAtRules(/keyframes$/, (rule) => {
    const name = `mermaid-excalidraw-${rule.params}`;
    animations.set(rule.params, name);
    rule.params = name;
  });
  css.walkRules((rule) => {
    if (rule.parent.type === "atrule" && /keyframes$/.test(rule.parent.name)) return;
    rule.selector = selectorParser((selectors) => {
      selectors.each((selector) => {
        let rootFound = false;
        selector.walkPseudos((pseudo) => {
          if (pseudo.value === ":root") {
            pseudo.replaceWith(selectorParser.className({ value: scope }));
            rootFound = true;
          }
        });
        if (!rootFound) {
          selector.prepend(selectorParser.combinator({ value: " " }));
          selector.prepend(selectorParser.className({ value: scope }));
        }
      });
    }).processSync(rule.selector);
  });
  const fonts = new Map();
  css.walkDecls((decl) => {
    if (/^(animation|animation-name)$/.test(decl.prop)) {
      decl.value = decl.value.replace(/[\w-]+/g, (word) => animations.get(word) ?? word);
    }
    for (const match of decl.value.matchAll(/url\(["']?(\.\/fonts\/[^"')]+)["']?\)/g)) {
      fonts.set(match[1], null);
    }
  });
  for (const path of fonts.keys()) fonts.set(path, await fontData(resolve(excalidrawDist, path)));
  css.walkDecls((decl) => {
    for (const [path, data] of fonts) decl.value = decl.value.replaceAll(path, data);
  });
  const virgil = await fontData(resolve(excalidrawDist, "fonts/Virgil/Virgil-Regular.woff2"));
  const localCss = await readFile("src/styles.css", "utf8");
  await writeFile("styles.css", `/* Generated: edit src/styles.css and run npm run build. */\n${css.toString()}\n@font-face { font-family: Virgil; src: url("${virgil}") format("woff2"); font-display: swap; }\n${localCss}`);
}
