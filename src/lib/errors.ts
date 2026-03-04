export interface UiError {
  title: string;
  detail: string;
}

function stringifyError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === 'string') {
    return error;
  }

  return '不明なエラーが発生しました。';
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

export function describeGitError(error: unknown, fallbackTitle: string): UiError {
  const raw = stringifyError(error);
  const message = normalizeWhitespace(raw);

  if (/failed to push some refs/i.test(message) || /non-fast-forward/i.test(message)) {
    return {
      title: 'Push が拒否されました',
      detail: `${message} リモートとの差分を取り込み、競合解消後に再実行してください。`
    };
  }

  if (/would be overwritten by checkout/i.test(message)) {
    return {
      title: '未コミット変更が衝突しています',
      detail: `${message} 先に stage / commit / stash してから checkout してください。`
    };
  }

  if (/nothing to commit/i.test(message)) {
    return {
      title: 'コミット対象がありません',
      detail: message
    };
  }

  if (/merge conflict|conflict/i.test(message)) {
    return {
      title: '競合が発生しました',
      detail: `${message} 競合を解消してから再実行してください。`
    };
  }

  if (/not a git repository/i.test(message)) {
    return {
      title: 'Gitリポジトリではありません',
      detail: message
    };
  }

  return {
    title: fallbackTitle,
    detail: message || fallbackTitle
  };
}
