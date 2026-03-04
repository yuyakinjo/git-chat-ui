import { useEffect, useState } from 'react';

import { api } from '../lib/api';
import type { AppConfig, CommitGraphMode } from '../types';

interface ConfigViewProps {
  onNotify: (message: string) => void;
  config: AppConfig | null;
  onConfigSaved: (config: AppConfig) => void;
}

const MIN_REPOSITORY_SCAN_DEPTH = 1;
const MAX_REPOSITORY_SCAN_DEPTH = 8;

function normalizeDepth(value: number): number {
  if (!Number.isFinite(value)) {
    return 4;
  }

  return Math.min(Math.max(Math.round(value), MIN_REPOSITORY_SCAN_DEPTH), MAX_REPOSITORY_SCAN_DEPTH);
}

function applyConfigToState(config: AppConfig): {
  openAiToken: string;
  claudeCodeToken: string;
  commitGraphMode: CommitGraphMode;
  repositoryScanDepth: number;
} {
  return {
    openAiToken: config.openAiToken,
    claudeCodeToken: config.claudeCodeToken,
    commitGraphMode: config.commitGraphMode,
    repositoryScanDepth: normalizeDepth(config.repositoryScanDepth)
  };
}

export function ConfigView({ onNotify, config, onConfigSaved }: ConfigViewProps): JSX.Element {
  const [openAiToken, setOpenAiToken] = useState('');
  const [claudeCodeToken, setClaudeCodeToken] = useState('');
  const [commitGraphMode, setCommitGraphMode] = useState<CommitGraphMode>('detailed');
  const [repositoryScanDepth, setRepositoryScanDepth] = useState(4);
  const [loading, setLoading] = useState(config === null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!config) {
      return;
    }

    const next = applyConfigToState(config);
    setOpenAiToken(next.openAiToken);
    setClaudeCodeToken(next.claudeCodeToken);
    setCommitGraphMode(next.commitGraphMode);
    setRepositoryScanDepth(next.repositoryScanDepth);
    setLoading(false);
  }, [config]);

  useEffect(() => {
    if (config) {
      return;
    }

    let active = true;

    (async () => {
      try {
        const loadedConfig = await api.getConfig();
        if (!active) {
          return;
        }

        const next = applyConfigToState(loadedConfig);
        setOpenAiToken(next.openAiToken);
        setClaudeCodeToken(next.claudeCodeToken);
        setCommitGraphMode(next.commitGraphMode);
        setRepositoryScanDepth(next.repositoryScanDepth);
        onConfigSaved(loadedConfig);
      } catch (error) {
        if (active) {
          onNotify(error instanceof Error ? error.message : '設定を読み込めませんでした。');
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    })();

    return () => {
      active = false;
    };
  }, [config, onConfigSaved, onNotify]);

  const handleSave = async (): Promise<void> => {
    setSaving(true);
    try {
      const normalizedDepth = normalizeDepth(repositoryScanDepth);

      const response = await api.saveConfig({
        openAiToken,
        claudeCodeToken,
        commitGraphMode,
        repositoryScanDepth: normalizedDepth
      });

      const nextConfig = response.config ?? (await api.getConfig());
      onConfigSaved(nextConfig);
      setRepositoryScanDepth(normalizeDepth(nextConfig.repositoryScanDepth));
      setCommitGraphMode(nextConfig.commitGraphMode);

      onNotify('Config を保存しました。');
    } catch (error) {
      onNotify(error instanceof Error ? error.message : 'Config 保存に失敗しました。');
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="panel mx-auto h-full w-full max-w-3xl p-6">
      <div className="mb-4">
        <h2 className="text-2xl font-semibold text-ink">Config</h2>
        <p className="text-sm text-ink-soft">トークン、コミットグラフ表示、リポジトリ探索設定を管理します。</p>
      </div>

      {loading ? (
        <div className="text-sm text-ink-subtle">読み込み中...</div>
      ) : (
        <div className="space-y-5">
          <div className="grid gap-4 rounded-2xl border border-black/10 bg-white/65 p-4">
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-[0.08em] text-ink-subtle">
                Commit Graph Mode
              </label>
              <select
                className="input"
                value={commitGraphMode}
                onChange={(event) => setCommitGraphMode(event.target.value as CommitGraphMode)}
              >
                <option value="detailed">Detailed (分岐・合流レーン)</option>
                <option value="simple">Simple (簡易レーン)</option>
              </select>
            </div>

            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-[0.08em] text-ink-subtle">
                Repository Scan Depth
              </label>
              <input
                className="input"
                type="number"
                min={MIN_REPOSITORY_SCAN_DEPTH}
                max={MAX_REPOSITORY_SCAN_DEPTH}
                value={repositoryScanDepth}
                onChange={(event) => {
                  const next = Number(event.target.value);
                  if (Number.isFinite(next)) {
                    setRepositoryScanDepth(next);
                  }
                }}
                onBlur={() => setRepositoryScanDepth((current) => normalizeDepth(current))}
              />
              <p className="mt-1 text-xs text-ink-subtle">
                `$HOME` 以下の探索深さです（{MIN_REPOSITORY_SCAN_DEPTH} - {MAX_REPOSITORY_SCAN_DEPTH}）。
              </p>
            </div>
          </div>

          <div className="grid gap-4 rounded-2xl border border-black/10 bg-white/65 p-4">
            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-[0.08em] text-ink-subtle">
                OpenAI Token
              </label>
              <input
                className="input"
                placeholder="sk-..."
                value={openAiToken}
                onChange={(event) => setOpenAiToken(event.target.value)}
              />
            </div>

            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-[0.08em] text-ink-subtle">
                ClaudeCode Token
              </label>
              <input
                className="input"
                placeholder="cc-..."
                value={claudeCodeToken}
                onChange={(event) => setClaudeCodeToken(event.target.value)}
              />
            </div>
          </div>

          <button type="button" className="button button-primary" disabled={saving} onClick={handleSave}>
            {saving ? 'Saving...' : 'Save Config'}
          </button>
        </div>
      )}
    </section>
  );
}
