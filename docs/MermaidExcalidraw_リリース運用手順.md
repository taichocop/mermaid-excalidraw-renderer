# Mermaid Excalidraw Renderer リリース運用手順

最終更新: 2026-10-08

## 1. 公開基準

現在の正式申請は [Community DirectoryのWebフォーム](https://docs.obsidian.md/Plugins/Releasing/Submit%20your%20plugin)。旧 obsidian-releases へのPR方式は使わない。[提出チェックリスト](COMMUNITY_SUBMISSION.md) と root の RELEASE_READINESS.md を確認する。

初回版は0.1.0。公開前はCHANGELOGのUnreleasedとして扱い、実際のRelease公開時に日付を確定する。既存の公開tag/releaseは上書きせず、新しいpatch版を使う。

## 2. Versionと対応環境

manifest.json、package.json、package-lock.json（rootを含む）、versions.jsonを一致させる。tagはx.y.zのみ、v prefixなし。IDは変更しない。

minAppVersionは1.14.4。使用API自体は古い公開APIだが、今回のproduction bundleでnative acceptanceを完了した現行版を初回のサポート下限とする。1.13.7には過去の実機確認記録があるものの今回の候補で再検証していないため、対応下限には採用しない。下限を下げる場合は対象版で最終配布物を検証する。

実行ソースはNode/Electron APIを使わない。API上のモバイル対応可能性と実機検証は別であり、初回版はdesktop onlyを維持する。falseへの変更はモバイル実機検証とREADME更新を伴う。

## 3. 検証と成果物

Node.js 22.13以上の22系、または24以上とnpm 10以上を使う。

```sh
npm ci
npm run lint
npm test
npm run test:release
npm audit
npm audit --omit=dev
npm run build
npm run test:browser
```

Chromiumを使う場合は事前に `npx playwright install chromium`、実行時に `PLAYWRIGHT_CHANNEL=chromium` を指定する。

buildはmetadata整合、型、配布物、external import（obsidianのみ）、フォント同梱、ライセンス、source map不在を検査する。dist/mermaid-excalidraw-renderer/には main.js、manifest.json、styles.css、LICENSE、THIRD_PARTY_NOTICES.txt、SHA256SUMS.txt を含む。Obsidianが自動取得する3ファイルだけでもライセンスはmain.js内に含まれる。

## 4. 実機確認

本番配布物からclean installしてPlugin enable、Flowchart/Sequence、Class/ER/StateのSVG fallback、Light/Dark、設定保存とreload、invalid Mermaid、複数図、ノート切替、disable/re-enableを確認する。最低対応版と現行stable、OS/installer、結果を監査記録に残す。ブラウザーテストと過去の実機確認を今回の実機確認と混同しない。

## 5. GitHub Release

レビュー済み変更をdefault branch mainへmergeする。正確なversion tagをpushすると release.yml が最初に完全な履歴（fetch-depth: 0）と最新のorigin/mainを取得し、tagがworkflowのcommitを指し、そのcommitがmain historyに含まれることを検証する。mainのHEADそのものに限定せず、main上の過去commitも許容する。未mergeのbranch上のtag、shallow履歴、不明なrefはfailする。このrepositoryのdefault branchはmainと確認済みであり、branch名を変更する場合はworkflowとsource validatorを合わせて更新する。

その後の全検証を通過した同一成果物からdraft releaseを作る。検証jobはread-only、draft作成jobのみcontents write。mainへのmergeとpublic publishはレビュー後の最終工程。

```sh
git tag 0.1.0 <reviewed-main-commit>
git push origin 0.1.0
```

Draftの更新は scripts/sync-draft-release.mjs が行う。expected asset名はbuild validatorと共有し、workflow内には複製しない。local directoryの完全一致・SHA256SUMSの全entry・source manifestとの一致を検証し、GitHub APIの全pageから対象tagのReleaseとassetsを取得する。obsolete assetを削除し、同名でhash/size/stateが異なるものを置換する。既に一致しているassetは保持する。更新後に全pageを再取得し、名前集合と全ファイルのSHA-256・size・uploaded stateの完全一致を検証する。asset不足、余剰、hash不一致、API/Upload failureは必ずjobをfailさせ、読取failureを「Releaseなし」と解釈して新規作成しない。

対象tagのReleaseはdraftのみ操作する。各delete/upload/edit直前にも同じRelease ID/tagのdraft状態を再確認し、publishedなら新versionを要求して停止する。Publishedへのclobber/delete/editは行わない。GitHub APIは状態確認と更新をatomicにする仕組みを提供しないため、手動publishは必ずworkflow完了後に行い、実行中に同じDraftを操作しない。

CI結果、tagのcommit、添付ファイルのSHA-256、README開示、Release notesを確認してdraftをpublishする。published releaseへ同名assetを差し替えない。新versionで修正する。

Release回帰テストは実際の一時Git repositoryとoffline GitHub API fixtureを使用する。既存main ancestor/HEAD、annotated tag、unmerged branch、shallow history、Draftのobsolete/stale asset、Published保護、API/Upload/hash/集合不一致のfail-closedを検証する。APIのpaginationとdigestは [GitHub公式Release assets仕様](https://docs.github.com/en/rest/releases/assets) に従う。

## 6. 申請

[COMMUNITY_SUBMISSION.md](COMMUNITY_SUBMISSION.md) の値を使用する。default-branch HEADのmanifestとpublished release tag/添付manifestが一致していることが必須。Obsidian accountへのsign-in、GitHub link、owner選択、ポリシー/継続保守への同意、scanner結果はアカウント所有者が確認する。

## 7. Rollback

重大不具合をRelease notesに追記し、修正patchを公開する。ユーザーが手動で戻す場合は以前の同一Releaseから3ファイルをまとめて置き換え、Obsidianを再起動する。ノートのsourceは変更しない。
