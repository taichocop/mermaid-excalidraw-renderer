# Mermaid Excalidraw Renderer Codex開発運用ガイド

最終更新: 2026-10-07

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

## 8. 推奨ワークフロー

```text
Requirement
  ↓
Issue
  ↓
Codex implementation
  ↓
Self review
  ↓
Build/Test
  ↓
Human review
  ↓
修正
  ↓
Merge
```

## 9. Codex向け短縮プロンプト

```text
このIssueを実装してください。
実装前に docs/ の要件定義書・基本仕様書・技術仕様書・アーキテクチャ設計書を読み、既存設計を優先してください。

APIは推測せず、node_modules の型定義と upstream repository を確認してください。
Mermaid parser/renderer の独自実装は禁止です。
any の乱用は禁止です。

実装後に build、typecheck、関連testを実行し、変更ファイル・判断理由・検証結果・残課題を報告してください。
```

