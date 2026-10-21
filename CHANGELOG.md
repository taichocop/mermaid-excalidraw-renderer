# Changelog

## [Unreleased]

### Fixed

- Use the public Obsidian DOM helper for the enlarged preview's temporary pan cursor. Restore the original cursor value and priority only while the plugin still owns that declaration; preserve newer upstream cursor updates on gesture completion and cancellation. Keep the cursor scoped to the captured canvas in its owner window.

### Maintenance

- Record the published 0.1.4 Scorecard's 12 findings, 11 disclosures and two passes, including measured runtime boundaries, retained upstream limitations and a separate approval-only attestation proposal. A new release and public scan remain necessary; Issue #47 stays open.

## [0.1.4]

### Added

- Add pointer-anchored mouse wheel and desktop trackpad pinch zoom inside the enlarged read-only preview. Ordinary vertical two-finger scrolling follows the same zoom rule; horizontal-only input leaves the viewport unchanged. Inline diagrams keep passive note scrolling.
- Normalize pixel, line and page wheel units using the canvas's CSS dimensions, limit each event to one zoom-button step (20%), and retain the 10%–3000% manual zoom range. Wheel input over preview controls, title and close areas stays contained without zooming or scrolling the background note.

### Fixed

- Restore mouse/pen drag pan in enlarged previews in desktop popout windows. Own the gesture in the canvas's window and update the public viewport API; release, cancellation, blur, pagehide and viewer disposal end the gesture.
- Fit small diagrams above 100% using both scene dimensions and the padded canvas, bounded at 300% inline and 400% in enlarged previews. Use measured inline-caption clearance; Fit to content uses optimized fitting, Reset remains centered 100%, and theme/roughness redraws preserve manual navigation. Canvas height and SVG geometry are unchanged.
- Preserve explicit translucent SVG shape fills using the resolved Light/Dark foreground while retaining opacity, restoring distinguishable Venn semantic overlaps without changing geometry. Explicit `none`/`transparent` fills remain empty.
- Keep filled SVG circles with an explicit zero-width stroke visible during theme normalization, restoring default Quadrant Chart points without changing Mermaid geometry or hollow circles.
- Preserve the Modal viewer's DOM constructor realm in desktop popouts by creating it through an owner-document fragment helper before appending it to the host's adopted content element.

### Verification and limitations

- Expand Pie SVG-fallback regression coverage for `showData`, titles, labels, absolute values, percentages, themes, invalid-input isolation, multiple diagrams and viewer lifecycle. Production-bundle regressions and synthetic-vault Obsidian **1.14.4** desktop Reading view checks verified the measured `showData` and simple `Usage` fixtures in Light/Dark, open-note theme switches and narrow split panes, including preview controls and focus navigation.
- Expand production-bundle Flowchart/graph coverage for TD/TB/BT/LR/RL, representative edge styles, labels, bidirectional arrows, basic shapes and subgraphs. With the pinned converter, `~~~` currently becomes a visible headless line. Measured basic/nested subgraphs use a single SVG fallback image; native Excalidraw grouping is absent.
- Verify Quadrant SVG fallback titles, axis/quadrant labels, points, Light/Dark, live theme changes, independent diagrams, invalid-input isolation, resize and lifecycle in production-bundle browser tests.
- Verify Venn SVG fallback with two/three sets, unions, titles/labels, set/union sizes, text nodes, semantic region pixels, live themes, independent scenes, invalid isolation, resize, lifecycle and enlarged-preview regressions. Explicit `look: handDrawn` hatching can obscure dense union labels; measured classic-look acceptance does not extend to that mode.
- Pie, Quadrant and Venn each remain one SVG image, distinct from native editable Excalidraw elements. Sectors, points and labels remain SVG content; roughness does not reconstruct their geometry. Venn semantic overlaps are preserved without a native Venn converter.
- Desktop requirement remains Obsidian **1.14.4+**; mobile is untested and unsupported. Physical macOS trackpad acceptance is recorded for [PR #44's exact runtime artifact](https://github.com/taichocop/mermaid-excalidraw-renderer/pull/44); other OS/host gesture delivery remains unverified. Coverage applies to the measured fixtures and environments.

### Maintenance

- Add repository agent guidance and clarify contributor validation and evidence requirements.

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
