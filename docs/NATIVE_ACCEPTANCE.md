# Native acceptance — 0.1.0 candidate

Date: 2026-10-08 (Asia/Tokyo). Host: installed macOS Obsidian 1.14.4, installer 1.14.4. Dedicated `test-vault` in the release worktree; personal vault contents/settings were not modified.

## Artifact identity

Installed `main.js` SHA-256: `01bc13539234c3fcdf590ce0447e467c84e10d6ed7aad3c41eca6a93bedacd6c`.

This matches CI artifact from run [37706702539](https://github.com/taichocop/mermaid-excalidraw-renderer/actions/runs/37706702539), source commit `78a0b447efc873913aa3830fd6740d21569e1849`, and the uploaded unpublished GitHub draft asset. Tests use production code, not a native-host mock.

## Observed results

| Status | Check | Observation |
| --- | --- | --- |
| PASS | Plugin enabled / Reading view | Plugin appears in settings and registered blocks render in the native host. |
| PASS | Dark Flowchart | Start, OK?, Done, Retry nodes/arrows and labels visibly readable. |
| PASS | Dark Sequence | Alice/Bob lifelines and message labels visibly readable. |
| PASS | Dark Class/ER/State | User class members, USER/POST relationship and Idle/Active states visibly readable via expected SVG fallback. |
| PASS | Dark Pie/Timeline | 70%/30% pie labels and 2024/2025 timeline content visibly readable. |
| WARNING | Gantt | Project/Build/Implement fixture renders, but date ticks overlap. No claim of perfect upstream SVG layout. |
| PASS | Invalid Mermaid | Full inline parse error visible as text; other rendered blocks remain present. |
| PASS | Settings save | UI changed fontSize to 21, roughness to Artist (2), canvasHeight to 580 and canvasPadding to 33. The plugin's data.json contains those values and follow-obsidian theme mode. |
| NOT VERIFIED | Light / live theme switch | Theme selector was reached; selection did not visibly apply before UI connection failed. Test-vault remains on system theme. |
| NOT VERIFIED | Settings after host reload | File persistence confirmed, but native reload/reopen verification not completed. |
| NOT VERIFIED | Native 20 diagrams / note switch | Covered by passing production-bundle browser tests; native run not completed. |
| NOT VERIFIED | Disable/re-enable | Not completed in native host. |
| NOT VERIFIED | Supported baseline, final assets | Earlier README recorded 1.13.7 verification. The final candidate has not been retested there in this audit. |

Expected converter fallback diagnostics for Class/ER/State and the invalid fixture's parse error were visible in Developer Tools. No unexpected plugin scene exception was observed during the successful rendering checks.

## UI connector limitation

An initial blank canvas was resolved by raising the test-vault window; read-only DOM inspection while inactive reported zero-sized view containers. It must not be recorded as a fixed product bug. Later, operations on Obsidian's separate settings window repeatedly failed with `noWindowsAvailable`, ScreenCaptureKit capture errors and `timeoutReached`. Rebinding the exact installed application path and resetting the UI session did not restore reliable access. Read-only process inspection showed the application still running with no sustained CPU load at that sample; this does not diagnose the source of the connector failure.

The last changes were made only in the disposable test-vault. Its test settings above were retained so the maintainer can verify persistence. Developer Tools/settings may remain open. Do not overwrite this vault with `npm run test:vault` before checking persistence.

## Checks to complete before public publication

1. Reopen plugin settings and confirm 21 / Artist / 580 / 33; reload the native host and confirm them again.
2. Switch only the test-vault to Light; inspect Flowchart, Sequence, Class, ER and State, then switch back and verify already-open diagrams follow the theme.
3. Open `Multiple diagrams`, inspect top/bottom, switch to `Empty note` and back to `Diagrams`; confirm content appears and host remains usable.
4. Disable and re-enable this plugin in the test-vault, then reopen diagrams and confirm settings persist.
5. Restore defaults (20 / Architect / 600 / 32 / Follow Obsidian) in the test-vault and record results. Retest final artifacts on the supported baseline or explicitly revise the compatibility claim with evidence.

This document records partial acceptance. It does not waive the release gate in RELEASE_READINESS.md or assert Community Directory approval.
