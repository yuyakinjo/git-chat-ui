# Diff Split View Plan

## Spec

- [x] unified diff 文字列をフロントエンドでパースし、file / hunk / line 単位の構造に変換する
- [x] commit detail と branch diff detail の両方で共通利用できる split diff viewer を追加する
- [x] 左右 2 カラムの split view にし、削除行は左、追加行は右、コンテキスト行は両側に表示する
- [x] add / delete / hunk / file header を強い配色で視認しやすくする
- [x] 既存の changed files サマリーと diff truncation 表示は維持する
- [x] 横幅が狭いときは 1 カラムにフォールバックし、スクロール不能や崩れを避ける

## Implementation

- [x] diff viewer 用の型と parser を追加する
- [x] split diff viewer コンポーネントを追加する
- [x] `CommitDetailPanel` に新 viewer を組み込む
- [x] `BranchDiffDetailPanel` に新 viewer を組み込む
- [x] global style に diff viewer の色とレイアウトを追加する

## Verification

- [x] `bun run test`
- [x] `bun run build`
- [x] 実画面で split view と色が崩れないことを確認する

## Review

- `http://127.0.0.1:4173/` で `git-chat-ui` リポジトリを開き、Commit Detail の Diff セクションが左に changed files、右に split diff を表示することを確認
- add/delete の色が dark surface 上で明確に分かれ、モバイル幅では 1 カラムに落ちる CSS を追加
- parser 単体テストで modified / added / renamed の diff を検証
