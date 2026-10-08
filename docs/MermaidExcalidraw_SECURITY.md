# Mermaid Excalidraw Renderer SECURITY

最終更新: 2026-10-07

## 1. Security model

入力はVault内のMarkdownであり、必ずしも信頼できるとは限らない。

本Pluginは Mermaid source を diagram として解釈するが、任意JavaScriptを実行する仕組みは持たない。

## 2. 原則

- Mermaid security option は安全側
- sourceを `innerHTML` へ直接入れない
- error message は `textContent`
- Excalidraw / Mermaid の public API のみ使用
- external resource読み込みを不用意に許可しない
- secretsをsource/build artifactへ含めない

## 3. SVG fallback

upstream が生成するSVG fallbackについては、upstreamのsecurity modelを尊重する。

独自にSVG文字列を加工して unsafe HTML として挿入しない。

## 4. Link handling

将来的に node link 対応を追加する場合:

- `javascript:` 等の危険schemeを許可しない
- external linkは明示的に処理する

## 5. Dependency

Release前に dependency audit を確認する。

```bash
npm audit
```

ただし自動fixでbreaking updateを無条件適用しない。

## 6. Vulnerability report

公開後はREADMEまたはSECURITY.mdに報告方法を追記する。


## 2026-10-08 公開方針

報告窓口と実装に基づく脅威モデルはrootの [SECURITY.md](../SECURITY.md) を正とする。upstream外部画像/CSSによる通信可能性をREADMEで開示する。通常描画は同梱フォント/JSでoffline動作するが、strictをnetwork sandboxと扱わない。SVGは構造を変えず配色のみ正規化し、ホストDOMに挿入しない。
