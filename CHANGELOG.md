# Changelog

## [Unreleased]

### Changed

- Make inline diagrams passive in Reading view and Live Preview: note scroll input passes through, and the canvas cannot zoom or pan inline. A focusable diagram button opens an enlarged Obsidian Modal with Enter/Space or a click; standard OFF and source editing keep the existing host behavior.
- Add explicit zoom in/out, fit and centered 100% reset controls plus mouse/pen drag pan in the enlarged preview. Scoped wheel handling prevents scrolling the note behind it. Escape also closes through the viewer Scope; custom controls support keyboard activation. Restore the opener's focus without scrolling when it still exists.
- Keep replacement previews in the activating desktop window without restoring focus to the old opener. Let the viewer Scope inherit the Modal Scope while preserving host shortcut isolation; keep forward/reverse Tab traversal inside the visible preview controls.
- Share conversion output, prepared elements, normalized SVG files and theme handling between both displays. Keep the read-only clipboard/export/shortcut boundary in the Modal. Close owned previews during reconversion, source/widget disposal, note changes and plugin unload; remove roots, observers and listeners through the existing session lifecycle.
- Add production-bundle regressions for passive wheel/drag behavior, native/SVG enlargement, keyboard controls, host Scope isolation, standard ON/OFF, source editing and foreign-document lifecycle. The final browser suite passed **60/60 tests** after a sequential build. Native Obsidian **1.14.4** checks verified passive trusted-wheel note scrolling, main-window Modal controls/pan/Esc focus restoration, Flowchart/Sequence and Class/ER/State/Block fixtures, Live Preview edits/Undo/Redo/Japanese IME, Source Mode, theme changes, standard OFF/dedicated independence, unload/note-switch cleanup and native popout Modal owner-document placement and disposal. The maintainer completed native popout Escape focus restoration as human acceptance.
- **The maintainer completed physical two-finger hardware trackpad acceptance.** This human acceptance is separate from the earlier horizontal-scrolling checks using trusted events through the official Chrome DevTools Protocol (CDP); CDP input alone does not establish physical hardware trackpad behavior.

## [0.1.2]

### Changed

- Restrict both standard `mermaid` and dedicated `mermaid-excalidraw` embedded viewers to pan/zoom: block canvas/native-menu copy, paste/drop, context-menu export and editor/dialog shortcuts before upstream handlers. Host editors outside the viewer keep their normal behavior; desktop mouse/pen navigation remains available, touch interaction is unsupported.
- Suspend inherited Obsidian shortcuts with a public parentless Scope only while a viewer has focus; restore host shortcuts on focus exit, window deactivation and disposal. This also protects against host keymaps that run before document capture, while retaining Tab and canvas zoom navigation.
- Use Obsidian owner-document DOM helpers and cross-window SVG checks. Settings now expose all six searchable declarative controls through the existing validation/redraw/save path; remove deprecated slider tooltips.
- Remove the host dark-canvas `!important` override while preserving monochrome theme contrast.
- Document the bundle/Sync Standard limitation, retained upstream capabilities and legal/checksum assets. Desktop requirement remains Obsidian **1.14.4+**. Published 0.1.0 and 0.1.1 remain unchanged.

### Added

- Standard `mermaid` blocks in Live Preview use the existing Excalidraw conversion, strict/resource guards and appearance pipeline when **Render standard mermaid blocks as Excalidraw** is ON. OFF leaves the host editor renderer in control; the saved setting and default ON are unchanged.
- Public CodeMirror 6 StateField block replacements show source whenever any cursor/selection touches the fence range and suspend during composition. Leaving the block renders the latest source without changing Markdown or Undo history. Source mode is untouched.
- Shared rendering sessions retain separate MarkdownRenderChild and editor-widget ownership, cancel stale work and dispose React roots. Dedicated `mermaid-excalidraw` keeps its existing host code-block path and remains independent of the standard-block setting.
- Real CM6 tests cover selection, editing/Undo/Redo, composition events, settings and modes, host widget precedence, native/SVG diagrams, multiple editors, errors and async disposal. Synthetic desktop checks in Obsidian 1.14.4 also confirm Flowchart/Sequence, Class single-SVG fallback, ON/OFF with dedicated blocks independent, source editing/Undo/Redo, Japanese IME, Source/Live Preview transitions, Light/Dark, multiple diagrams/panes, scrolling, resizing and disable/re-enable. Those checks preceded the viewer-boundary changes. Native checks and the maintainer’s physical two-finger hardware trackpad acceptance of the passive-inline/enlarged-preview candidate are recorded under Unreleased. Full third-party plugin compatibility and other OS input methods remain unverified; mobile remains untested.

## [0.1.1]

### Changed

- Standard `mermaid` blocks now render through the existing Excalidraw conversion and appearance pipeline in Reading view by default. **Enabling or upgrading the plugin changes the initial appearance of existing Mermaid blocks**, without rewriting notes.
- New installations and old settings with no standard-block option default to ON. Explicit saved OFF values remain OFF after restart or plugin disable/re-enable; invalid values fall back to ON.
- Turn off **Render standard mermaid blocks as Excalidraw** to restore Obsidian’s standard display. Open Reading views are redrawn immediately when toggling or disabling the plugin; cached previews in editing panes are invalidated for the next switch to Reading view. Its canvases and pending conversions are cleaned up. Other plugins’ registrations are left intact.
- Dedicated `mermaid-excalidraw` blocks continue to render with either setting. Flowchart/Sequence conversion, SVG fallback, inline errors and theme handling reuse the existing renderer.
- Reading view is the supported mode. Standard Mermaid in Live Preview follows Obsidian’s separate editor renderer; Live Preview is not supported by this release. Third-party Mermaid plugin compatibility still requires native-host verification.
- Standard and dedicated blocks now reject resource-capable source before conversion, including image/node metadata (`@{…}`), Sequence `properties`/`details` and actor icons, resource HTML/CSS, Markdown images and URLs. Escapes, entities and CSS comments that can disguise these constructs are also refused. This conservative guard can reject benign text and metadata, including `properties`/`details` keywords in labels or comments; rejected blocks show an isolated inline error. It does not use Obsidian’s Mermaid trust prompt; OFF returns standard blocks to the host’s own rendering and trust behavior.
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
