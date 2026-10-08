# Native acceptance — 0.1.0 candidate

Date: 2026-10-08 (Asia/Tokyo). Host: installed macOS Obsidian 1.14.4, installer 1.14.4. Dedicated `test-vault` in the release worktree; personal vault contents/settings were not modified.

## Artifact identity

Installed `main.js` SHA-256: `01bc13539234c3fcdf590ce0447e467c84e10d6ed7aad3c41eca6a93bedacd6c`.

This matches the production CI artifact from run [37706702539](https://github.com/taichocop/mermaid-excalidraw-renderer/actions/runs/37706702539), source commit `78a0b447efc873913aa3830fd6740d21569e1849`, and the uploaded unpublished GitHub draft asset. Subsequent changes concern documentation/support metadata, not runtime code; new build hashes must still match before publication. These native checks use production code, not a native-host mock.

## Observed results

| Status | Check | Observation |
| --- | --- | --- |
| PASS | Plugin enabled / Reading view | Plugin appears in settings and registered blocks render in the native host. |
| PASS | Light/Dark Flowchart | Start, OK?, Done, Retry nodes/arrows and labels visibly readable in both themes. |
| PASS | Light/Dark Sequence | Alice/Bob lifelines and message labels visibly readable in both themes. |
| PASS | Light/Dark Class/ER/State | User class members, USER/POST relationship and Idle/Active states visibly readable via expected SVG fallback in both themes. |
| PASS | Live theme switch | Switching test-vault from system Dark to Light and back updates already-open diagrams, including SVG State. |
| PASS | Dark Pie/Timeline | 70%/30% pie labels and 2024/2025 timeline content visibly readable. |
| WARNING | Gantt | Project/Build/Implement fixture renders, but date ticks overlap. README discloses the upstream SVG layout limitation. |
| PASS | Invalid Mermaid | Full inline parse error visible as text; other rendered blocks remain present. |
| PASS | Settings save / plugin reload | UI changed fontSize to 21, roughness to Artist (2), canvasHeight to 580 and canvasPadding to 33. data.json, reopened settings and settings after disable/re-enable all contain those values. |
| PASS | Native 20 diagrams / note switch | Multiple diagrams note renders at the top and Diagram 20 at the bottom. Empty note clears diagram UI; returning to Diagrams renders again. Host remains usable. This is a smoke check, not an exhaustive memory profile. |
| PASS | Disable/re-enable | Toggle off removes plugin settings link; toggle on restores it, preserves saved settings and renders diagrams after returning to the note. |
| PASS | Defaults / host reload | Restored 20 / Architect / 600 / 32 / Follow Obsidian and the test-vault system theme. Used native View → Force Reload; Flowchart renders and reopened settings show these saved values. |
| PASS | Supported baseline | Initial supported minimum is 1.14.4, the version tested with this candidate. Earlier README recorded 1.13.7 validation; that is historical and not claimed as final-candidate acceptance. See ADR-010. |

Expected converter fallback diagnostics for Class/ER/State and the invalid fixture’s parse error were visible in Developer Tools. No unexpected plugin scene exception was observed during the successful rendering checks.

## UI connector observations

An initial blank canvas was resolved by raising the test-vault window; read-only DOM inspection while inactive reported zero-sized view containers. It must not be recorded as a fixed product bug. Later, the native UI connector returned stale state for a closed separate settings window, with noWindowsAvailable/ScreenCaptureKit/timeoutReached failures. Rebinding the exact installed application after the window closed and using the current inner dropdown item restored operations. All previously blocked acceptance checks above were then completed. These connector failures are not evidence of a plugin crash.

Settings/defaults are restored only in the disposable test-vault. The private vault was not changed. Community Directory account/policy acceptance, source merge and release publication are separate remaining external steps.

## Fresh pre-publication repeat — 2026-10-08

Repeated in the installed macOS Obsidian 1.14.4 after the maintainer explicitly requested another native check before publication. The production files in the isolated test-vault match the local build, draft downloads and exact-main CI run [37716342157](https://github.com/taichocop/mermaid-excalidraw-renderer/actions/runs/37716342157) at `2b4c359c43b90f86e3e9007bb697b1fe26fe3de4`. The `main.js` SHA-256 remains the artifact identity above; no product runtime changed in this preparation follow-up.

- Flowchart and Sequence, and Class/ER/State SVG fallbacks: readable labels, shapes and connections in both Light and Dark. Single-diagram notes were used to inspect the entire scenes.
- Pie and Timeline: readable in both themes. Gantt renders Project/Build/Implement, with the same disclosed overlapping date ticks in both themes.
- Changing the vault appearance from system Dark to Light updates an already-open native Flowchart; changing Light to Dark updates an already-open Gantt SVG fallback without reopening its note.
- Invalid Mermaid displays the inline text parse error. Opening the valid Flowchart afterwards succeeds.
- Changed plugin font size from 20 to 21 in its settings UI. After native View → Force Reload, reopened settings still show 21. Disabled and re-enabled the plugin; its settings entry returns, 21 is retained, and diagrams render after returning to the note. The saved plugin data also reports 21.
- Restored font size 20, Architect, height 600, padding 32, Follow Obsidian, and the test-vault appearance's system-theme selection.
- The 20-diagram note renders Diagram 1 and Diagram 20 at opposite ends. Switching to Empty note removes diagram UI; switching back to the single Flowchart renders again. This remains a smoke check, not a memory-leak measurement.

Native screenshots were retained locally for review; private account screens and Orca/Hermes configuration are excluded from repository evidence. Early screen capture and accessibility clicks disagreed with visible content across displays. Moving the test window to CS2420 and using screenshot-grounded coordinates restored consistent observation; only the subsequently verified scenes are reported as repeat results. The UI connector issue is not a product fix or evidence of a plugin crash. No developer-console exception audit is claimed for this repeat.

The repeat native gate is complete. Human review/merge of preparation changes, explicit release-source approval, tag workflow, final draft-asset verification, publication and directory policy/support acceptance remain separate steps.
