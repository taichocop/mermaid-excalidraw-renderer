# Mermaid Excalidraw Renderer 要件定義書

最終更新: 2026-10-07

## 1. システム概要

Obsidian Community Plugin として動作し、Markdown の `mermaid-excalidraw` コードブロックを Excalidraw 風 diagram に変換する。

## 2. 機能要件

### FR-001 コードブロック認識

`registerMarkdownCodeBlockProcessor("mermaid-excalidraw", ...)` を使用する。

**受入条件**
- Reading View で対象ブロックが認識される
- 通常の `mermaid` ブロックには影響しない

### FR-002 Mermaid → Excalidraw 変換

`@excalidraw/mermaid-to-excalidraw` の公開 API を利用する。

**受入条件**
- 独自 parser を実装しない
- upstream の型定義に従う
- `elements` と `files` を正しく扱う

### FR-003 Excalidraw 表示

変換結果を `@excalidraw/excalidraw` で描画する。

**受入条件**
- diagram 全体が表示領域に収まる
- 必要に応じて `scrollToContent()` 相当を利用する
- `files` があれば Excalidraw API へ追加する

### FR-004 Roughness

設定画面から Excalidraw の roughness を選択できる。

候補:
- 0: Clean
- 1: Architect
- 2: Artist

**デフォルト**: 1

### FR-005 Canvas height

Canvas の高さを設定できる。

- 範囲: 240〜1200px
- デフォルト: 600px

### FR-006 Canvas padding

図と viewport 端の余白を設定できる。

- 範囲: 16〜128px
- デフォルト: 32px

### FR-007 テーマ追従

Obsidian の Light / Dark Theme に追従する。

Light:
- 線: 黒
- 文字: 黒
- Canvas: Obsidian 背景になじむ

Dark:
- 線: 白
- 文字: 白
- Canvas: Obsidian 背景になじむ

### FR-008 エラー表示

不正な Mermaid が入力された場合、Plugin 全体を停止させず inline error を表示する。

**受入条件**
- エラー内容を text として安全に表示する
- console には詳細を残す
- raw HTML をユーザー入力から組み立てない

### FR-009 複数diagram

同一ノートに複数の `mermaid-excalidraw` が存在しても独立して動作する。

**受入条件**
- ID collision がない
- Root cleanup が行われる
- diagram 間で状態が混線しない

### FR-010 設定永続化

Obsidian の `loadData()` / `saveData()` を使用する。

## 3. 対応diagram

最低限:
- Flowchart
- Sequence
- Class
- ER
- State

upstream が SVG fallback できる種類については独自に拒否しない。

## 4. 非機能要件

### NFR-001 型安全性

- TypeScript error 0
- `any` の乱用禁止
- 可能な限り discriminated union / type guard を使用

### NFR-002 パフォーマンス

1ノート10〜20diagram程度を目標とする。

- diagramごとの不要な global listener を避ける
- async 完了後に unmounted DOM を触らない

### NFR-003 保守性

以下を分離する。

- Obsidian integration
- Mermaid conversion
- appearance normalization
- React rendering
- settings

### NFR-004 セキュリティ

- private API 非依存
- ユーザー入力を `innerHTML` へ直接投入しない
- Mermaid security setting を安全側に設定

### NFR-005 テーマ適合

Obsidian の CSS variables を可能な範囲で利用し、ハードコード色を最小化する。

## 5. 完了条件

- `npm install` 成功
- `npm run build` 成功
- TypeScript error 0
- Obsidian で Plugin load 成功
- Flowchart / Sequence / Class / ER / State の手動確認
- Dark / Light 双方で可読
- invalid Mermaid が inline error
- 10個以上のdiagramで致命的な問題なし
- ノート切替後に React Root が残らない

