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
bun run tauri:dev
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

## Codex thread task folders

Codex の thread ごとに `tasks/threads/<threadId>/todo.md` を持たせたい場合は、App Server の `thread/list` を使って現在の workspace に紐づく thread を見つけ、local task folder と同期できます。

前提:

- `codex` CLI が入っていること
- Codex thread の `cwd` がこの repo root になっていること

主要コマンド:

```bash
bun run codex:tasks:bootstrap
bun run codex:tasks:list
bun run codex:tasks:attach-latest
bun run codex:tasks:attach -- --thread-id thr_123
bun run codex:tasks:sync
bun run codex:tasks:watch -- --interval 15
```

運用:

- repo を開いた直後に `bun run codex:tasks:bootstrap` を実行すると、active thread の task folder 作成・archive 状態の同期・background watcher 起動をまとめて行える
- 新しい Codex thread を作ったら `bun run codex:tasks:attach-latest` で `tasks/threads/<threadId>/todo.md` を作成する
- `sync` / `watch` は既存 folder の移動だけでなく、local にまだない active thread の `tasks/threads/<threadId>/` も自動作成する
- `attach` / `attach-latest` は repo 専用の background watcher も起動し、以後は Codex app 側の archive / unarchive を local task folder へ自動反映する
- どの thread を紐付けるか明示したい場合は `bun run codex:tasks:list` で id を確認してから `attach` する
- thread をアーカイブした後は watcher が対応する folder を `tasks/archived/<threadId>/` へ移し、手動確認したい場合だけ `bun run codex:tasks:sync` を使う
- thread が active / archived のどちらの一覧にも出なくなった場合も、次回 `sync` / `watch` で `tasks/archived/<threadId>/` へ退避する
- background watcher を使わずに foreground で確認したい場合は `bun run codex:tasks:watch` を別ターミナルで常駐させる

注意:

- watcher は Codex app-server の thread lifecycle 通知を使って即時同期し、取りこぼしに備えて interval ごとの `thread/list` 再同期も併用する
- `.vscode/tasks.json` では `codex:tasks:bootstrap` を `runOn: folderOpen` で登録できる。VS Code では初回だけ automatic task の許可が必要
- `tasks/` は `.gitignore` 済みなので、thread task folder はローカル運用専用です

## 注意

- リポジトリ検出の深さは Config で変更できます（デフォルトは `$HOME` 深さ4）。
- 文字化け回避のため、差分表示は最大 25,000 文字で制限しています。
- macOS 版 Tauri 実行時のトークン保存は Keychain を優先し、保存成功時は設定ファイルへ平文保存しません。
