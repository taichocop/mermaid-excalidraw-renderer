# Mermaid Excalidraw Renderer トラブルシューティング

最終更新: 2026-10-07

## Diagramが表示されない

確認順:

1. PluginがEnableか
2. code block名が `mermaid-excalidraw` か
3. Reading Viewか
4. Developer Consoleにerrorがないか
5. Mermaid sourceが正しいか

## `Mermaid diagram could not be rendered`

まず同じsourceを Mermaid Playground 等で検証する。

構文が正しい場合:
- upstream converter未対応
- Excalidraw変換失敗
- browser/DOM依存問題

を切り分ける。

## Dark themeで文字が見えない

確認:
- `resolveTheme()` の判定
- `--background-primary`
- foreground normalization
- text elementだけ色が残っていないか

## Roughnessが変わらない

確認:
- settings保存
- element typeがroughness対応か
- skeletonに適用しているかactual elementに適用しているか
- rerenderされているか

## Canvasが空白に見える

可能性:
- height 0
- scene update前にfit
- font未load
- generated elements empty

確認:
- container height
- elements count
- updateScene後の `scrollToContent`

## Note切替後にwarningが出る

典型:

```text
state update on unmounted component
```

対策:
- disposed flag
- async cleanup
- Root unmount

## 同じページで複数diagramが壊れる

確認:
- static DOM ID を使っていないか
- global singleton APIを持っていないか
- diagram local stateが共有されていないか

## Buildが通らない

優先して確認:

1. installed package version
2. node_modules の型
3. ESM/CJS mismatch
4. esbuild external設定
5. Obsidianをexternalにしているか

APIエラーを `as any` で回避せず、versionに合わせて修正する。

