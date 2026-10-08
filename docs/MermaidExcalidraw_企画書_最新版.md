# Mermaid Excalidraw Renderer 企画書

最終更新: 2026-10-07

## 1. 背景

Obsidian では Mermaid を利用して Markdown 内に図を記述できるが、標準の Mermaid レンダリングは SVG ベースであり、Excalidraw のような手書き風の見た目にはならない。

一方、`@excalidraw/mermaid-to-excalidraw` は Mermaid 定義を Excalidraw 要素へ変換できるため、Markdown の記述性と Excalidraw の視覚表現を組み合わせられる。

## 2. 目的

Markdown の Mermaid 記法だけで、Obsidian Reading View に Excalidraw 風の図を表示できる Community Plugin を提供する。

ユーザーは次のように記述するだけでよい。

````markdown
```mermaid-excalidraw
flowchart LR
  A[Idea] --> B[Mermaid]
  B --> C[Excalidraw]
```
````

## 3. 提供価値

- Mermaid のテキスト管理性を維持できる
- Excalidraw らしい視覚表現を得られる
- `.excalidraw` ファイルを別管理しなくても図を埋め込める
- Git diff が読みやすい
- AI / Codex が Mermaid を生成しやすい
- Obsidian テーマに追従して図を読みやすくできる

## 4. 想定ユーザー

- Obsidian で設計書や学習ノートを書く開発者
- Mermaid を日常的に利用しているユーザー
- Excalidraw の手書き風表現が好きなユーザー
- AI に図を生成させたいユーザー

## 5. MVP

### 含む

- `mermaid-excalidraw` コードブロックの認識
- Mermaid → Excalidraw 変換
- Reading View での表示
- Flowchart / Sequence / Class / ER / State 対応
- upstream が対応する SVG fallback の維持
- Light / Dark theme 追従
- Roughness 設定
- Canvas height / padding 設定
- エラー表示
- 複数diagram表示
- React cleanup

### 含まない

- Mermaid parser の独自実装
- Excalidraw 描画エンジンの独自実装
- Obsidian 標準 `mermaid` ブロックの強制上書き
- 図の直接編集機能
- `.excalidraw.md` 自動生成
- 共同編集
- クラウド同期機能

## 6. 成功条件

MVP 成功条件は以下。

- インストール後、サンプル Mermaid が Excalidraw 風に表示される
- Dark / Light の双方で文字と線が読める
- 1ノート10〜20個の図でも致命的な遅延やリークがない
- Mermaid 構文エラーが Plugin 全体を壊さない
- `npm run build` と TypeScript typecheck が成功する

## 7. プロダクト原則

1. **Mermaid を source of truth にする**
2. **upstream を再実装しない**
3. **Obsidian に自然に馴染む**
4. **見た目より可読性を優先する**
5. **複雑化する前に MVP を成立させる**

