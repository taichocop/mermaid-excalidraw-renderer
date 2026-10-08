# Mermaid Excalidraw Renderer ロードマップ

最終更新: 2026-10-07

## v0.1.0 MVP

- `mermaid-excalidraw` processor
- Flowchart / Sequence / Class / ER / State
- Excalidraw rendering
- roughness
- canvas height
- canvas padding
- Light / Dark
- inline error
- cleanup
- basic tests

## v0.2.x UX改善

- theme change 即時追従（0.1.0で実装済み）
- loading skeleton改善
- auto height option
- zoom上限/下限調整
- export PNG / SVG
- copy image

## v0.3.x Block options

例:

```text
mermaid-excalidraw roughness=2 height=720
```

候補:
- roughness
- height
- padding
- theme

## v0.4.x 標準Mermaid置換モード

Settings:

```text
Render standard ```mermaid blocks as Excalidraw
```

デフォルトOFF。

競合やfallbackを十分に検証してから実装する。

## v0.5.x Edit / Export

- click to open editor
- Mermaid source編集
- `.excalidraw.md` export
- Excalidraw file保存

## v1.0.0

安定条件:

- API安定
- settings migration
- mobile可否確定
- community feedback反映
- release automation
- ドキュメント整備

## 将来候補

- diagram cache
- per-note style preset
- Mermaid source formatter
- context menu
- SVG fallback style improvements（色正規化は実装済み）
- i18n

