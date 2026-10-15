# Contributing

Agent-driven work should also follow [AGENTS.md](AGENTS.md).

Use Node.js 22.13+ (22 series) or 24+, npm 10+, and `npm ci` with the committed lock file.

Before coding, read the issue's purpose, scope, acceptance criteria and test plan, plus [README.md](README.md), [CHANGELOG.md](CHANGELOG.md) and [SECURITY.md](SECURITY.md). Current accepted decisions and working implementation are the baseline; document discrepancies before resolving them. The public README describes supported behavior, including SVG fallback limitations. The local `docs/` folder is private and excluded from Git; do not force-add it or copy its contents into public files.

Keep changes focused. Use public Obsidian/Excalidraw APIs and installed types; do not reimplement Mermaid parsing/layout or patch upstream private APIs. Preserve the standard `mermaid` block renderer, settings migration and lifecycle cleanup.

For changes beyond docs/instructions, run before requesting review:

```sh
npm run lint
npm test
npm run test:release
npm run build
npm run test:browser
npm audit --omit=dev
```

For docs/instruction-only changes, run `git diff --check`, `npm run lint` and `npm run typecheck`, and confirm runtime/build inputs are unchanged. Add browser or Native checks only for a concrete behavioral risk.

For Chromium, install it with `npx playwright install chromium` and set `PLAYWRIGHT_CHANNEL=chromium`. Run `npm run test:vault` for a disposable native Obsidian test vault. Never use private notes in screenshots or fixtures.

Describe the behavior change, reason, validation and limitations in your PR. Add regression coverage for behavior changes and update affected public documentation and CHANGELOG.md. Do not commit generated main.js/styles.css, dist, test-vault, credentials or secrets. Report vulnerabilities according to [SECURITY.md](SECURITY.md).

Release metadata must agree across manifest.json, package.json, package-lock.json and versions.json. Tags use exactly x.y.z, without a v prefix. Draft automation reads the matching `## [x.y.z]` section in [CHANGELOG.md](CHANGELOG.md); keep it free of publication or submission claims until confirmed. See [release readiness](RELEASE_READINESS.md) before publishing.
