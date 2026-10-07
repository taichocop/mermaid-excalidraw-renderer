# Codex Reviewを処理するAgent Loop

Codex Code Reviewはリポジトリの既存の自動実行を利用する。Agent Loopはレビュー開始・再実行を要求せず、mergeもしない。レビュー投稿 → 解析 → 最大1回の修正 → validation → commit/push → `WAITING_FOR_REVIEW` → workflow終了。次のレビューは別runになる。

## 現時点のイベント確認状況

2026-10-08（日本時間）の初回調査では全状態のPR一覧は `[]` だった。その後、この変更のPR #1を作成し、既存の自動Codex Reviewが起動したことを確認した。Botは `chatgpt-codex-connector[bot]`、numeric IDは `199175422`。GitHub repository Events APIで取得した実際の `IssueCommentEvent`（ID `16686376118`、action `created`）は `tests/agent-loop/evidence/issue-comment-running.json` に保存した。comment ID `6048760861` のsummaryには対象commit `69ab44a` と **Running** が示されている。

ここまで確認できたのは開始summaryで、完了通知の形式はまだ確認中。Runningをレビュー完了とは扱わない。review submission / inline / 完了summaryの種別は、実際の投稿・payloadが揃うまで設定しない。

`codex-review-observer.yml` は候補の `pull_request_review` / `pull_request_review_comment` / `issue_comment` を観測するだけで、BotがPRへ投稿した実際の `GITHUB_EVENT_PATH` とイベント名を30日間artifactとして保存する。修正workflowは下記の実測設定が揃うまで何もしない。候補イベントの購読は検出用であり、Codex Reviewとみなして処理する設定ではない。

## 有効化

1. workflowsとcontrollerをdefault branchに導入する。
2. 通常の実装PRを作成し、既存の自動Codex Reviewが返るのを待つ（Actions内では待機しない）。Observerのartifactの `payload.json` と `metadata.json` を確認する。投稿URLからCodex本人の投稿であることも確認する。
3. repository variablesに次を設定する。
   - `CODEX_REVIEW_LOGIN`: 実際の `review.user.login` / `comment.user.login`。
   - `CODEX_REVIEW_USER_ID`: 同じBotのnumeric ID。`sender`も一致することを確認する。
   - `CODEX_REVIEW_EVENTS`: 実際に確認した処理可能なイベント名をカンマ区切りで設定。
   - `MAX_AGENT_ITERATIONS`: 任意。既定は5。
4. secretsを設定する。
   - `OPENAI_API_KEY`: Codex CLIの実行用。Codex ActionのAPI proxy経由で渡す。
   - `AGENT_LOOP_TOKEN`: 対象リポジトリへpushできるGitHub App installation tokenまたはfine-grained PAT。Contents writeが必要。期限切れ時には更新する。`GITHUB_TOKEN`だけのpushでは後続CIの自動実行が制限されるため使わない。
5. PRに `agent-loop` labelを付ける。設定より先にレビューが投稿済みの場合も、labelイベントまたはworkflow_dispatchの `pr_number` で現在HEADのレビューを取得できる。

この版は **submittedされたreviewのIDとcommit_idが確認できる形式** を処理する。`pull_request_review` の実測・設定が必須。Inlineイベントを確認した場合だけ `pull_request_review_comment` も設定する。コメント作成がreview submissionより先なら終了し、submissionイベントが全コメントを取得する。別々に到着しても同じreview IDを1回だけ処理する。

`issue_comment` は観測対象のみ。通常のissue commentにはreview ID・対象commit SHA・レビュー完了の証明がなく、本文の文字列や現在HEADを使って推測しない。実測結果がissue commentのみなら、保存payloadに基づく完了・SHAの紐付けアダプターが必要で、この版の修正処理は有効化できない。

## Stateとiteration

PRごとの `codex/agent-loop-state/pr-N` branchに `.agent-loop/state.json` を保存する。Contents APIのfile SHAによる競合検出と、全イベント共通のPR番号concurrencyを使う。`queue: max` は同じPRの複数イベントを直列化し、後続イベントによるpending runの置換を避ける。

最低限 `iteration` / `lastProcessedReviewId` / `lastProcessedHeadSha` / `state` を保持し、処理済みID集合、検証HEAD、解析snapshot、push前の予約commitも記録する。`lastProcessedHeadSha` は処理したreviewの対象SHAで、push後のHEADは `currentHeadSha` に記録する。

`iteration` は **検証済み修正commitのpushが成功した回数**。解析・CI確認・重複イベント・validation失敗では増えない。5回pushしても6回目のreviewは解析し、cleanなら人間へ渡せる。指摘が残れば `LOOP_LIMIT_REACHED` となり6回目の修正をしない。

主な状態:

- `WAITING_FOR_REVIEW`: 新しい自動レビューを待つ。runは終了済み。
- `ANALYZING` / `FIXING`: 現在のrunで解析・修正中。
- `PUBLISHING`: push前に予約commitと次iterationを保存済み。
- `WAITING_FOR_CI`: 指摘なし・ローカル検証済み。CI完了イベントで準備完了のみ再確認。
- `READY_FOR_HUMAN`: latest HEAD、CI green、build/typecheck/tests成功、未解決actionable findings 0。`agent-ready` labelあり。
- `INACTIVE`: label解除、draft化、closeなどで対象から外れたPR。再開時にも以前のready判定を再利用しない。
- `VALIDATION_FAILED`: ログ確認後、同じrunのrerunまたはworkflow_dispatchで復旧。
- `NEEDS_HUMAN`: 中断したpublicationの予約commitが現在HEADに見つからないなど、人間の確認が必要。
- `LOOP_LIMIT_REACHED`: 自動修正を停止。上限を変更するだけでは停止状態を解除しない。

push前後の中断は、次回起動時に予約SHAと現在HEADを照合する。成功済みpushなら1回だけ計数して `WAITING_FOR_REVIEW` へ戻す。予約commitが反映されていなければ二重pushを避けて `NEEDS_HUMAN` とする。状態branchの履歴とrun artifactから確認する。上限到達後の再開・publicationの手動復旧はstateの明示的な修正が必要。

## 解析・validation・完了

イベントのsenderと投稿authorのlogin / numeric ID / Bot型、`agent-loop` label、open / 非draft / 同repository PR、現在HEADをRESTから再取得して照合する。fork PRは修正対象外。古いcommitのreview、古いreview ID、処理済みIDは修正しない。

Codex CLIのread-only解析は最新HEADのreview summaryと、以前のreviewを含む未解決Codex inline threadsを全て分類する。`isOutdated`だけでは解決済みとみなさない。RESTでBotのimmutable IDを照合したthreadのみ使用する。全source IDの分類が揃わない場合は失敗する。actionableなsummaryも修正対象になる。

修正はworkspace-writeのCodex CLIを1回だけ実行し、workflow側で全finding IDの修正報告を照合する。CLIにcommit/push/GitHub操作を任せず、workflowが `npm ci`、lint、typecheck、unit/controller tests、build、Chromiumブラウザーテストを実行する。automation/controller/agent instructionsの変更は自動publishせず人間へ渡す。

固定した親SHAから1commitを作成し、expected remote SHAのleaseを指定してpushする。親SHAからの子commitであることを確認し、並行する人間のpushを上書きしない。validationとpushが成功したfindingのみthreadを解決する。レビュー再要求はしない。

clean判定もローカルvalidationが必須。現在HEADの `Validate plugin` PR runの成功、およびその他のCI checks/statusesをAPIで一度取得する。未完了/失敗なら `WAITING_FOR_CI` で終了する。CIのworkflow_run完了イベントでは解析snapshot・HEAD・validationを再確認し、追加の修正はしない。新しいHEAD、draft化、close、label解除で `agent-ready` を削除する。新規/編集されたfindingはsnapshot不一致で準備完了を拒否する。

制御コードはdefault branchから別ディレクトリへcheckoutし、PRは検証したSHAでcheckoutする。checkoutのcredentialsは永続化せず、GitHub write tokenはcontrollerのstepだけに渡す。Codex Actionはcommit固定・drop-sudo・API proxyを使用する。公開repoの任意PRを実行する仕組みではなく、maintainerが `agent-loop` を付けた同repository PRが対象。

## 検証

```sh
npm run test:agent-loop
npm run typecheck
npm run lint
npm run test
npm run build
npm run test:browser
```

イベント実測とsecrets設定後に、findingあり・clean・レビュー前/後にCI完了・summary/inlineの重複・stale HEAD・並行push・run中断のGitHub上での結合確認を行う。ローカルの模擬payloadを実際のCodex投稿の証拠として扱わない。

参考: [Codex非対話実行](https://learn.chatgpt.com/docs/non-interactive-mode)、[Codex Action](https://github.com/openai/codex-action)、[GitHub workflowの起動条件とtoken](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/trigger-a-workflow)、[PR concurrency queue](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/control-workflow-concurrency)。
