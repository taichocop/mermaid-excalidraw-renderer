# Agent contract

Mermaid source → upstream converter → read-only Excalidraw viewer in Obsidian.
The Mermaid text is the source of truth; the Excalidraw community plugin is not a dependency.

## Repository map and invariants

- `src/editor/` owns Live Preview; `src/renderer/` owns conversion, mounts and previews;
  `src/appearance/` normalizes paint without reconstructing geometry; `src/settings/` persists settings.
- Preserve source text, host renderer registrations, settings migration and lifecycle ownership.
  Keep conversion serialized; dispose owned roots, listeners, observers and scopes; discard stale results.
- Use the upstream converter and public Obsidian/Excalidraw APIs. Do not add Mermaid/AST parsers,
  layout reconstruction, private API patches or unsafe `any` casts.
- Preserve [SECURITY.md](SECURITY.md) input/resource guards, protected strict configuration and viewer
  boundary: editing, clipboard, drop, export, external navigation and editor dialogs stay restricted.
- Read [README.md](README.md) for supported behavior, [CONTRIBUTING.md](CONTRIBUTING.md) for
  setup/validation/release conventions, and [CHANGELOG.md](CHANGELOG.md) for implemented changes.
  [RELEASE_READINESS.md](RELEASE_READINESS.md) and [SCORECARD_TRIAGE.md](SCORECARD_TRIAGE.md)
  contain dated evidence; recheck live GitHub/Directory state before treating it as current.

## Start with the actual baseline

- For implementation/PR work, fetch current main and inspect conflicting PRs; check exact-main CI
  when relevant. Read the entire target Issue when present and inspect code before proposing changes.
- An OPEN Issue may already be implemented or released: audit commits, releases and acceptance
  first. Track applicable states separately: IMPLEMENTED, MERGED, RELEASED, DIRECTORY_VISIBLE,
  READY_TO_CLOSE, CLOSED. Require release/Directory evidence only when acceptance calls for it;
  neither an earlier state nor an old PR body's readiness claim proves a later state.
- For substantial work, use one dedicated worktree and focused branch/responsibility. Preserve
  other agents' changes; never reset/rebase their branches or alter their worktrees.
- A hypothesis is not a reproduced bug. Measure unchanged main with the same sanitized fixture
  before fixing appearance, chrome, fitting, popouts or upstream behavior.
- Verify APIs in installed types, then installed source, then official upstream sources/docs.
  Keep dependency pins; major upgrades and overrides need explicit task scope.
- For complex integration work, keep a short working plan: baseline, boundaries, acceptance,
  validation matrix/Native needs, risks, decisions and final evidence. Small tasks need no plan.

## Diagnose and prove the boundary

- For SVG defects, compare raw upstream output, normalized SVG and actual production rendering.
  Attribute behavior to Mermaid, converter or plugin integration before changing code. Document
  or block on upstream limitations; do not reconstruct geometry to disguise missing support.
- Correctness takes priority over scanner cleanliness. A scanner remediation needs baseline,
  behavior-equivalence/security evidence and affected window/lifecycle checks; counts are not proof.
- In DOM/window changes, check ownerDocument AND constructor realm, focus/active-window behavior,
  replacement and cleanup. Mocks must model measured host behavior, including adopted nodes.
- Bug regressions should fail on the exact broken production candidate and pass on the repair
  where feasible; record any gap. Candidate-only PASS does not prove the test detects the bug.
  Assert the accepted output, not just config/element counts; exclude unrelated ink in visual tests.

## Evidence has a type and a revision

| Evidence | Establishes only |
| --- | --- |
| Unit | Local logic under the stated stubs |
| Production-bundle browser | Real bundle behavior under the mocked host |
| Native Obsidian | Observed integration in the recorded host/environment |
| Physical hardware | The actual device/input behavior tested |
| GitHub CI | Checks for the identified SHA |
| GitHub Codex Review | Review of the identified SHA, not runtime acceptance |

- Never substitute one class for another. Record applicable SHA/artifact hashes, fixture,
  environment, method and limitations. Unavailable evidence is UNKNOWN; missing required acceptance
  blocks readiness, while optional unmeasured evidence does not become a new gate.
- When Native acceptance is required, use only a disposable synthetic Vault, record host version
  and exact installed artifact hashes, and test main window/popouts where relevant. Mocked-host
  browser results are not Native PASS; correctly targeted Native CDP can observe host integration,
  but synthetic/trusted CDP input does not establish physical hardware behavior.
- After repairs, repeat affected acceptance on the final artifact; reuse prior runtime evidence
  only when artifact hashes match and environment/fixture/acceptance remain applicable.
- For uncertain Native failures, verify window/renderer targeting and compare BASE vs CANDIDATE
  in the same environment/fixture. Candidate-only failure suggests regression; failure in both
  suggests existing host/upstream/tool behavior, not proof of its owner. Classify as
  PRODUCT_REGRESSION, TEST_HARNESS_BUG, HOST_BEHAVIOR, TOOLING_LIMITATION or UNKNOWN.

## Validate and hand back ownership

- Use CONTRIBUTING's validation policy and a fresh production build before browser tests.
- Before READY_TO_MERGE, require successful completed checks associated with current PR HEAD and
  required reviews of that HEAD (GitHub Codex when configured/requested). Record the tested merge SHA
  separately when applicable. Actionable unresolved threads = 0, behind main = 0, mergeable = true.
  HEAD changes invalidate old final CI/review evidence; rerun affected acceptance as above.
- If automatic Codex Review is configured, wait first; request `@codex review` only when the
  current HEAD lacks a review and no automatic review is pending. Report unavailable gates honestly.
- Without explicit user authorization, do not merge, enable auto-merge, close Issues, bump versions,
  tag or publish releases. READY_TO_MERGE is a handoff, not permission to merge.
- Keep private material private: never force-add ignored private files or publish personal notes,
  credentials, private screenshots/configuration/evidence or sensitive local paths. Use sanitized summaries.
- Keep this contract short: retain reusable risks, serious silent-regression guards and architecture
  invariants. Link canonical docs; omit current SHAs, counts, versions, incident narratives and workarounds.
