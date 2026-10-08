# Security

## Supported versions

The latest published release receives fixes. 0.1.0 is currently a release candidate, not a published release. No third-party security audit has been performed.

## Reporting a vulnerability

Please use [GitHub private vulnerability reporting](https://github.com/taichocop/mermaid-excalidraw-renderer/security/advisories/new) if available. This repository feature was enabled and verified on 2026-10-08. If unavailable, open an issue asking for a private contact channel **without including an exploit, private notes or secrets**. Do not post sensitive details publicly.

Include affected versions, OS/Obsidian version, a minimal sanitized reproduction and the expected/actual behavior. The maintainer will assess impact and prepare a fix; no response-time guarantee is implied.

## Runtime boundaries

- Diagram input is untrusted Markdown text. The plugin uses the public upstream converter and Mermaid strict mode, and protects securityLevel, secure, startOnLoad, themeCSS, dompurifyConfig and size-limit options from diagram overrides.
- Inputs over 50,000 characters are rejected before conversion; Mermaid limits edges to 500. Conversion is serialized, and unloaded children discard results. Complex diagrams can still consume CPU/memory: there is no worker sandbox or hard execution deadline.
- React displays error messages as text. The plugin never inserts source/error strings as raw HTML. Mermaid internally generates temporary DOM/SVG; its sanitizer and vulnerabilities remain relevant.
- Fallback SVG is recolored using DOMParser and serialized as a data URL. The plugin does not reconstruct diagram geometry or insert the normalized XML into the host DOM.
- Canvas is view-only, AI and embeddable features are disabled, and diagram link opening is prevented. No telemetry, ads, self-update, vault scanning or note mutation is implemented. Settings use loadData/saveData only.
- JavaScript and fonts are bundled. Ordinary rendering works offline. Upstream Mermaid external-image features may request resources referenced by diagram text; diagram overrides of themeCSS and dompurifyConfig are blocked, but these are not an allowlisted network API. Do not treat untrusted diagrams as guaranteed network-isolated. README discloses this behavior.
- No Node/Electron modules are imported by runtime source. Build/test/maintainer scripts use Node and GitHub APIs and are not distributed as runtime dependencies.

## Dependency and release checks

Run `npm ci`, `npm audit`, `npm audit --omit=dev`, the unit/release/browser suites and a production build. Investigate advisories instead of applying breaking automatic fixes. The release validator checks metadata parity, host-only external imports, bundled CSS assets, notices and SHA-256 hashes. Review dependency/license changes in the lock file.

The initial full audit found moderate advisories in the development-only Obsidian package's moment dependency. Obsidian is external to main.js; these packages are not shipped by the plugin. Record the current audit in RELEASE_READINESS.md. Never suppress a production vulnerability merely because the same library exists in the host.

## Maintainer automation

Release validation runs with read-only permissions. A separate job receives write permission to create a draft release after validation, using the already-tested assets. Review and publish the draft deliberately. Existing agent-loop workflows are maintainer tooling and need their own repository-variable, token and event-identity configuration; they are not a plugin feature.
