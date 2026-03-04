# PROJECT

## 概要
- `git-chat-ui` は Git 操作を GUI で行うためのデスクトップ向けアプリです。
- フロントエンドは React + TypeScript + Tailwind、デスクトップ実行は Tauri (Rust) を利用します。
- Web 開発時は `server/` の Node API、Tauri 実行時は `src-tauri/src/backend.rs` のコマンドを利用します。

## 主要機能
- リポジトリ検出と検索（Dashboard）
- ブランチ一覧、コミットグラフ、コミット詳細表示（Controller）
- `add / unstage / stash / commit / push / checkout` 操作
- AI によるコミットタイトル生成（OpenAI / Claude）
- 設定管理（トークン、コミットグラフモード、探索深さ）

## 主要ディレクトリ
- `src/`: React UI
- `src/components/`: 画面コンポーネント（`CommitGraph.tsx` など）
- `src/lib/`: フロント側ユーティリティ・レイアウト計算・API クライアント
- `server/`: Web 開発用 API（Node/Express）
- `src-tauri/`: Tauri アプリ本体（Rust バックエンド）

## 実行コマンド
- 開発起動: `bun run dev`
- Tauri 起動: `bun run tauri:dev`
- テスト: `bun test`
- 型チェック: `bun run typecheck`

## 変更時の確認ポイント
- UI 変更時は `bun run typecheck` を必ず実行
- `src-tauri/` 変更時は `cargo check` で Rust 側も確認
- コミットグラフ関連変更時は `src/lib/commitGraphLayout.test.ts` を確認
