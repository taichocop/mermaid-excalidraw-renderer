# Release readiness — 0.1.0

Audit date: 2026-10-08 (Asia/Tokyo). This is a release candidate, not a claim that the directory has approved it.

## Current publication hold

Publication remains on hold until the local-docs removal and draft-sync fix are reviewed and merged into main, the maintainer aligns the unpublished `0.1.0` tag to that reviewed main commit, and the release workflow succeeds for that exact source. The current tag points to `2b4c359c43b90f86e3e9007bb697b1fe26fe3de4`; that earlier source is superseded by the docs-free main requirement. Public publication and Community Directory submission remain pending.

The `docs/` folder stays local, is ignored and must be removed from Git tracking before publication. Public references are [README.md](README.md), [CONTRIBUTING.md](CONTRIBUTING.md), [CHANGELOG.md](CHANGELOG.md) and [SECURITY.md](SECURITY.md). Release automation reads only the matching version section in CHANGELOG.md; the undated `0.1.0` notes describe content without claiming publication or submission.

Release run [37737800062](https://github.com/taichocop/mermaid-excalidraw-renderer/actions/runs/37737800062) passed validation for the earlier tag source but failed the draft job after its metadata PATCH: the final guard observed a changed tag. The maintainer confirmed that the original release ID `406265576` remains a draft, targets that source and retains all six matching assets, while its tag became an `untagged-` value. The fix explicitly includes the approved tag in PATCH metadata and preserves the existing ID/tag/draft guards. Before rerunning, the maintainer must restore the approved tag on that same draft ID; do not create a replacement draft. Recheck the new workflow source, draft target and all asset hashes before publishing.

## Historical initial audit (before changes)

| Status | Area | Evidence / action |
| --- | --- | --- |
| PASS | Identity | `mermaid-excalidraw-renderer` / `Mermaid Excalidraw Renderer` satisfy the current manifest character/naming rules. Preserve both. Directory uniqueness still requires a live check. |
| PASS | License | MIT, copyright 2026 taichi; bundled JS/font notices already generated and embedded in main.js. |
| PASS | Dependencies | npm + committed package-lock.json; React/react-dom 18.3.1, Excalidraw 0.18.1, converter 2.2.2, Mermaid 11.17.2 pinned. Obsidian 1.13.1 is development-only and external to the bundle. |
| PASS | Runtime design | Public host APIs, separate integration/conversion/appearance/rendering, cleanup and serialized conversion; no Node/Electron import in src. |
| WARNING | Working tree | Started on `codex/event-driven-agent-loop` at 77f3d0b; .gitignore modified and CONTRIBUTING.md/CHANGELOG.md untracked. Preserve existing work. Default branch is origin/main (874f8c3). |
| BLOCKER | Documentation | README is a development log, changelog describes implemented work as planned. Root SECURITY.md absent. |
| WARNING | Compatibility | minAppVersion 1.5.0 lacks runtime evidence. Prior README records macOS Obsidian 1.13.7 testing. Mobile untested; desktop-only scope retained pending validation. |
| WARNING | UI checklist | Single settings section has a redundant heading. Dynamic canvas dimensions are necessary layout values, not static visual styling. |
| BLOCKER | Release | No release workflow or artifact/version validation. Default-branch manifest and exact-version release must agree before submission. |
| WARNING | Security | Strict Mermaid and input/edge limits exist. Strengthen hostile-input/network regressions; audit transitive runtime code and licensing. |
| WARNING | Dependency audit | Initial npm audit: 2 moderate dev-only findings via Obsidian's moment dependency; no available npm fix. Recheck production separately. |
| BLOCKER | Remote publication | gh repo/release queries return HTTP 401. Public visibility, existing releases and directory reservation have not yet been confirmed. |
| WARNING | Test evidence | Existing unit and production-bundle browser suites; previous native-host validation is recorded in README, not performed in this audit yet. |

## Official requirements checked

- [Submit your plugin](https://docs.obsidian.md/Plugins/Releasing/Submit%20your%20plugin)
- [Submission requirements](https://docs.obsidian.md/community-directory/submission-requirements-for-plugins)
- [Developer policies](https://docs.obsidian.md/community-directory/developer-policies)
- [Manifest](https://docs.obsidian.md/Reference/Manifest)
- [Community directory](https://docs.obsidian.md/community-directory)
- [Set up and claim](https://docs.obsidian.md/community-directory/set-up-and-claim)
- [Self-critique checklist](https://docs.obsidian.md/oo/plugin)

The current submission route is the Community Directory web form with linked Obsidian/GitHub accounts. The default-branch manifest is read at HEAD; release tag must be exactly x.y.z with the required runtime attachments. A legacy obsidian-releases PR is not the submission route.

ID uses lowercase letters/hyphens only, cannot contain obsidian or end in plugin, and must be unique. Name uses Basic Latin with only hyphens, plus signs and parentheses as punctuation; cannot include Obsidian (or variants), Plugin, or a core-feature name, and must be unique. Funding URLs are for financial support only; none is configured. authorUrl is optional.

## Recorded runtime and infrastructure verification

| Status | Result | Evidence / remaining action |
| --- | --- | --- |
| PASS | User documentation | English README, executable examples, manual/directory installation, limitations, privacy and support; public CONTRIBUTING, CHANGELOG and SECURITY included. Design and operations docs remain local. |
| PASS | Identity | ID/name/version preserved; public directory JSON mirror has no matching published identity on 2026-10-08. Final uniqueness is determined by directory submission. |
| PASS | Compatibility metadata | minAppVersion/versions now 1.14.4. Used public host APIs include code-block processor/css-change (since 0.9.7), MarkdownRenderChild/loadData/saveData and Setting controls. API availability alone does not establish the embedded browser/font/rendering stack’s compatibility. Current candidate acceptance passed on 1.14.4, so this is the conservative first-release supported baseline. Earlier 1.13.7 evidence is historical, not final-candidate acceptance. |
| WARNING | Mobile | No runtime Node/Electron import; browser-compatible dependencies. Mobile memory/WebView behavior untested, so existing desktop-only support boundary retained. Not a claim that Node APIs require the restriction. |
| PASS | Build | Clean npm ci using Node 24.19.0/npm 10.9.2, typecheck, production build and artifact validator pass. Package/lock/manifest/versions agree at 0.1.0. |
| PASS | Tests | Node 24 lint, 22 unit tests and 22 release regression tests pass for the local-docs/draft-sync fix. The prior runtime acceptance includes 10 passing production-bundle Chrome browser tests covering the native/SVG matrix, themes, settings, layout, 20 diagrams, cleanup and hostile input. Browser validation for this fix is deferred while another issue owns port 4173. |
| PASS | Runtime imports and licenses | esbuild metadata contains 130 bundled package roots; only host obsidian is external. No production source maps or remote CSS font URLs. MIT/plugin/dependency/font texts embedded and separate notices included. LICENSE-MIT is now collected; missing upstream package texts supplied; new missing notices fail build. |
| PASS | Production security audit | npm audit --omit=dev: 0 vulnerabilities on 2026-10-08. |
| WARNING | Development audit | npm audit: 2 moderate findings through dev-only Obsidian→moment; npm offers no nonbreaking fix. Host package is not bundled. ESLint/sliced deprecation warnings also concern tooling/upstream packages and require follow-up. |
| PASS | Security regressions | Strict security cannot be overridden via init/frontmatter; themeCSS and dompurifyConfig are protected; CSS cannot change the host in the tested case. Character/edge-limit bypass rejected and HTML error strings do not execute. |
| WARNING | Network disclosure | Normal eight-type rendering makes no remote requests. Mermaid image syntax was measured requesting the referenced remote image under strict mode. README/SECURITY disclose this; imported diagrams are not a network sandbox. |
| PASS | Repository security | Public repository/default branch main confirmed. Private vulnerability reporting enabled and verified; secret scanning and push protection already enabled. GitHub auth works outside the sandbox via macOS keyring; the initial 401 was sandbox-related, not an expired login. |
| PASS | Release preparation | Pinned official Actions, read-only validation then contents-write draft job, tag/version validation, tested assets, SHA256SUMS and public versioned CHANGELOG release notes prepared. Community Directory submission remains a maintainer action. |
| PASS | Release review guardrails | Full-history main ancestry and exact tag/commit checks run before npm ci. Draft sync shares the validator asset contract, removes obsolete files, replaces stale files and verifies all paginated remote names/digests/sizes/states. Each mutation rechecks the same release ID/tag is draft; API/auth/upload failures and Published releases fail closed. 15 new regressions cover source history, artifact drift and release protection. |
| PASS | Native acceptance | Production main.js installed in the isolated test-vault on macOS Obsidian 1.14.4. Main five types readable in Light/Dark, live theme updates, Pie/Timeline, safe invalid error, settings persistence through plugin disable/re-enable and host Force Reload, native 20-diagram top/bottom and note switch confirmed. Defaults restored. This evidence applies only while runtime asset hashes remain identical. |
| WARNING | Native Gantt layout | The simple Gantt fixture renders, but date-axis labels overlap. Upstream SVG geometry is preserved; README discloses this limitation. |
| BLOCKER | Public release / submission | PR #2 is merged and its exact-main CI passed. Review and merge of the local-docs/draft-sync fix, maintainer alignment of the unpublished tag, recovery of the original draft and successful tag workflow are required before publication. Account-owner linking/ownership/policy acceptance and submission remain outstanding. A draft alone is insufficient. |

Draft Release 0.1.0 was created with six uploaded attachments and all GitHub asset SHA-256 digests matched the locally validated files. It remains unpublished; the subsequent tag and failed draft sync are recorded in the current publication hold above. See the [draft release](https://github.com/taichocop/mermaid-excalidraw-renderer/releases) (maintainer access required).

Linux CI initially passed the runtime changes, then exposed a transient zero-size-canvas read in the hidden-pane test helper. The helper now returns a not-yet-rendered sample and polls for actual ink; it does not waive the rendering assertion. CI run [37706702539](https://github.com/taichocop/mermaid-excalidraw-renderer/actions/runs/37706702539) passed all checks at 78a0b447efc873913aa3830fd6740d21569e1849, including all 10 browser tests. PR #2 is now merged at `2b4c359c43b90f86e3e9007bb697b1fe26fe3de4`; main CI run [37716342157](https://github.com/taichocop/mermaid-excalidraw-renderer/actions/runs/37716342157) passed the required `validate` check from GitHub Actions (App ID 15368). On 2026-10-08, all six downloaded draft attachments matched that main CI artifact and the local Node 24 build by exact names, sizes, SHA-256 and manifest contents. Package/lock/manifest/versions and release notes also agree. Production audit reported zero vulnerabilities.

The commit above is historical runtime acceptance evidence. The release source must now be the reviewed main commit containing the local-docs removal and draft-sync fix, as described in the current publication hold. Matching runtime hashes preserve the native acceptance evidence, but do not waive review or CI for the new source. No publication, scanner result, submission or directory approval is claimed here.

## Design discrepancies resolved

- Old specification prohibited fallback processing; the working implementation only recolors SVG while preserving geometry. Basic/technical specifications and ADR now state this actual boundary.
- Class/ER/State display is implemented through SVG fallback, not native hand-drawn conversion; README, test expectations and docs explicitly reflect the secure Mermaid/converter combination.
- Old docs treated current theme updates and security-reporting setup as future work; current behavior and reporting channel are documented.
- 1.5.0 compatibility had no runtime evidence; 1.13.7 had only earlier evidence. After completing final-candidate acceptance, 1.14.4 is the conservative supported baseline (ADR-010). The host API typings are 1.13.1; they are not a runtime dependency or proof of all host versions.
- Existing Agent Loop PR #1 is separate maintainer work. Release preparation is isolated on a new worktree from origin/main; the plugin release does not include that unrelated automation.

## Human decisions

No ID/name change is needed. If the live directory reports an identity conflict, stop for HUMAN DECISION before an ID migration. Formal directory ownership/account linking, policy/support acceptance and public publication remain explicit final steps after the gates above.


## PR #2 release infrastructure review follow-up

Re-fetched GitHub HEAD/review/inline threads on 2026-10-08: Codex reviewed a0f48088717095830ab5013aee9d0ce757976d35; two unresolved findings concerned stale Draft attachments and tags outside main history. Both are addressed through the script/fixture guards above. SHA pins, permission boundaries, persist-credentials: false, all validation stages and Draft-only creation are preserved. Runtime source and production artifact bytes remain unchanged, so recorded 1.14.4 native acceptance remains valid. Fresh CI and Codex Review must complete on each new PR HEAD before READY_TO_MERGE; old-head reviews do not satisfy that gate. No merge, version tag, publication or Directory submission is part of this follow-up.
