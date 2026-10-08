# Mermaid Excalidraw Renderer ADR / 設計判断記録

最終更新: 2026-10-07

## ADR-001 Mermaid converter を自作しない

**Status:** Accepted

### Decision

`@excalidraw/mermaid-to-excalidraw` を変換の唯一の中心ライブラリとする。

### Reason

- upstreamがdiagram解析を担当
- 新diagram対応を取り込みやすい
- 自作parserの保守コストを避ける

---

## ADR-002 MVPでは `mermaid-excalidraw` を使う

**Status:** Accepted

### Decision

Obsidian 標準 `mermaid` を上書きしない。

### Reason

- 標準rendererとの競合回避
- Plugin無効化時も既存ノートへ影響を与えにくい
- 問題切り分けが容易

---

## ADR-003 Mermaid source を source of truth にする

**Status:** Accepted

### Decision

MVPではExcalidraw elementをVaultへ保存しない。

### Reason

- Git diffが小さい
- AIが扱いやすい
- 同期対象を増やさない

---

## ADR-004 Obsidian Excalidraw Plugin に依存しない

**Status:** Accepted

### Decision

本Plugin単体でレンダリングする。

### Reason

- dependencyを減らす
- 利用ハードルを下げる
- API変更の影響範囲を減らす

---

## ADR-005 配色は白黒正規化を優先

**Status:** Accepted

### Decision

Light: black foreground
Dark: white foreground

### Reason

Mermaidの元色再現より、Obsidianテーマ上での可読性を優先する。

---

## ADR-006 React lifecycle は MarkdownRenderChild に紐付ける

**Status:** Accepted

### Decision

各diagramのRootを `MarkdownRenderChild.onunload()` でunmountする。

### Reason

Obsidianのnote lifecycleとReact lifecycleを一致させ、DOM leakを防ぐ。

---

## ADR-007 Canvas width は Auto / 100% を基本とする

**Status:** Accepted

### Decision

MVPでは固定width設定を持たない。

### Reason

Obsidianのpane幅に自然に追従させるため。


---

## ADR-008 公開版は検証済み対応範囲とfallbackを明示

**Status:** Accepted (release preparation, 2026-10-08); minimum version decision superseded by ADR-010

ID/name/versionは維持。minAppVersionは以前の1.5.0から実機確認記録のある1.13.7へ引き上げる。公開Obsidian APIの導入版だけでブラウザー/Excalidraw全体の互換性を保証しない。初回版はdesktop onlyを維持し、Node/Electron不要というコード監査結果とモバイル未検証を分けて記録する。

安全なMermaid 11.17.2を維持し、Class/ER/StateのSVG fallbackをREADMEで開示する。旧基本仕様の「fallbackを加工しない」は、既に動作する色のみ正規化する実装へ資料を整合する。構造・座標・フォントは変更せずparserも自作しない。実背景とのコントラストを固定のLight/Dark名より優先する。

## ADR-009 Release検証と正式提出経路

**Status:** Accepted (release preparation, 2026-10-08)

manifest/package/lock/versions/tagを検証し、production bundleのexternal importはobsidianのみとする。全テスト後の同一assetからdraft releaseを生成し、公開はreview後。初回Directory提出は現在の公式Webフォームに従い、default-branch HEADとpublished releaseを一致させる。旧PR提出経路は使わない。


## ADR-010 初回公開の対応下限を最終候補の実機検証版へ揃える

**Status:** Accepted (native acceptance, 2026-10-08)

minAppVersionとversions.jsonを1.14.4へ揃える。今回のproduction bundleでmacOS Obsidian 1.14.4のnative acceptance（主要5種のLight/Dark、設定保存/再ロード、20図、note切替、disable/re-enable）を完了した。1.13.7の過去の記録を今回の配布候補の検証結果とは扱わない。使用API自体の導入版は低いが、ブラウザー/フォント/Excalidrawまで含む初回版のサポート範囲は実測を優先する。古い版への対応を広げる場合は最終配布物で検証して下限を下げる。ID/name/plugin versionとdesktop-only方針は維持する。
