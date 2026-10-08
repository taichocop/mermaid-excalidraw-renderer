# Mermaid Excalidraw Renderer ADR / 設計判断記録

最終更新: 2026-10-08

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

---

## ADR-011 Codex Review待機を正式Stateとする

**Status:** Accepted (Agent Loop specification, 2026-10-08)

### Decision

未開始をWAITING_FOR_REVIEW_START、実測RunningをWAITING_FOR_REVIEWとして分ける。pushだけで開始・完了を仮定しない。

### Reason

review履歴、短いworkflow境界、失敗復旧と人間の最終判断を保つ。詳細は[Agent Loop運用設計](../AGENT_LOOP.md)。

---

## ADR-012 Productionはevent-drivenで待機する

**Status:** Accepted (Agent Loop specification, 2026-10-08)

### Decision

1 workflow最大1 iteration。待機stateを永続化して終了し、イベントと低頻度reconciliationで再開する。Actionsでreview待ちのsleep/pollingをしない。

### Reason

review履歴、短いworkflow境界、失敗復旧と人間の最終判断を保つ。詳細は[Agent Loop運用設計](../AGENT_LOOP.md)。

---

## ADR-013 Interactive Codex sessionではpollingを許容する

**Status:** Accepted (Agent Loop specification, 2026-10-08)

### Decision

人間が収束まで依頼したsessionは30–60秒でstatus確認し、Productionと同じState machineを用いる。

### Reason

review履歴、短いworkflow境界、失敗復旧と人間の最終判断を保つ。詳細は[Agent Loop運用設計](../AGENT_LOOP.md)。

---

## ADR-014 current HEADと一致するreviewのみ有効とする

**Status:** Accepted (Agent Loop specification, 2026-10-08)

### Decision

full reviewedHeadSha === currentHeadShaを完了/READYの必須条件とする。短縮SHAはAPIで一意に解決し、古いreviewを現在の判断に使わない。

### Reason

review履歴、短いworkflow境界、失敗復旧と人間の最終判断を保つ。詳細は[Agent Loop運用設計](../AGENT_LOOP.md)。

---

## ADR-015 未開始のreviewに限定したfallbackを許可する

**Status:** Accepted (Agent Loop specification, 2026-10-08)

### Decision

2026-10-08の更新仕様13/14節を採用。現在HEADのreview未開始かつgrace後だけ、comment-fallback policyで要求する。実測PR #1ではpush後も以前のHEADのsummaryが残ったため、既定は7分後fallbackとする。Running中は要求しない。

### Reason

review履歴、短いworkflow境界、失敗復旧と人間の最終判断を保つ。詳細は[Agent Loop運用設計](../AGENT_LOOP.md)。

---

## ADR-016 同HEADへの自動requestは最大1回

**Status:** Accepted (Agent Loop specification, 2026-10-08)

### Decision

reviewRequestHeadSha/Attempts/Atを投稿前に予約し、delivery不明でも再送しない。new HEADだけcounterをresetする。

### Reason

review履歴、短いworkflow境界、失敗復旧と人間の最終判断を保つ。詳細は[Agent Loop運用設計](../AGENT_LOOP.md)。

---

## ADR-017 review IDとfingerprintを併用してdedupeする

**Status:** Accepted (Agent Loop specification, 2026-10-08)

### Decision

HEAD、review/summary、comment body/discussion、thread stateのhashで判定する。同IDでも変化時は再評価し、fix中のcontext変更はpublish前に拒否する。

### Reason

review履歴、短いworkflow境界、失敗復旧と人間の最終判断を保つ。詳細は[Agent Loop運用設計](../AGENT_LOOP.md)。

---

## ADR-018 Codexとvalidation/publish runnerを分離する

**Status:** Accepted (Agent Loop specification, 2026-10-08)

### Decision

analysisとfixを別fresh runnerにし、各Actionを最後のstepにする。patch/structured resultだけをfresh validation runnerへ渡し、さらにfresh publisherでexact validated treeとreview fingerprintを照合する。background processをcredential-bearing runnerへ持ち込まない。

### Reason

review履歴、短いworkflow境界、失敗復旧と人間の最終判断を保つ。詳細は[Agent Loop運用設計](../AGENT_LOOP.md)。

---

## ADR-019 READY_TO_MERGEでもmergeは人間が行う

**Status:** Accepted (Agent Loop specification, 2026-10-08)

### Decision

agent-readyと認定summaryで完了を示す。merge/tag/release/Directory提出はAgent Loopから実行しない。HEAD/findings/CI/conflict/label変化でREADYを無効化する。

### Reason

review履歴、短いworkflow境界、失敗復旧と人間の最終判断を保つ。詳細は[Agent Loop運用設計](../AGENT_LOOP.md)。
