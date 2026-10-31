# Release readiness — 0.1.0

## Release workflow artifact attestations — 2026-10-27, unreleased candidate

For future releases after published `0.1.6` (`ce12a9fd801a8abec74cdf8a7d3b0b50dfca40f6`), [`.github/workflows/release.yml`](.github/workflows/release.yml) adds an isolated `attest` job between `validate` and `draft` (`validate` → `attest` → `draft`) to address the two `Missing GitHub artifact attestations for release assets` (`main.js` and `styles.css`) findings tracked in [Issue #47](https://github.com/taichocop/mermaid-excalidraw-renderer/issues/47) and [Issue #16](https://github.com/taichocop/mermaid-excalidraw-renderer/issues/16). Published `0.1.6` and earlier releases/tags remain untouched.

### Permission and trust boundaries

- **Workflow top-level & `validate` job**: `contents: read` only. All dependency installation (`npm ci`), lint/unit/release tests, `npm audit --omit=dev`, production bundle generation (`npm run build`), 6-asset validation, and Playwright Chromium browser tests execute without OIDC or attestation write privileges.
- **`attest` job** (`needs: validate`): Scoped exclusively to `contents: read`, `id-token: write`, and `attestations: write` (`artifact-metadata: write` is omitted because `push-to-registry` is false and the repository owner is a user account). It runs on a clean runner without `npm ci`, build scripts, or execution of `main.js`. It checks out with `persist-credentials: false` and `fetch-depth: 0`, verifies that the release tag commit belongs to `origin/main` via `scripts/validate-release-source.mjs`, downloads the `release-assets` artifact from the same workflow run, verifies `SHA256SUMS.txt` and the 6-asset contract (`inspectReleaseAssets('release-assets')`), signs a single multi-subject SLSA Build Provenance v1 (`https://slsa.dev/provenance/v1`) bundle for all six release files (`LICENSE`, `SHA256SUMS.txt`, `THIRD_PARTY_NOTICES.txt`, `main.js`, `manifest.json`, `styles.css`) using `actions/attest@1e69f48acb82d1966a394da916b4c1698aa569d6` (`v4.2.2`), and verifies both the local bundle (`--bundle`) and the persisted GitHub API record via `gh attestation verify` against the exact repository, workflow path, tag ref, commit SHA, run invocation URI, and all 6 subject SHA-256 digests.
- **`draft` job** (`needs: [validate, attest]`): Retains `contents: write` only (no OIDC or attestation permissions). If signing or verification fails in `attest`, `draft` does not run (fail-closed). Before synchronizing the Draft Release via `scripts/sync-draft-release.mjs`, `draft` also verifies `scripts/validate-release-source.mjs` with full git history (`fetch-depth: 0`) and re-verifies `SHA256SUMS.txt` and remote uploaded asset digests.

### Pre-publication maintainer verification for future releases

Because `.github/workflows/release.yml` triggers only on `push.tags: ['*.*.*']`, PR CI validates workflow structure, permissions, and mock verification policies statically, whereas live GitHub OIDC token issuance and Sigstore signing occur only on a tag workflow run. Before manually publishing a future Draft Release (`X.Y.Z` at `NEW_RELEASE_COMMIT_SHA`), download all six draft attachments and verify their attestations:

```sh
for file in LICENSE SHA256SUMS.txt THIRD_PARTY_NOTICES.txt main.js manifest.json styles.css; do
  gh attestation verify "$file" \
    --repo taichocop/mermaid-excalidraw-renderer \
    --signer-workflow taichocop/mermaid-excalidraw-renderer/.github/workflows/release.yml \
    --source-ref "refs/tags/X.Y.Z" \
    --source-digest "NEW_RELEASE_COMMIT_SHA" \
    --predicate-type "https://slsa.dev/provenance/v1" \
    --deny-self-hosted-runners
done
```

## Dependency audit follow-up — 2026-10-24, unreleased candidate

[Issue #51](https://github.com/taichocop/mermaid-excalidraw-renderer/issues/51) tracks the production DOMPurify update separately from the broader Scorecard work in #47 and scrolling investigation in #50. No version, tag or published release is changed by this remediation; the publication evidence below remains historical.

With npm 10.9.9 and the public npm registry, clean installation of main `c8a1468d7faf4bfc339c09e092208b28b3466436` resolves DOMPurify 3.4.16. The production audit currently reports one affected package with three advisories: [GHSA-cg2g-xh64-v4q7](https://github.com/advisories/GHSA-cg2g-xh64-v4q7) (global advisory Critical), [GHSA-mrv2-3pqr-j5jr](https://github.com/advisories/GHSA-mrv2-3pqr-j5jr) (High), and [GHSA-c6gr-qvv4-5v3f](https://github.com/advisories/GHSA-c6gr-qvv4-5v3f) (Low). The first affects versions 3.4.4–3.4.16; the other two affect versions through 3.4.16. All list 3.4.17 as patched, with no CVE identifier assigned at this check. Upstream repository advisories label all three Low; global advisory severity is not a measured plugin-specific impact. The earlier four-critical-package aggregate was transitive propagation, not four demonstrated Critical vulnerabilities; its precise difference from today's aggregate is unconfirmed. A fresh isolated cache reproduces today's result.

Mermaid 11.17.2 declares `dompurify: ^3.3.3`. Updating only that lock entry to 3.4.17 leaves one resolved sanitizer and requires no new override. Clean-install production audit then reports **zero vulnerabilities**. The full audit still reports four moderate development-only package entries; they are not waived or repaired by this scoped change.

The sanitizer is shipped in the production bundle and reachable from Mermaid label/SVG string sanitization. Inspected Mermaid callsites do not enable the disclosed shadow-root/template DOM-return, in-place node-detachment-hook, or XHTML/SMIL configuration combinations. Protected strict configuration and `dompurifyConfig` prevent source overrides. No plugin exploit is demonstrated, and these constraints do not justify retaining affected sanitizer code or establish a general sandbox. The [3.4.17 upstream patch](https://github.com/cure53/DOMPurify/commit/a77a3e78b59f72fa4d1c83f22e121ad9cc7d3575) also hardens other sanitization cases, so rendering/security regressions and Native smoke checks remain necessary. Final artifact, test, CI and independent-review evidence belongs to the remediation PR.

The production-bundle sanitizer regression uses benign XHTML animation attributes to check the patched `attributeName` guard. It exercises a non-default dependency configuration rather than demonstrating exploitation through the plugin. Publication of a future release and a fresh Directory scan remain separate human decisions.

Audit and publication update: 2026-10-08 (Asia/Tokyo). The GitHub release and Community Directory public listing are published. The public Scorecard results are recorded below; scanner findings require triage.

## Current release status

[Release 0.1.0](https://github.com/taichocop/mermaid-excalidraw-renderer/releases/tag/0.1.0) was published on 2026-10-08 at `06:55:25Z`, preserving the original release ID `406265576`. Its source and exact `0.1.0` tag point to `d0712ed7f8e312102668ee71ffb8c81f1712fc3b`, the reviewed main commit containing the local-docs removal and draft-sync fix.

[Main CI 37739887507](https://github.com/taichocop/mermaid-excalidraw-renderer/actions/runs/37739887507) and [tag CI 37739941821](https://github.com/taichocop/mermaid-excalidraw-renderer/actions/runs/37739941821) succeeded. The maintainer verified all six downloaded CI/release/local assets match by exact names and hashes: `main.js`, `manifest.json`, `styles.css`, `LICENSE`, `THIRD_PARTY_NOTICES.txt` and `SHA256SUMS.txt`. The three native-installed runtime files also match the verified hashes, preserving the recorded Obsidian 1.14.4 acceptance evidence. The `main.js` SHA-256 remains `01bc13539234c3fcdf590ce0447e467c84e10d6ed7aad3c41eca6a93bedacd6c`.

The `docs/` folder remains local and ignored, and was removed from Git tracking before publication. Public references are [README.md](README.md), [CONTRIBUTING.md](CONTRIBUTING.md), [CHANGELOG.md](CHANGELOG.md) and [SECURITY.md](SECURITY.md). Release automation reads the matching version section in CHANGELOG.md; its exact `## [0.1.0]` heading is retained with the verified publication date and link.

## Community Directory status

After the user reported pressing publish, the maintainer directly observed the [public listing](https://community.obsidian.md/plugins/mermaid-excalidraw-renderer), headed `Mermaid Excalidraw Renderer`, with an [Add to Obsidian](obsidian://show-plugin?id=mermaid-excalidraw-renderer) link. This confirms the listing is published, beyond the previously observed owner management entry.

The maintainer also inspected the public Scorecard while signed out, with `Sign in` and `Add to Obsidian` visible.

| Displayed field | Observed value |
| --- | --- |
| Current version | 0.1.0 |
| Platforms | Desktop only |
| Desktop compatibility | Obsidian 1.14.4+ |
| Health | Excellent |
| Review | Satisfactory |
| Review issues | 18 (Warnings: 9; Other: 9) |
| Disclosures | 11 |
| Passed checks | 2: no vulnerable dependencies; build reproduces main.js byte-for-byte |

These measured labels do not mean zero scanner issues or that every rule passes. Detailed findings and triage are tracked in [Issue #16](https://github.com/taichocop/mermaid-excalidraw-renderer/issues/16).

## Historical draft-sync failure (resolved before publication)

Release run [37737800062](https://github.com/taichocop/mermaid-excalidraw-renderer/actions/runs/37737800062) passed validation for the earlier tag source but failed the draft job after its metadata PATCH: the final guard observed a changed tag. At that time, the maintainer confirmed that the original release ID `406265576` remained a draft, targeted that source and retained all six matching assets, while its tag had become an `untagged-` value. The fix explicitly included the approved tag in PATCH metadata and preserved the existing ID/tag/draft guards. The successful tag workflow and publication recorded above supersede this failure; the original release ID was preserved.

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

## Historical requirements check (2026-10-08)

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
| PASS | Identity | ID/name/version preserved. The earlier directory mirror check found no existing matching identity; the public listing is now observed under `mermaid-excalidraw-renderer` as Mermaid Excalidraw Renderer, version 0.1.0. |
| PASS | Compatibility metadata | minAppVersion/versions now 1.14.4. Used public host APIs include code-block processor/css-change (since 0.9.7), MarkdownRenderChild/loadData/saveData and Setting controls. API availability alone does not establish the embedded browser/font/rendering stack’s compatibility. Current candidate acceptance passed on 1.14.4, so this is the conservative first-release supported baseline. Earlier 1.13.7 evidence is historical, not final-candidate acceptance. |
| WARNING | Mobile | No runtime Node/Electron import; browser-compatible dependencies. Mobile memory/WebView behavior untested, so existing desktop-only support boundary retained. Not a claim that Node APIs require the restriction. |
| PASS | Build | Clean npm ci using Node 24.19.0/npm 10.9.2, typecheck, production build and artifact validator pass. Package/lock/manifest/versions agree at 0.1.0. |
| PASS | Tests | Node 24 lint, 22 unit tests and 22 release regression tests passed for the local-docs/draft-sync fix. The prior runtime acceptance included 10 passing production-bundle Chrome browser tests covering the native/SVG matrix, themes, settings, layout, 20 diagrams, cleanup and hostile input. Local browser validation was deferred at that implementation stage; the successful main and tag CI above provide the subsequent release validation evidence. |
| PASS | Runtime imports and licenses | esbuild metadata contains 130 bundled package roots; only host obsidian is external. No production source maps or remote CSS font URLs. MIT/plugin/dependency/font texts embedded and separate notices included. LICENSE-MIT is now collected; missing upstream package texts supplied; new missing notices fail build. |
| PASS | Production security audit | npm audit --omit=dev: 0 vulnerabilities on 2026-10-08. |
| WARNING | Development audit | npm audit: 2 moderate findings through dev-only Obsidian→moment; npm offers no nonbreaking fix. Host package is not bundled. ESLint/sliced deprecation warnings also concern tooling/upstream packages and require follow-up. |
| PASS | Security regressions | Strict security cannot be overridden via init/frontmatter; themeCSS and dompurifyConfig are protected; CSS cannot change the host in the tested case. Character/edge-limit bypass rejected and HTML error strings do not execute. |
| WARNING | Network disclosure | Normal eight-type rendering makes no remote requests. Mermaid image syntax was measured requesting the referenced remote image under strict mode. README/SECURITY disclose this; imported diagrams are not a network sandbox. |
| PASS | Repository security | Public repository/default branch main confirmed. Private vulnerability reporting enabled and verified; secret scanning and push protection already enabled. GitHub auth works outside the sandbox via macOS keyring; the initial 401 was sandbox-related, not an expired login. |
| PASS | Release preparation | Pinned official Actions, read-only validation then contents-write draft job, tag/version validation, tested assets, SHA256SUMS and public versioned CHANGELOG release notes prepared. Community Directory progress is recorded above. |
| PASS | Release review guardrails | Full-history main ancestry and exact tag/commit checks run before npm ci. Draft sync shares the validator asset contract, removes obsolete files, replaces stale files and verifies all paginated remote names/digests/sizes/states. Each mutation rechecks the same release ID/tag is draft; API/auth/upload failures and Published releases fail closed. 15 new regressions cover source history, artifact drift and release protection. |
| PASS | Native acceptance | Production main.js installed in the isolated test-vault on macOS Obsidian 1.14.4. Main five types readable in Light/Dark, live theme updates, Pie/Timeline, safe invalid error, settings persistence through plugin disable/re-enable and host Force Reload, native 20-diagram top/bottom and note switch confirmed. Defaults restored. This evidence applies only while runtime asset hashes remain identical. |
| WARNING | Native Gantt layout | The simple Gantt fixture renders, but date-axis labels overlap. Upstream SVG geometry is preserved; README discloses this limitation. |
| PASS | Public release | Original release ID `406265576` published as 0.1.0 from `d0712ed7f8e312102668ee71ffb8c81f1712fc3b`; main/tag CI and asset verification succeeded as recorded above. |
| PASS | Community Directory listing | Public listing directly observed with Add to Obsidian, version 0.1.0 and Desktop only. Displayed Health: Excellent; Review: Satisfactory. |
| FOLLOW-UP | Scanner findings | Public Scorecard reports 18 review issues, 11 disclosures and 2 passed checks. Detailed findings and triage are tracked in Issue #16; no all-rules-pass claim is made. |

The original six-attachment draft is now the [public 0.1.0 release](https://github.com/taichocop/mermaid-excalidraw-renderer/releases/tag/0.1.0) with the same release ID. The earlier runtime comparisons below preceded publication.

Linux CI initially passed the runtime changes, then exposed a transient zero-size-canvas read in the hidden-pane test helper. The helper now returns a not-yet-rendered sample and polls for actual ink; it does not waive the rendering assertion. CI run [37706702539](https://github.com/taichocop/mermaid-excalidraw-renderer/actions/runs/37706702539) passed all checks at 78a0b447efc873913aa3830fd6740d21569e1849, including all 10 browser tests. PR #2 is now merged at `2b4c359c43b90f86e3e9007bb697b1fe26fe3de4`; main CI run [37716342157](https://github.com/taichocop/mermaid-excalidraw-renderer/actions/runs/37716342157) passed the required `validate` check from GitHub Actions (App ID 15368). On 2026-10-08, all six downloaded draft attachments matched that main CI artifact and the local Node 24 build by exact names, sizes, SHA-256 and manifest contents. Package/lock/manifest/versions and release notes also agree. Production audit reported zero vulnerabilities.

The commit above is historical runtime acceptance evidence. The published source is `d0712ed7f8e312102668ee71ffb8c81f1712fc3b`, as recorded in the current release status. Matching runtime hashes preserve the native acceptance evidence; review and CI were completed for that source. The Directory public listing and public Scorecard are verified; scanner findings require the focused follow-up above.

## Historical design discrepancies resolved

- Old specification prohibited fallback processing; the working implementation only recolors SVG while preserving geometry. Basic/technical specifications and ADR now state this actual boundary.
- Class/ER/State display is implemented through SVG fallback, not native hand-drawn conversion; README, test expectations and docs explicitly reflect the secure Mermaid/converter combination.
- Old docs treated current theme updates and security-reporting setup as future work; current behavior and reporting channel are documented.
- 1.5.0 compatibility had no runtime evidence; 1.13.7 had only earlier evidence. After completing final-candidate acceptance, 1.14.4 is the conservative supported baseline (ADR-010). The host API typings are 1.13.1; they are not a runtime dependency or proof of all host versions.
- Existing Agent Loop PR #1 is separate maintainer work. Release preparation is isolated on a new worktree from origin/main; the plugin release does not include that unrelated automation.

## Remaining human decisions

No ID/name change is needed. If the live directory reports an identity conflict, stop for HUMAN DECISION before an ID migration. GitHub publication and the Directory public listing are complete. Scanner triage and any required remediation belong to Issue #16; no claim that every scanner rule passes is made here.


## Historical PR #2 release infrastructure review follow-up

Re-fetched GitHub HEAD/review/inline threads on 2026-10-08: Codex reviewed a0f48088717095830ab5013aee9d0ce757976d35; two unresolved findings concerned stale Draft attachments and tags outside main history. Both were addressed through the script/fixture guards above. SHA pins, permission boundaries, persist-credentials: false, all validation stages and Draft-only creation were preserved. Runtime source and production artifact bytes remained unchanged, preserving the recorded 1.14.4 native acceptance. Fresh CI and Codex Review are required for each new PR HEAD; old-head reviews do not satisfy that gate. This historical follow-up performed no merge, version tagging, publication or Directory submission; the subsequent verified publication is recorded above.
