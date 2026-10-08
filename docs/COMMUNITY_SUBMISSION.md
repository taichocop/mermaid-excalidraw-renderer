# Community Directory submission — 0.1.0

Checked 2026-10-08 against the official [submission guide](https://docs.obsidian.md/Plugins/Releasing/Submit%20your%20plugin), [requirements](https://docs.obsidian.md/community-directory/submission-requirements-for-plugins), [policies](https://docs.obsidian.md/community-directory/developer-policies), [manifest](https://docs.obsidian.md/Reference/Manifest) and [account setup](https://docs.obsidian.md/community-directory/set-up-and-claim).

## Submission values

| Field | Value |
| --- | --- |
| Repository | https://github.com/taichocop/mermaid-excalidraw-renderer |
| Default branch | main |
| Plugin ID | mermaid-excalidraw-renderer |
| Name | Mermaid Excalidraw Renderer |
| Version / tag | 0.1.0 (no v prefix) |
| Minimum Obsidian | 1.14.4 |
| Author | taichi |
| Author URL | https://github.com/taichocop |
| Desktop only | true |
| Funding URL | Absent; no donation service configured |
| Description | Render Mermaid diagrams in an Excalidraw-style view in your notes. |
| License | MIT; bundled third-party notices included |

Public visibility and an empty release list were confirmed using the public GitHub API. The published community-plugin JSON mirror had no matching ID or name on 2026-10-08. This does not reserve either value or prove that a pending submission cannot conflict: the directory makes the final determination.

## Required before Submit

- [ ] Release-preparation changes reviewed and merged to main; default-branch HEAD has the accurate manifest, user README, LICENSE and source.
- [ ] CI succeeds on that exact commit; no production dependency advisories remain unresolved.
- [x] Fresh native-host install of the final assets checked: load, settings save/reload, both themes, diagram matrix, invalid input, note switch, disable/re-enable.
- [x] Current installed desktop 1.14.4 tested; minimum supported version set to that verified baseline; do not represent browser-host mocks as native-host verification.
- [x] Private vulnerability reporting enabled and API state verified (2026-10-08).
- [ ] Tag 0.1.0 points to the reviewed commit; validated draft assets verified against SHA256SUMS.txt, then GitHub release published with main.js, manifest.json and styles.css attached.
- [ ] Release manifest, default-branch manifest, package/lock version and versions.json agree. No source maps, fixtures or credentials in assets.
- [ ] Maintainer accepts ongoing support responsibilities and all policy disclosures.

Native results and the exact remaining checks are recorded in [NATIVE_ACCEPTANCE.md](NATIVE_ACCEPTANCE.md). The native gate passed on 1.14.4; minimum support is conservatively set to that verified version. Earlier 1.13.7 validation is not claimed for this candidate.

## Current submission route

1. Sign in at [community.obsidian.md](https://community.obsidian.md) with your Obsidian account.
2. Connect your GitHub account in the Community profile. This verifies repository ownership.
3. Go to Plugins → New plugin and enter the repository URL. Choose the owner (yourself or an organization).
4. Review the Developer policies and continued-support commitment, then Submit.
5. Read automated scanner feedback in the directory. Fix errors in the repository and publish an incremented release as required; publish the directory entry when ready. It is not installable until review errors are resolved.

The directory reads manifest.json at the HEAD of the default branch. Install assets come from the GitHub release with the matching tag. A branch-only manifest or a draft release is insufficient. Do not use the old obsidian-releases pull-request route.

## Human decisions / account operations

ID/name changes are not needed. If the directory later reports a collision, make a HUMAN DECISION before changing the ID because installed folders/settings and existing users can be affected.

Only the account owner can complete sign-in/account linking, choose directory ownership and accept the maintenance/policy commitment. Do not infer those legal/account choices from a passing local test. Record the final directory URL and scanner outcome here after submission.
