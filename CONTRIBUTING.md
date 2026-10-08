# Contributing

Use Node.js 22.13+ (22 series) or 24+, npm 10+, and `npm ci` with the committed lock file.

Before coding, read the requirements, basic specification, architecture, technical specification, ADR and PR checklist under [docs/](docs/). Current accepted decisions and working implementation are the baseline; document discrepancies before resolving them. The public README describes shipped behavior, including SVG fallback limitations.

Keep changes focused. Use public Obsidian/Excalidraw APIs and installed types; do not reimplement Mermaid parsing/layout or patch upstream private APIs. Preserve the standard `mermaid` block renderer, settings migration and lifecycle cleanup.

Before requesting review:

```sh
npm run lint
npm test
npm run test:release
npm run build
npm run test:browser
npm audit --omit=dev
```

For Chromium, install it with `npx playwright install chromium` and set `PLAYWRIGHT_CHANNEL=chromium`. Run `npm run test:vault` for a disposable native Obsidian test vault. Never use private notes in screenshots or fixtures.

Describe the behavior change, reason, validation and limitations in your PR. Add regression coverage for behavior changes and update affected docs/CHANGELOG.md. Do not commit generated main.js/styles.css, dist, test-vault, credentials or secrets. Report vulnerabilities according to [SECURITY.md](SECURITY.md).

Release metadata must agree across manifest.json, package.json, package-lock.json and versions.json. Tags use exactly x.y.z, without a v prefix. See [release operations](docs/MermaidExcalidraw_リリース運用手順.md) before publishing.
