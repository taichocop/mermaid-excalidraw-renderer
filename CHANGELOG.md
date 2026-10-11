# Changelog

## [Unreleased]

### Added

- Expand Pie SVG-fallback regression coverage for `showData`, titles, labels, absolute values, percentages, themes, invalid-input isolation, multiple diagrams and viewer lifecycle.
- Document the measured Pie example, bracketed `showData` values and single-image SVG rendering. Pie sectors remain part of the SVG image; roughness does not reconstruct them as native Excalidraw elements.

### Verification and limitations

- Production-bundle regressions and synthetic-vault Obsidian **1.14.4** desktop Reading view checks verified `showData` and simple `Usage` Pie fixtures in Light/Dark, open-note theme switches and narrow split panes, with visible titles, labels, displayed values/percentages and outlines without clipping. Enlarged previews retained Zoom, Fit, centered Reset, Close and five-plugin-control Tab/Shift+Tab navigation without upstream menu/background chrome. Verification remains limited to these measured fixtures; no runtime change was needed.

## [0.1.3]

### Changed

- Hide Excalidraw's hamburger menu, responsive bar and background chrome in inline and enlarged `mermaid` and `mermaid-excalidraw` viewers. Upstream menu nodes remain in the DOM with zero rendered geometry and no hit regions or reserved space.
- Retain the enlarged preview's Zoom out, Zoom in, Fit to content, Reset zoom and Close preview controls, with forward Tab and reverse Shift+Tab cycling through the five plugin controls. The host close button (×) stays visible and need not participate in that cycle; Escape/Close focus restoration and host shortcut isolation remain intact.
- Passive inline scrolling, click/Enter/Space enlargement, enlarged-preview pan and zoom, and existing view-only restrictions remain unchanged. Desktop support remains Obsidian **1.14.4+**.

## [0.1.2]

### Changed

- Make inline diagrams passive in Reading view and Live Preview: scroll input over a diagram goes to the note, and dragging cannot pan or zoom the inline canvas. A focusable diagram button opens an enlarged read-only Obsidian Modal with a click, Enter or Space. Standard OFF and source editing keep the existing host behavior.
- Add explicit Zoom in, Zoom out, Fit to content and Reset zoom controls in the enlarged preview, plus mouse/pen drag pan. Reset sets 100% zoom and centers the content in one scene update. Wheel/trackpad navigation is disabled inside the preview to prevent scrolling the note behind it; touch canvas interaction remains unsupported.
- Close the Modal with Escape or the preview/host close button, restoring a connected opener's focus without scrolling. Replacement previews suppress the old opener and host selection restoration and open in the activating desktop window.
- Let the focused viewer's public Scope inherit the Modal Scope while blocking inherited host commands before early host keymaps can run. The Modal's public Tab handler keeps forward/reverse traversal inside visible preview controls. Release the viewer Scope on focus exit, window deactivation and disposal; passive inline buttons leave normal note shortcuts available.
- Preserve the read-only clipboard/export/shortcut boundary in the enlarged preview: block canvas/native-menu copy, paste/drop, context-menu export and editor/dialog shortcuts before upstream handlers. Host editors outside the viewer retain normal commands and clipboard behavior. This UI boundary does not remove retained upstream capabilities or create an API sandbox.
- Share conversion output, prepared elements, normalized SVG files and theme handling between inline diagrams and enlarged previews. Close owned previews during reconversion, source/widget disposal, note changes and plugin unload; dispose roots, observers and listeners through the existing session lifecycle.
- Use public Obsidian owner-document DOM helpers and cross-window SVG checks. All six searchable declarative settings retain the existing validation/redraw/serialized-save path; remove deprecated slider tooltips.
- Remove the host dark-canvas `!important` override while preserving monochrome theme contrast.
- Record Issue #16 Scorecard remediation and evidence-qualified upstream capabilities in `SCORECARD_TRIAGE.md`, including the approximately 26 MB offline bundle exceeding Sync Standard's 5 MB file limit. Preserve legal/checksum assets and existing workflow permissions; checksums are not signed attestations. A fresh Directory scan remains a post-publication follow-up, not a completed candidate scan.
- Desktop requirement remains Obsidian **1.14.4+**. Published 0.1.0 and 0.1.1 tags/assets remain unchanged.

### Added

- Standard `mermaid` blocks in Live Preview use the existing Excalidraw conversion, strict/resource guards and appearance pipeline when **Render standard mermaid blocks as Excalidraw** is ON. OFF leaves the host editor renderer in control; the saved setting and default ON are unchanged.
- Public CodeMirror 6 StateField block replacements show source whenever any cursor/selection touches the fence range and suspend during composition. Leaving the block renders the latest source without changing Markdown or Undo history. Source mode is untouched.
- Shared rendering sessions retain separate MarkdownRenderChild and editor-widget ownership, cancel stale work and dispose React roots. Dedicated `mermaid-excalidraw` keeps its existing host code-block path and remains independent of the standard-block setting.
- Production-bundle regressions cover real CM6 selection/editing/Undo/Redo/composition, settings and modes, host widget precedence, passive wheel/drag behavior, native/SVG enlargement, centered Reset, keyboard controls, Modal Scope/Tab containment, host shortcut isolation, standard ON/OFF, multiple editors, errors, async disposal and foreign-document/replacement lifecycle. PR #28's final browser suite passed **60/60 tests** after a sequential build.

### Verification and limitations

- Recorded native Obsidian **1.14.4** checks verified passive trusted-wheel note scrolling, main-window Modal controls/pan/Escape focus restoration, Flowchart/Sequence and Class/ER/State/Block fixtures, Live Preview edits/Undo/Redo/Japanese IME, Source Mode, theme changes, standard OFF/dedicated independence, unload/note-switch cleanup and native popout Modal owner-document placement and disposal.
- On 2026-10-09, the maintainer completed physical two-finger hardware trackpad acceptance and native popout Escape focus restoration. That acceptance preceded the final Reset and Modal focus repairs in PR #28; those repairs have production-browser regression coverage, and native acceptance was not repeated. Trusted Chrome DevTools Protocol input and browser mocks alone do not establish physical hardware behavior.
- Full third-party plugin compatibility and other OS input methods remain unverified; mobile remains untested. SVG fallback preserves upstream geometry and retained upstream capabilities remain qualified in `SCORECARD_TRIAGE.md`.

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
