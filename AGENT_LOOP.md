# Codex Review / Fix Agent Loop

ProductionとInteractiveは同じPR State machineを使う。PRの最新HEADに対するCodex Code Reviewの完了、current HEADの未解決actionable findings 0、検証とCIの成功を確認して `READY_TO_MERGE` にする。Merge・tag・release・Community Directory提出は人間が行う。

## State machine

```text
IDLE → IMPLEMENTING → VALIDATING → PUSHING
                                   ↓
                        WAITING_FOR_REVIEW_START
                                   ↓ current HEAD review starts
                           WAITING_FOR_REVIEW
                                   ↓ current HEAD review completes
                           PROCESSING_REVIEW
                       ┌───────────┴───────────┐
                   findings                 findings 0
                       ↓                       ↓
                     FIXING                 VALIDATING
                       ↓                       ↓
                   VALIDATING              WAITING_FOR_CI
                       ↓                       ↓ current HEAD CI green
                    PUSHING                READY_TO_MERGE
                       ↓
            WAITING_FOR_REVIEW_START
```

`WAITING_FOR_REVIEW_START` は最新HEADのreview開始が未確認、`WAITING_FOR_REVIEW` は最新HEADのRunningを確認済み。古いHEADのCompletedは現在の完了条件にならない。`BLOCKED` はmerge conflict・protected path・publication不整合等、`FAILED` は実行失敗、`LOOP_LIMIT_REACHED` は上限到達で指摘が残っている状態。label解除・draft化・closeは `IDLE` に戻す。

## 実測したGitHub review lifecycle

PR #1の実データを `tests/agent-loop/evidence/` に保存した。

- Bot login: `chatgpt-codex-connector[bot]`
- immutable user ID: `199175422`
- GitHub App ID: `1144995`、slug: `chatgpt-codex-connector`
- 実際の `IssueCommentEvent` の開始summary: comment `6048760861`、Running、commit `69ab44a`。
- 同じissue commentがCompletedへ編集される形式をRESTで実測。
- submitted PR review `5449597296` はfull `commit_id = 69ab44a59d41735dc7841978106be84deefeed20`。Inline comments 6件、うちP1 3件を実測。Completed summaryだけでfinding 0とは判断しない。

summaryはmarkerと実測table rowだけを解析する。短縮SHAはGitHub commit APIで一意なfull SHAに解決し、PR HEADと完全一致させる。Botのlogin・immutable ID・Bot型を確認し、`performed_via_github_app` が取得できる投稿ではApp ID/slugも照合する。summaryの説明欄や人間・他Botの投稿は完了証明にしない。

Runningが現在HEADのsubmitted reviewと同時に存在する場合も、Runningを優先して終了する。Completedまたはsubmittedの完了metadataを得たら、Reviews、Inline Comments、Review Threads、Issue Summaryをすべて取得する。対象はCodex本人、current HEAD、unresolved、not outdatedのfinding。以前のHEADのthreadは履歴/evidenceとして残し、現在のfindingに混ぜない。

## Production: event-driven resume

`.github/workflows/agent-loop.yml` はイベントを現在のPRへ紐付け、`agent-loop-iteration.yml` をdispatchする軽量入口。repair自体は行わない。

入口は実測したissue comment/review/inlineイベント、PR状態変更、CI workflow完了、external check/status、手動dispatch、15分間隔reconcile。reconcileはopt-in PRと待機・ready・中断状態だけを一度確認して終了する。

GitHub Actions自身が作ったcheck suiteやActionsに関連するHEADにはcheck_run/check_suiteイベントが発火しない制限がある。そのため既存 `Validate plugin` のworkflow_run、external status、15分の低頻度reconcileを併用し、他checkの終了を取りこぼしても永遠に待たない。`pull_request_review_thread`はGitHub App webhookでありActions triggerとしては未サポートなので購読せず、threadのresolve/unresolveもreconcileで確認する。

iteration workflowはPR番号をconcurrency keyにし、planからpublishまで全jobを直列化する。`queue: max` でsummary/inline/CIによるpending runの置換を避ける。1 run内のfix/pushは最大1回。review開始前/Running/CI pendingはState保存だけで終了し、次のイベントまたはreconcileで復元する。Productionにはreview待ちのsleep/pollingを置かない。

State更新はPRごとの `codex/agent-loop-state/pr-N` branchの `.agent-loop/state.json`。Contents APIのfile SHAでCASし、v1からschemaVersion 2へmigrationする。古いprocessed review IDやready snapshotだけでは新仕様の完了を認定しない。

## Fresh runnerのsecurity boundary

```text
trusted plan runner → immutable plan artifact
  ↓
read-only Codex analysis runner (Codex Actionが最後のstep)
  ↓ structured action output
fresh trusted decision runner
  ↓ immutable decided plan artifact
fresh Codex fix runner (Codex Actionが最後のstep)
  ↓ structured unified patch output
fresh trusted candidate runner
  ↓ candidate artifact
fresh validation runner (API key/push credentialなし)
  ↓ exact tree SHA / patch digest / validation artifact
fresh publishing runner (PR code/package scriptsを実行しない)
```

analysisとfixのdrop-sudo Actionを同じrunnerで繰り返さない。Action後にテスト・commit・pushしない。workspace、background process、Git設定を次runnerへコピーせず、構造化結果とpatchだけを渡す。

validationは指定HEADへpatchを適用し、lint/typecheck/tests/build/browserを実行する。変更が検証中に増えていないこととexact treeを確認する。publisherはfresh checkoutへ検証済みpatchを適用し、同じtree SHAを確認する。PRコードを実行しないpublisherだけがpush tokenを受け取る。Git hooks/fsmonitor/user configを無効化し、親HEADを確認し、expected remote SHAのlease付きで1commitをpushする。

workflow/controller/agent instructions/git設定等のprotected path変更は自動publishを拒否する。PR #1の制御コード変更は、このInteractiveの明示的な実装依頼として人間がレビュー可能なPRへ反映する。公開repoのfork PRは自動修正対象外。同repositoryのopen・non-draft・`agent-loop`付きPRのみ対象。

## Fingerprint / dedupe / stale plan

fingerprintにはfull HEAD、review ID/state/body、summaryの実測epoch/SHA/phase、current HEADのコメントID/body、discussion、threadのresolved/outdated状態を正規化してSHA-256へ含める。avatarやAPI取得時刻は含めない。

dedupe keyは `reviewId:headSha:fingerprint`。review IDが同じでも内容が変わったらreadyを無効化して再分析する。解析前、candidate作成前、validation後のcommit/push予約前、ready判定前にcontextを取り直す。HEAD、review completion、fingerprintが変われば `STALE_PLAN` として古いpatchのpushを拒否する。次のイベント/reconcileで再分析する。

thread resolveも本文/discussionのsource hashを再取得して照合する。編集されていたthreadは古い修正報告でresolveしない。

## Review request fallback

実測したPR #1ではpush後のHEAD `77f3d0b…` に対する自動reviewが開始されず、summaryは以前の `69ab44a…` の完了を示した。この運用に合わせ、今回の更新仕様13/14節に従って既定policyを `comment-fallback` とする。以前の「Agent Loopから要求しない」運用は、新仕様の限定fallbackへ更新する。

- `automatic-only`: 自動reviewを待つ。要求しない。
- `comment-fallback`: `REVIEW_START_GRACE_PERIOD_SECONDS`（既定420秒、7分）を過ぎてもcurrent HEAD reviewが未開始なら、現在HEAD/contextを取り直して `@codex review` を1回だけ投稿する。
- `manual`: grace後は `BLOCKED` と報告し、要求しない。

同HEADのRunning/Completed reviewが存在する間は要求しない。`reviewRequestHeadSha` / `reviewRequestAttempts` / `reviewRequestAt` を投稿前に永続化する。API deliveryが不明・失敗でも同HEADへ2回目を投稿しない。新HEADではcounterを0へ戻す。requestの送信自体をiterationに数えない。

## Interactive mode

人間がCodex CLI/sessionへ「PRをREADY_TO_MERGEまで」と依頼した場合、そのsessionが修正と検証を行い、30–60秒（既定45秒）でreview状態を確認できる。

```sh
node scripts/agent-loop/interactive.mjs --pr=1 --interval=45
node scripts/agent-loop/interactive.mjs --pr=1 --once --request-mode=automatic-only
```

既存の`gh`ログインをメモリ内で利用し、認証値を表示・artifact保存しない。monitorは同じState/backend/fallbackを利用し、completed reviewのcontextを呼び出し元Codex sessionへ返す。sessionが分析→修正→検証→pushを行い、再びmonitorを呼び出す。monitor自体はmerge/tag/releaseを行わない。timeoutは待機状態を保持して終了する。最大5回のReview→Fix→Pushに達して指摘が残れば停止する。

## Iteration / recovery

iterationは検証済みReview→Fix→Pushの成功回数。初期implementation、解析、重複イベント、request、CI再確認、validation失敗では増えない。既定 `MAX_AGENT_ITERATIONS=5`。5回目のpushへのfinal reviewがcleanなら認定できる。さらにactionableなら `LOOP_LIMIT_REACHED` で6回目のfixを止める。

push前にSHA・親SHA・context・次iterationを保存する。push成功後の中断は現在HEADと予約SHAを照合して一度だけ計数する。予約SHAが現在HEADに存在しなければ `BLOCKED` として人間が確認する。取り残されたrun leaseはrun completionを確認して再取得する。workflow_dispatchで任意のPRをreconcileできる。

## READY_TO_MERGE / invalidation

以下をすべて満たす場合のみagent-readyと完了summaryを付ける。

- open、non-draft、同repository、agent-loop labelあり、merge conflictなし。
- current HEAD === full reviewed HEAD、最新Codex Review completed。
- unresolved actionable Codex findings 0。severityに依存せず全sourceを分類済み。
- 同HEADのlint/typecheck/tests/build/browser検証成功、protected-path violationなし。
- 同HEADのValidate plugin PR run成功、required/その他CI checks/statuses green。
- iteration <= max。

CI workflowは安定したworkflow IDで識別し、pathを使う場合は`@ref`を除去する。必要checkを取得できないprotected branchは不明をgreenにしない。CI pending/failureは`WAITING_FOR_CI`に保存する。ready snapshotのHEAD/fingerprint/CI/mergeability/label変更はagent-readyを削除して適切な状態へ戻す。完了summaryは同じ認定snapshotにつき1回だけ投稿する。

## Production設定

human mergeでcontroller/workflowsをdefault branchへ導入してから稼働する。bootstrap時にdefault branchへcontrollerがなければdispatcherは成功終了する。

Repository variables: `CODEX_REVIEW_LOGIN` / `CODEX_REVIEW_USER_ID` / `CODEX_REVIEW_APP_ID`（既定は上記の実測identity）、`AGENT_LOOP_REVIEW_REQUEST_MODE`、`REVIEW_START_GRACE_PERIOD_SECONDS`、`MAX_AGENT_ITERATIONS`。

Secrets: `OPENAI_API_KEY`（Actionsの修正CLI用API proxy）、`AGENT_LOOP_TOKEN`（対象repoへpushできるApp/PAT token）。これらは既存の自動review開始設定とは別の、Productionの修正実行/push認証。Interactiveはこのsessionと既存ghログインで進められる。秘密値をチャット・ログ・artifactへ保存しない。

## 検証と一次資料

`npm run test:agent-loop` は実測payload、状態遷移、grace/1回制限、同ID/fingerprint更新、stale fix拒否、CI後続完了、ready無効化、runner境界を検証する。既存unit/browser/lint/typecheck/production buildも必須。

[Codex Action](https://learn.chatgpt.com/docs/github-action)、[pinned Action security guidance](https://github.com/openai/codex-action/blob/bdf19a4a223ec2549a3e2274a0cf61556bc07675/docs/security.md)、[GitHub workflow events](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows)、[workflow concurrency](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/control-workflow-concurrency)。actionlint v1.7.12は現行GitHubの`concurrency.queue`を未認識のため、その警告だけを除外し、公式schema/資料とYAMLで別途確認する。
