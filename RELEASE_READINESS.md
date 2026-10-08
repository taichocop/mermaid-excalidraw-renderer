# Release readiness — 0.1.0

Audit date: 2026-10-08 (Asia/Tokyo). This is a release candidate, not a claim that the directory has approved it.

## Initial audit (before changes)

| Status | Area | Evidence / action |
| --- | --- | --- |
| PASS | Identity | `mermaid-excalidraw-renderer` / `Mermaid Excalidraw Renderer` satisfy the current manifest character/naming rules. Preserve both. Directory uniqueness still requires a live check. |
| PASS | License | MIT, copyright 2026 taichi; bundled JS/font notices already generated and embedded in main.js. |
| PASS | Dependencies | npm + committed package-lock.json; React/react-dom 18.3.1, Excalidraw 0.18.1, converter 2.2.2, Mermaid 11.17.2 pinned. Obsidian 1.13.1 is development-only and external to the bundle. |
| PASS | Runtime design | Public host APIs, separate integration/conversion/appearance/rendering, cleanup and serialized conversion; no Node/Electron import in src. |
| WARNING | Working tree | Started on `codex/event-driven-agent-loop` at 77f3d0b; .gitignore modified and CONTRIBUTING.md/CHANGELOG.md untracked. Preserve existing work. Default branch is origin/main (874f8c3). |
| BLOCKER | Documentation | docs/ is ignored; source design decisions unavailable to GitHub reviewers. README is a development log, changelog describes implemented work as planned. Root SECURITY.md absent. |
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

## Final verification

| Status | Result | Evidence / remaining action |
| --- | --- | --- |
| PASS | User documentation | English README, executable examples, manual/directory installation, limitations, privacy and support; CONTRIBUTING, CHANGELOG, SECURITY and source design docs now included. |
| PASS | Identity | ID/name/version preserved; public directory JSON mirror has no matching published identity on 2026-10-08. Final uniqueness is determined by directory submission. |
| PASS | Compatibility metadata | minAppVersion/versions now 1.14.4. Used public host APIs include code-block processor/css-change (since 0.9.7), MarkdownRenderChild/loadData/saveData and Setting controls. API availability alone does not establish the embedded browser/font/rendering stack’s compatibility. Current candidate acceptance passed on 1.14.4, so this is the conservative first-release supported baseline. Earlier 1.13.7 evidence is historical, not final-candidate acceptance. |
| WARNING | Mobile | No runtime Node/Electron import; browser-compatible dependencies. Mobile memory/WebView behavior untested, so existing desktop-only support boundary retained. Not a claim that Node APIs require the restriction. |
| PASS | Build | Clean npm ci using Node 24.19.0/npm 10.9.2, typecheck, production build and artifact validator pass. Package/lock/manifest/versions agree at 0.1.0. |
| PASS | Tests | 22 unit tests, 2 release-negative-validation tests, 10 production-bundle Chrome browser tests pass. Native/SVG diagram matrix, themes, settings, layout, 20 diagrams, cleanup and hostile input covered. |
| PASS | Runtime imports and licenses | esbuild metadata contains 130 bundled package roots; only host obsidian is external. No production source maps or remote CSS font URLs. MIT/plugin/dependency/font texts embedded and separate notices included. LICENSE-MIT is now collected; missing upstream package texts supplied; new missing notices fail build. |
| PASS | Production security audit | npm audit --omit=dev: 0 vulnerabilities on 2026-10-08. |
| WARNING | Development audit | npm audit: 2 moderate findings through dev-only Obsidian→moment; npm offers no nonbreaking fix. Host package is not bundled. ESLint/sliced deprecation warnings also concern tooling/upstream packages and require follow-up. |
| PASS | Security regressions | Strict security cannot be overridden via init/frontmatter; themeCSS and dompurifyConfig are protected; CSS cannot change the host in the tested case. Character/edge-limit bypass rejected and HTML error strings do not execute. |
| WARNING | Network disclosure | Normal eight-type rendering makes no remote requests. Mermaid image syntax was measured requesting the referenced remote image under strict mode. README/SECURITY disclose this; imported diagrams are not a network sandbox. |
| PASS | Repository security | Public repository/default branch main confirmed. Private vulnerability reporting enabled and verified; secret scanning and push protection already enabled. GitHub auth works outside the sandbox via macOS keyring; the initial 401 was sandbox-related, not an expired login. |
| PASS | Release preparation | Pinned official Actions, read-only validation then contents-write draft job, tag/version validation, tested assets, SHA256SUMS, release notes and current web-form submission guide prepared. |
| PASS | Native acceptance | Production main.js installed in the isolated test-vault on macOS Obsidian 1.14.4. Main five types readable in Light/Dark, live theme updates, Pie/Timeline, safe invalid error, settings persistence through plugin disable/re-enable and host Force Reload, native 20-diagram top/bottom and note switch confirmed. Defaults restored. See docs/NATIVE_ACCEPTANCE.md. |
| WARNING | Native Gantt layout | The simple Gantt fixture renders, but date-axis labels overlap. Upstream SVG geometry is preserved; README discloses this limitation. |
| BLOCKER | Public release / submission | Preparation must be reviewed/merged to main and draft release published, then directory account owner links GitHub, selects owner, accepts support/policies and submits. A draft/branch alone is insufficient. |

Draft Release 0.1.0 was created with six uploaded attachments and all GitHub asset SHA-256 digests matched the locally validated files. It remains unpublished and no 0.1.0 Git tag exists yet. See the [draft release](https://github.com/taichocop/mermaid-excalidraw-renderer/releases) (maintainer access required).

Linux CI initially passed the runtime changes, then exposed a transient zero-size-canvas read in the hidden-pane test helper. The helper now returns a not-yet-rendered sample and polls for actual ink; it does not waive the rendering assertion. CI run [37706702539](https://github.com/taichocop/mermaid-excalidraw-renderer/actions/runs/37706702539) passed all checks at 78a0b447efc873913aa3830fd6740d21569e1849, including all 10 browser tests. Subsequent acceptance-document updates require a fresh passing PR-head CI before public publication.

## Design discrepancies resolved

- Old specification prohibited fallback processing; the working implementation only recolors SVG while preserving geometry. Basic/technical specifications and ADR now state this actual boundary.
- Class/ER/State display is implemented through SVG fallback, not native hand-drawn conversion; README, test expectations and docs explicitly reflect the secure Mermaid/converter combination.
- Old docs treated current theme updates and security-reporting setup as future work; current behavior and reporting channel are documented.
- 1.5.0 compatibility had no runtime evidence; 1.13.7 had only earlier evidence. After completing final-candidate acceptance, 1.14.4 is the conservative supported baseline (ADR-010). The host API typings are 1.13.1; they are not a runtime dependency or proof of all host versions.
- Existing Agent Loop PR #1 is separate maintainer work. Release preparation is isolated on a new worktree from origin/main; the plugin release does not include that unrelated automation.

## Human decisions

No ID/name change is needed. If the live directory reports an identity conflict, stop for HUMAN DECISION before an ID migration. Formal directory ownership/account linking, policy/support acceptance and public publication remain explicit final steps after the gates above.
