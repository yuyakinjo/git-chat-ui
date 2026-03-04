# Git Chat UI

Tauri + React + TypeScript + Tailwind で構成した Git GUI アプリの MVP 実装です。

## 実装済み機能

- Dashboard
  - `$HOME` 配下の Git リポジトリ自動検出
  - リポジトリ名フィルタリング
  - Recently Used を先頭表示

- Controller
  - Local / Remote ブランチ一覧
  - `/` 区切りブランチのフォルダ表示
  - ブランチ click で該当コミットへフォーカス
  - ブランチ double click で checkout
  - コミット一覧（50件ずつ無限スクロール）
  - コミット click で詳細表示
  - コミット double click で checkout
  - 5秒ポーリングによる更新検知（fingerprint）
  - `git add` / `unstage` / `stash` / `commit` / `push`
  - ファイルのドラッグ&ドロップによる stage / unstage / stash
  - AI タイトル生成（OpenAI, Claude API / フォールバックあり）

- Config
  - OpenAI / ClaudeCode トークン保存
  - Commit Graph 表示モード切り替え（`detailed` / `simple`）
  - Repository 探索深さの設定（デフォルト 4）

## 起動方法

```bash
bun install
bun run dev
```

Node/npm で実行する場合は `npm install && npm run dev` でも起動できます。

- Frontend: `http://localhost:1420`
- API: `http://localhost:4141`

## Tauri (macOS デスクトップ)

```bash
bun run tauri:dev
```

ビルド:

```bash
bun run tauri:build
```

Tauri 実行時は Rust の Tauri Command (`src-tauri/src/backend.rs`) を利用し、別 API プロセスは不要です。

## テスト

```bash
bun run test
```

## 注意

- リポジトリ検出の深さは Config で変更できます（デフォルトは `$HOME` 深さ4）。
- 文字化け回避のため、差分表示は最大 25,000 文字で制限しています。
- macOS 版 Tauri 実行時のトークン保存は Keychain を優先し、保存成功時は設定ファイルへ平文保存しません。
