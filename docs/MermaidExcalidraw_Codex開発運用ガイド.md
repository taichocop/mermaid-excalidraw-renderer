# Mermaid Excalidraw Renderer Codex開発運用ガイド

最終更新: 2026-10-08

## 1. Codexの役割

Codexには実装を任せるが、設計上の判断はこの資料群を制約として扱う。

## 2. 作業開始時に読むもの

1. 要件定義書
2. 基本仕様書
3. アーキテクチャ設計書
4. 技術仕様書
5. 対象Issue

## 3. 実装前チェック

Codexは変更前に以下を確認する。

- upstream `mermaid-to-excalidraw` の現在の型
- installed `@excalidraw/excalidraw` の型
- Obsidian API
- 既存 module の責務

APIを推測しない。

## 4. Issue単位で実装

1 Issue = 1つの明確な責務を推奨。

例:
- Markdown processor
- React lifecycle
- theme normalization
- roughness setting
- tests

巨大な一括PRを避ける。

## 5. 禁止事項

- Mermaid parser 自作
- upstream の変換ロジックコピー
- `any` 乱用
- private API 使用
- `main.ts` へのロジック集中
- 動作確認せず「完了」とする

## 6. 実装完了時の報告形式

Codexは以下を報告する。

```text
1. 変更概要
2. 変更ファイル
3. 設計上の判断
4. 実行したコマンド
5. build/test結果
6. 手動確認結果
7. 残課題
```

## 7. レビュー観点

人間側は「コードを書く」より以下を重視する。

- 要件逸脱
- 責務分離
- lifecycle
- 型安全性
- upstreamとの整合性
- 不要な独自実装
- 将来保守性

## 8. Stably Orca内の開発ワークフロー

Issue #7の対象は、Stably Orcaアプリ内で実装・独立レビュー・修正・検証を進める運用。既定モデルはユーザー指定の `gpt-6.1-sol`、Codex CLIは `0.161.0`。Issueごとに1 worktreeを用意して並列に進める。同じPRの修正・pushを担当するcontrollerは1つだけにする。

```text
Requirement
  ↓
Issue
  ↓
Stably Orca: Issue専用worktree / Codex実装session
  ↓
別のread-only Codex reviewer session
  ↓ 指摘を実装sessionへ戻す（修正は最大5回）
修正 → 独立再レビュー
  ↓
Build/Test
  ↓
PR → 最新HEADのReview / required CI確認
  ↓
Human merge
```

以下は、このプロジェクト用のローカルsetup hookとlauncherが既に設定されたStably Orca環境を前提とする。Git cloneだけではその環境は配布されない。

1. Stably Orcaで対象repositoryのGitHub Issueを選び、Issueを紐付けて新しいworktreeを作る。比較baseを確認し、1 Issueにつき1 worktreeを割り当てる。同PRを修正する既存session/controllerがあれば、担当を引き継いでから作業する。
2. worktreeのターミナルでsetup hookの正常終了を確認する。Node 24での依存準備（`npm ci --ignore-scripts`）と実装/reviewer launcherの配置が完了していることを確認する。`source .agent-local/env.sh && node --version` でNode 24を確認できる。setupが未設定または失敗した場合は管理担当へ戻す。手動setupが必要な環境では、管理担当が指定した既存のtrusted setup scriptを `bash "$LOCAL_SETUP_SCRIPT"` で実行する。設定・認証をGit経由でコピーしない。
3. 対象worktreeのターミナルから `bash .agent-local/coder.sh` で実装sessionを開始する。Codexの `/status` で対象worktree・`gpt-6.1-sol`・`workspace-write`・`on-request` を確認してから、Issueの目的・scope・受入条件・テストを渡す。
4. 同じworktreeの別ターミナルで `bash .agent-local/reviewer.sh` を開始する。別sessionであることと、`/status` の対象worktree・モデル・`read-only`・`never` を確認する。ReviewerへIssue、比較baseのfull SHA、実際のdiff（例: `git diff "$BASE_SHA"`、`BASE_SHA` は確認済みbase）、新規ファイル、受入条件、検証コマンドと実行結果を渡す。設定値や秘密を渡さない。実装担当のself reviewだけで独立レビュー済みとしない。
5. Reviewerの指摘をpath/line・理由とともに実装sessionへ戻し、修正後のdiffと検証結果を同じ独立reviewer sessionへ渡す。修正は最大5回とし、収束しなければ証拠と残件を残して人間へ戻す。
6. browser担当へ対象worktree・検証対象HEAD/diff・必要なテストを引き継ぎ、他Issueのbrowser検証の終了を確認して直列に実行する。担当者から結果を受け取り、未実行項目を明記してPR担当へ渡す。PR担当は最新HEADのReview/CIを確認し、人間がmergeする。

検証は対象worktreeの `package.json` にあるlint・typecheck・unit・release・buildを実行する。browser検証は共有ポートを使うためIssue間で直列化し、担当者と完了を確認してから実行する。未実行の検証は成功扱いにしない。PRには検証対象のHEAD、レビュー結果、実行結果と残件を記録する。merge・tag・release公開・Directory申請・法的同意は人間が判断・実行する。

Stably Orca（GUI/worktree/session管理）とVirtusLab Orca（Scala Flow/CLI）は別製品。汎用Harnessのlive executor・署名付きformal Review・READY認定の開発はIssue #7の必須条件に含めない。この手動運用のレビューやCI成功をHarnessの正式READY証明として扱わない。

設定・認証・Hermes/Orcaのruntime・履歴はローカルに保持し、GitやPRへ公開しない。Git ignoreは追跡済みファイルや強制追加を防がないため、commit前に `git diff --cached --name-only` とdiffを確認する。操作環境の設定値やログを文書へ転記しない。旧Actions方式の扱いは[ADR-020](MermaidExcalidraw_ADR_設計判断記録.md#adr-020-stably-orca内の運用を採用し旧actions方式を保管する)を参照。

## 9. Codex向け短縮プロンプト

```text
このIssueを実装してください。
実装前に docs/ の要件定義書・基本仕様書・技術仕様書・アーキテクチャ設計書を読み、既存設計を優先してください。

APIは推測せず、node_modules の型定義と upstream repository を確認してください。
Mermaid parser/renderer の独自実装は禁止です。
any の乱用は禁止です。

実装後に build、typecheck、関連testを実行し、変更ファイル・判断理由・検証結果・残課題を報告してください。
```
