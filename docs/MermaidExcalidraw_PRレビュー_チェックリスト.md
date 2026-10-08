# Mermaid Excalidraw Renderer PRレビュー チェックリスト

最終更新: 2026-10-07

## 要件

- [ ] Issueの受入条件を満たしている
- [ ] MVP外の変更を勝手に追加していない
- [ ] 既存仕様との矛盾がない

## 設計

- [ ] `main.ts` に責務が集中していない
- [ ] Mermaid parserを再実装していない
- [ ] appearance / renderer / integrationが分離されている
- [ ] diagram local state が適切

## TypeScript

- [ ] TypeScript error 0
- [ ] `any` の乱用なし
- [ ] 型assertionが必要最小限
- [ ] upstream型を確認している

## Lifecycle

- [ ] React Rootがunmountされる
- [ ] async処理にcleanupがある
- [ ] note切替後にDOMを触らない
- [ ] event listener / observerを解除している

## UI

- [ ] Lightで読める
- [ ] Darkで読める
- [ ] Canvas heightが破綻しない
- [ ] 100% widthでpaneに収まる
- [ ] errorが安全に表示される

## Excalidraw

- [ ] elements変換がupstream想定に沿う
- [ ] filesを扱っている
- [ ] fit-to-contentが適切
- [ ] roughnessが型安全に適用される

## Security

- [ ] user sourceをinnerHTMLへ直接投入していない
- [ ] private APIを使用していない
- [ ] external script実行を導入していない

## Test

- [ ] build成功
- [ ] unit test成功
- [ ] Flowchart確認
- [ ] Dark/Light確認
- [ ] invalid Mermaid確認
- [ ] 複数diagram確認

## Documentation

- [ ] 仕様変更に合わせてdocsを更新した
- [ ] READMEを必要に応じて更新した
- [ ] Breaking changeならADR/CHANGELOGを更新した

