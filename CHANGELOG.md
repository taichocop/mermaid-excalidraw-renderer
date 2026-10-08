# Changelog

## [Unreleased]

## [0.1.1]

### Changed

- Standard `mermaid` blocks now render through the existing Excalidraw conversion and appearance pipeline in Reading view by default. **Enabling or upgrading the plugin changes the initial appearance of existing Mermaid blocks**, without rewriting notes.
- New installations and old settings with no standard-block option default to ON. Explicit saved OFF values remain OFF after restart or plugin disable/re-enable; invalid values fall back to ON.
- Turn off **Render standard mermaid blocks as Excalidraw** to restore Obsidian’s standard display. Open Reading views are redrawn immediately when toggling or disabling the plugin; cached previews in editing panes are invalidated for the next switch to Reading view. Its canvases and pending conversions are cleaned up. Other plugins’ registrations are left intact.
- Dedicated `mermaid-excalidraw` blocks continue to render with either setting. Flowchart/Sequence conversion, SVG fallback, inline errors and theme handling reuse the existing renderer.
- Reading view is the supported mode. Standard Mermaid in Live Preview follows Obsidian’s separate editor renderer; Live Preview is not supported by this release. Third-party Mermaid plugin compatibility still requires native-host verification.
- Standard and dedicated blocks now reject resource-capable source before conversion, including image/node metadata (`@{…}`), resource HTML/CSS, Markdown images and URLs. Escapes, entities and CSS comments that can disguise these constructs are also refused. This conservative guard can reject benign text and metadata; rejected blocks show an isolated inline error. It does not use Obsidian’s Mermaid trust prompt; OFF returns standard blocks to the host’s own rendering and trust behavior.
- Desktop requirement remains Obsidian **1.14.4+**.

## [0.1.0]

Published: [2026-10-08](https://github.com/taichocop/mermaid-excalidraw-renderer/releases/tag/0.1.0).

Listed in the [Obsidian Community Directory](https://community.obsidian.md/plugins/mermaid-excalidraw-renderer) as version 0.1.0, Desktop only. The displayed scorecard reads Health **Excellent** and Review **Satisfactory**. Scanner findings require follow-up; these labels do not establish that every scanner rule passes.

### Added

- `mermaid-excalidraw` blocks in Reading view, native Flowchart/Sequence rendering and SVG fallback for Class/ER/State and other Mermaid types.
- Theme contrast normalization, font size, roughness, canvas height/padding, automatic fitting, multiple diagrams, inline errors and lifecycle cleanup.
- Public security disclosures, artifact/version validation and a tested draft-release workflow.

### Changed

- Minimum supported Obsidian version is 1.14.4, based on native-host acceptance; desktop-only support, mobile untested.
- User documentation distinguishes SVG fallback from hand-drawn conversion and describes privacy, installation and limitations.
