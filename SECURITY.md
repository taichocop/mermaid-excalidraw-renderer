# Security

## Supported versions

The latest published release receives fixes. No third-party security audit has been performed.

## Reporting a vulnerability

Please use [GitHub private vulnerability reporting](https://github.com/taichocop/mermaid-excalidraw-renderer/security/advisories/new) if available. This repository feature was enabled and verified on 2026-10-08. If unavailable, open an issue asking for a private contact channel **without including an exploit, private notes or secrets**. Do not post sensitive details publicly.

Include affected versions, OS/Obsidian version, a minimal sanitized reproduction and the expected/actual behavior. The maintainer will assess impact and prepare a fix; no response-time guarantee is implied.

## Runtime boundaries

- Diagram input is untrusted Markdown text. The plugin uses the public upstream converter and Mermaid strict mode, and protects securityLevel, secure, startOnLoad, themeCSS, dompurifyConfig and size-limit options from diagram overrides.
- Inputs over 50,000 characters are rejected before conversion; Mermaid limits edges to 500. Conversion is serialized, and unloaded children discard results. Complex diagrams can still consume CPU/memory: there is no worker sandbox or hard execution deadline.
- React displays error messages as text. The plugin never inserts source/error strings as raw HTML. Mermaid internally generates temporary DOM/SVG; its sanitizer and vulnerabilities remain relevant.
- Fallback SVG is recolored using DOMParser and serialized as a data URL. The plugin does not reconstruct diagram geometry or insert the normalized XML into the host DOM.
- Canvas is view-only, AI and embeddable features are disabled, and diagram link opening is prevented. No telemetry, ads, self-update, vault scanning or note mutation is implemented. Settings use loadData/saveData only.
- JavaScript and fonts are bundled. From 0.1.1, the shared converter entry rejects resource-capable source before upstream parsing/rendering. This applies to standard and dedicated blocks: extended node metadata (`@{…}`), resource HTML elements/attributes, Markdown images, CSS image/import constructs and URL declarations are refused. Escapes, entity syntax (including Mermaid’s internal entity placeholders) and CSS comments are refused to prevent disguised resource tokens. All metadata is refused because its YAML fields can encode/alias image keys; this guard does not implement a Mermaid, YAML, HTML or CSS parser.
- The guard deliberately rejects some harmless source, including URL labels/comments, backslash-escaped text, entities and non-image metadata. Refused diagrams show a text-only inline error; other diagrams still render. The policy covers the resource-producing paths reviewed in Mermaid 11.17.2 and converter 2.2.2. Re-audit these paths on dependency changes; a lexical guard and upstream sanitization are not a general execution/network sandbox.
- Standard `mermaid` is ON by default, including upgrades with no saved option. Its Reading-view postprocessor runs before Obsidian’s built-in renderer and does not invoke the built-in vault Mermaid trust prompt or read its private trust storage. The pre-conversion policy applies regardless of vault trust. OFF and plugin disable return standard blocks to Obsidian’s renderer and its trust behavior; this plugin does not control host or third-party rendering/network behavior. Dedicated blocks retain the guard with either setting.
- No global fetch, Image, DOM, network API or host renderer is patched. Browser regressions intercept absolute, protocol-relative, relative, encoded, HTML and CSS resource attempts in standard/dedicated blocks and require zero requests after boot. Unit tests require refused source never to reach the converter. Older 0.1.0 external-image requests were measured in browser tests; do not apply the 0.1.1 refusal claim to earlier versions.
- No Node/Electron modules are imported by runtime source. Build/test/maintainer scripts use Node and GitHub APIs and are not distributed as runtime dependencies.

## Dependency and release checks

Run `npm ci`, `npm audit`, `npm audit --omit=dev`, the unit/release/browser suites and a production build. Investigate advisories instead of applying breaking automatic fixes. The release validator checks metadata parity, host-only external imports, bundled CSS assets, notices and SHA-256 hashes. Review dependency/license changes in the lock file.

The initial full audit found moderate advisories in the development-only Obsidian package's moment dependency. Obsidian is external to main.js; these packages are not shipped by the plugin. Record the current audit in RELEASE_READINESS.md. Never suppress a production vulnerability merely because the same library exists in the host.

## Maintainer automation

Release validation runs with read-only permissions. A separate job receives write permission to create a draft release after validation, using the already-tested assets. Review and publish the draft deliberately. Existing agent-loop workflows are maintainer tooling and need their own repository-variable, token and event-identity configuration; they are not a plugin feature.
