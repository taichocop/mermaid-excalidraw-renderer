# Mermaid Excalidraw Renderer 資料INDEX

最終更新: 2026-10-07

## プロジェクト概要

Obsidian の Markdown コードブロックに記述した Mermaid を `@excalidraw/mermaid-to-excalidraw` で Excalidraw 要素へ変換し、Obsidian の Reading View 上で Excalidraw 風に表示する Community Plugin。

MVP では `mermaid-excalidraw` コードブロックを使用し、Obsidian 標準の `mermaid` レンダラーとは競合させない。

## ドキュメント一覧

| ファイル | 目的 | 主な読者 |
|---|---|---|
| `MermaidExcalidraw_企画書_最新版.md` | なぜ作るか、対象ユーザー、MVP範囲 | オーナー / 開発者 |
| `MermaidExcalidraw_要件定義書_最新版.md` | 機能・非機能要件と受入条件 | オーナー / Codex |
| `MermaidExcalidraw_基本仕様書_最新版.md` | 実際の操作・設定・画面挙動 | 開発者 / テスター |
| `MermaidExcalidraw_技術仕様書_最新版.md` | API・型・モジュール・データフロー | 開発者 / Codex |
| `MermaidExcalidraw_アーキテクチャ設計書.md` | 責務分離、ライフサイクル、設計原則 | 開発者 / レビュアー |
| `MermaidExcalidraw_テスト計画書.md` | Unit / Integration / Manual テスト | テスター / Codex |
| `MermaidExcalidraw_Codex開発運用ガイド.md` | Agent 駆動開発のルール | Codex / レビュアー |
| `MermaidExcalidraw_ADR_設計判断記録.md` | 重要な設計判断と理由 | 将来の保守担当 |
| `MermaidExcalidraw_リリース運用手順.md` | build / version / release 手順 | メンテナ |
| `MermaidExcalidraw_ロードマップ.md` | MVP以降の拡張順序 | オーナー / 開発者 |
| `MermaidExcalidraw_SECURITY.md` | セキュリティ方針 | 開発者 / レビュアー |
| `MermaidExcalidraw_トラブルシューティング.md` | よくある不具合と切り分け | 開発者 / 利用者 |
| `MermaidExcalidraw_PRレビュー_チェックリスト.md` | PRレビュー観点 | レビュアー / Codex |

## まず読む順番

新規実装時は次の順で読む。

1. 企画書
2. 要件定義書
3. 基本仕様書
4. アーキテクチャ設計書
5. 技術仕様書
6. Codex開発運用ガイド
7. テスト計画書

## 現在のMVP方針

- TypeScript
- Obsidian Plugin API
- React / `react-dom/client`
- `@excalidraw/excalidraw`
- `@excalidraw/mermaid-to-excalidraw`
- esbuild
- コードブロック名: `mermaid-excalidraw`
- Mermaid parser / renderer を独自実装しない
- 既存の Obsidian Excalidraw Plugin に依存しない
- ライトテーマでは黒を前景色、ダークテーマでは白を前景色として可読性を優先
- Roughness / Canvas height / Canvas padding を設定可能にする
- React Root は `MarkdownRenderChild` に紐付けて必ず cleanup する


## Repository root に置く資料

実装リポジトリでは、以下は `docs/` ではなく root 配置を推奨する。

- `README.md` — プロジェクト概要・導入・使用例
- `CONTRIBUTING.md` — 開発参加ルール
- `CHANGELOG.md` — リリース差分
- `LICENSE` — 公開前にライセンスを確定して追加

