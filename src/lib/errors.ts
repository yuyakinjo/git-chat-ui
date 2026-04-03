export interface UiError {
  title: string;
  detail: string;
}

export function formatUiErrorForClipboard(error: UiError): string {
  const title = error.title.trim();
  const detail = error.detail.trim();

  if (!detail || detail === title) {
    return title;
  }

  return `${title}\n${detail}`;
}

function stringifyError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === "string") {
    return error;
  }

  return "不明なエラーが発生しました。";
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

export function describeGitError(error: unknown, fallbackTitle: string): UiError {
  const raw = stringifyError(error);
  const message = normalizeWhitespace(raw);

  if (
    /failed to log in to github\.com|gh auth login|token .* invalid|authentication failed/i.test(
      message,
    )
  ) {
    return {
      title: "GitHub CLI の認証が必要です",
      detail: `${message} gh auth login で再認証してから再実行してください。`,
    };
  }

  if (/pull request .*already exists|already exists.*pull request/i.test(message)) {
    return {
      title: "Pull Request は既に存在します",
      detail: message,
    };
  }

  if (/origin remote is not configured|no such remote ['"]?origin['"]?/i.test(message)) {
    return {
      title: "origin remote が見つかりません",
      detail: `${message} origin を設定してから再実行してください。`,
    };
  }

  if (/failed to push some refs/i.test(message) || /non-fast-forward/i.test(message)) {
    return {
      title: "Push が拒否されました",
      detail: `${message} リモートとの差分を取り込み、競合解消後に再実行してください。`,
    };
  }

  if (
    /no upstream branch/i.test(message) ||
    /has no upstream branch/i.test(message) ||
    /there is no tracking information for the current branch/i.test(message)
  ) {
    return {
      title: "upstream branch が未設定です",
      detail: `${message} branch の tracking 設定を追加してから pull してください。`,
    };
  }

  if (/not possible to fast-forward, aborting/i.test(message)) {
    return {
      title: "fast-forward で pull できません",
      detail: `${message} local branch と upstream が分岐しています。merge か rebase で揃えてください。`,
    };
  }

  if (
    /would be overwritten by checkout/i.test(message) ||
    /would be overwritten by merge/i.test(message)
  ) {
    return {
      title: "未コミット変更が衝突しています",
      detail: `${message} 先に stage / commit / stash してから再実行してください。`,
    };
  }

  if (
    /cannot delete branch .*checked out/i.test(message) ||
    /branch is currently checked out/i.test(message)
  ) {
    return {
      title: "現在 checkout 中の branch は削除できません",
      detail: message,
    };
  }

  if (/a branch named .* already exists|local branch .* already exists/i.test(message)) {
    return {
      title: "同名の branch は既に存在します",
      detail: `${message} 別の名前で作成してください。`,
    };
  }

  if (/not a valid branch name|newbranch must be different from basebranch/i.test(message)) {
    return {
      title: "branch 名が不正です",
      detail: `${message} 別の branch 名を指定してください。`,
    };
  }

  if (/default branch .* cannot be deleted/i.test(message)) {
    return {
      title: "デフォルト branch は削除できません",
      detail: message,
    };
  }

  if (/branch .* is not fully merged/i.test(message) || /not fully merged/i.test(message)) {
    return {
      title: "未マージのため削除できません",
      detail: `${message} 先に merge するか、意図的に消すなら force delete を選択してください。`,
    };
  }

  if (/nothing to commit/i.test(message)) {
    return {
      title: "コミット対象がありません",
      detail: message,
    };
  }

  if (/no staged changes are available for commit message generation/i.test(message)) {
    return {
      title: "ステージ済みの変更がありません",
      detail:
        "コミット文生成は stage 済みの変更だけを対象にします。先に stage してから再実行してください。",
    };
  }

  if (/no ai provider is configured for commit message generation/i.test(message)) {
    return {
      title: "AI token が未設定です",
      detail: "Config で OpenAI か Claude Code token を設定してから再実行してください。",
    };
  }

  if (/commit message generation failed for /i.test(message)) {
    return {
      title: "AI でコミット文を生成できませんでした",
      detail: `${message} token とネットワーク状態を確認して再実行してください。`,
    };
  }

  if (/merge conflict|conflict/i.test(message)) {
    return {
      title: "競合が発生しました",
      detail: `${message} 競合を解消してから再実行してください。`,
    };
  }

  if (/not a git repository/i.test(message)) {
    return {
      title: "Gitリポジトリではありません",
      detail: message,
    };
  }

  return {
    title: fallbackTitle,
    detail: message || fallbackTitle,
  };
}
