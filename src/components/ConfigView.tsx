import { AlertCircle, CheckCircle2, LoaderCircle } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { api } from '../lib/api';
import type { AiGenerationConfig, AiProvider, AppConfig, CommitGraphMode, TokenValidationResult } from '../types';

interface ConfigViewProps {
  onNotify: (message: string) => void;
  config: AppConfig | null;
  onConfigSaved: (config: AppConfig) => void;
  onAiGenerationConfigChange: (config: AiGenerationConfig) => void;
}

export type TokenValidationState = 'idle' | 'checking' | 'valid' | 'invalid';

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
  selectedAiProvider: AiProvider;
  commitTitlePrompt: string;
  commitGraphMode: CommitGraphMode;
  repositoryScanDepth: number;
} {
  return {
    openAiToken: config.openAiToken,
    claudeCodeToken: config.claudeCodeToken,
    selectedAiProvider: config.selectedAiProvider,
    commitTitlePrompt: config.commitTitlePrompt,
    commitGraphMode: config.commitGraphMode,
    repositoryScanDepth: normalizeDepth(config.repositoryScanDepth)
  };
}

function hasConfiguredToken(token: string): boolean {
  return token.trim().length > 0;
}

export function resolveSelectedAiProvider(
  currentProvider: AiProvider,
  openAiToken: string,
  claudeCodeToken: string
): AiProvider {
  const hasOpenAiToken = hasConfiguredToken(openAiToken);
  const hasClaudeCodeToken = hasConfiguredToken(claudeCodeToken);

  if (currentProvider === 'claudeCode' && !hasClaudeCodeToken && hasOpenAiToken) {
    return 'openAi';
  }

  if (currentProvider === 'openAi' && !hasOpenAiToken && hasClaudeCodeToken) {
    return 'claudeCode';
  }

  return currentProvider;
}

function useTokenValidation(
  token: string,
  validateToken: (token: string) => Promise<TokenValidationResult>
): TokenValidationState {
  const [validationState, setValidationState] = useState<TokenValidationState>('idle');
  const validationRequestIdRef = useRef(0);

  useEffect(() => {
    const normalizedToken = token.trim();
    validationRequestIdRef.current += 1;
    const requestId = validationRequestIdRef.current;

    if (!normalizedToken) {
      setValidationState('idle');
      return;
    }

    setValidationState('checking');
    let cancelled = false;

    const timer = setTimeout(() => {
      void (async () => {
        try {
          const result = await validateToken(normalizedToken);
          if (cancelled || validationRequestIdRef.current !== requestId) {
            return;
          }

          setValidationState(result.valid ? 'valid' : 'invalid');
        } catch {
          if (cancelled || validationRequestIdRef.current !== requestId) {
            return;
          }

          setValidationState('invalid');
        }
      })();
    }, 350);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [token, validateToken]);

  return validationState;
}

export function TokenValidationIndicator({
  providerName,
  validationState
}: {
  providerName: string;
  validationState: TokenValidationState;
}): JSX.Element | null {
  if (validationState === 'idle') {
    return null;
  }

  if (validationState === 'checking') {
    return (
      <span
        className="inline-flex items-center text-ink-subtle"
        role="status"
        aria-label={`${providerName} token is being validated`}
        title={`${providerName} token is being validated`}
      >
        <LoaderCircle size={16} className="animate-spin" aria-hidden="true" />
      </span>
    );
  }

  if (validationState === 'valid') {
    return (
      <span
        className="inline-flex items-center text-[var(--success)]"
        role="img"
        aria-label={`${providerName} token is valid`}
        title={`${providerName} token is valid`}
      >
        <CheckCircle2 size={16} strokeWidth={2.2} aria-hidden="true" />
      </span>
    );
  }

  return (
    <span
      className="inline-flex items-center text-red-500"
      role="img"
      aria-label={`${providerName} token is invalid`}
      title={`${providerName} token is invalid`}
    >
      <AlertCircle size={16} strokeWidth={2.2} aria-hidden="true" />
    </span>
  );
}

export function ConfigView({
  onNotify,
  config,
  onConfigSaved,
  onAiGenerationConfigChange
}: ConfigViewProps): JSX.Element {
  const [openAiToken, setOpenAiToken] = useState('');
  const [claudeCodeToken, setClaudeCodeToken] = useState('');
  const [selectedAiProvider, setSelectedAiProvider] = useState<AiProvider>('openAi');
  const [commitTitlePrompt, setCommitTitlePrompt] = useState('');
  const [commitGraphMode, setCommitGraphMode] = useState<CommitGraphMode>('detailed');
  const [repositoryScanDepth, setRepositoryScanDepth] = useState(4);
  const [loading, setLoading] = useState(config === null);
  const [saving, setSaving] = useState(false);
  const openAiTokenValidation = useTokenValidation(openAiToken, api.validateOpenAiToken);
  const claudeCodeTokenValidation = useTokenValidation(claudeCodeToken, api.validateClaudeCodeToken);

  useEffect(() => {
    if (!config) {
      return;
    }

    const next = applyConfigToState(config);
    setOpenAiToken(next.openAiToken);
    setClaudeCodeToken(next.claudeCodeToken);
    setSelectedAiProvider(resolveSelectedAiProvider(next.selectedAiProvider, next.openAiToken, next.claudeCodeToken));
    setCommitTitlePrompt(next.commitTitlePrompt);
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
        setSelectedAiProvider(resolveSelectedAiProvider(next.selectedAiProvider, next.openAiToken, next.claudeCodeToken));
        setCommitTitlePrompt(next.commitTitlePrompt);
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

  useEffect(() => {
    setSelectedAiProvider((current) => resolveSelectedAiProvider(current, openAiToken, claudeCodeToken));
  }, [claudeCodeToken, openAiToken]);

  useEffect(() => {
    if (loading) {
      return;
    }

    onAiGenerationConfigChange({
      openAiToken,
      claudeCodeToken,
      selectedAiProvider,
      commitTitlePrompt
    });
  }, [claudeCodeToken, commitTitlePrompt, loading, onAiGenerationConfigChange, openAiToken, selectedAiProvider]);

  const handleProviderCheckboxChange = (provider: AiProvider, checked: boolean): void => {
    if (checked) {
      setSelectedAiProvider(provider);
      return;
    }

    setSelectedAiProvider((current) => {
      if (current !== provider) {
        return current;
      }

      if (provider === 'openAi' && hasConfiguredToken(claudeCodeToken)) {
        return 'claudeCode';
      }

      if (provider === 'claudeCode' && hasConfiguredToken(openAiToken)) {
        return 'openAi';
      }

      return provider;
    });
  };

  const handleSave = async (): Promise<void> => {
    setSaving(true);
    try {
      const normalizedDepth = normalizeDepth(repositoryScanDepth);

      const response = await api.saveConfig({
        openAiToken,
        claudeCodeToken,
        selectedAiProvider,
        commitTitlePrompt,
        commitGraphMode,
        repositoryScanDepth: normalizedDepth
      });

      const nextConfig = response.config ?? (await api.getConfig());
      setOpenAiToken(nextConfig.openAiToken);
      setClaudeCodeToken(nextConfig.claudeCodeToken);
      setSelectedAiProvider(
        resolveSelectedAiProvider(nextConfig.selectedAiProvider, nextConfig.openAiToken, nextConfig.claudeCodeToken)
      );
      setCommitTitlePrompt(nextConfig.commitTitlePrompt);
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
              <div className="mb-1 flex items-center justify-between gap-3">
                <div className="text-xs font-semibold uppercase tracking-[0.08em] text-ink-subtle">OpenAI Token</div>
                <div className="flex items-center gap-3">
                  <TokenValidationIndicator providerName="OpenAI" validationState={openAiTokenValidation} />
                  <label className="flex items-center gap-1.5 text-[11px] font-medium text-ink-subtle">
                    <input
                      type="checkbox"
                      checked={selectedAiProvider === 'openAi'}
                      disabled={!hasConfiguredToken(openAiToken)}
                      onChange={(event) => handleProviderCheckboxChange('openAi', event.target.checked)}
                    />
                    使用
                  </label>
                </div>
              </div>
              <div>
                <input
                  className="input"
                  placeholder="sk-..."
                  value={openAiToken}
                  onChange={(event) => setOpenAiToken(event.target.value)}
                />
              </div>
            </div>

            <div>
              <div className="mb-1 flex items-center justify-between gap-3">
                <div className="text-xs font-semibold uppercase tracking-[0.08em] text-ink-subtle">Claude Code Token</div>
                <div className="flex items-center gap-3">
                  <TokenValidationIndicator providerName="Claude Code" validationState={claudeCodeTokenValidation} />
                  <label className="flex items-center gap-1.5 text-[11px] font-medium text-ink-subtle">
                    <input
                      type="checkbox"
                      checked={selectedAiProvider === 'claudeCode'}
                      disabled={!hasConfiguredToken(claudeCodeToken)}
                      onChange={(event) => handleProviderCheckboxChange('claudeCode', event.target.checked)}
                    />
                    使用
                  </label>
                </div>
              </div>
              <div>
                <input
                  className="input"
                  placeholder="cc-... / sk-ant-..."
                  value={claudeCodeToken}
                  onChange={(event) => setClaudeCodeToken(event.target.value)}
                />
              </div>
            </div>

            <div>
              <label className="mb-1 block text-xs font-semibold uppercase tracking-[0.08em] text-ink-subtle">
                Commit Title Prompt
              </label>
              <textarea
                className="input min-h-32 resize-y"
                placeholder="You are a Git assistant..."
                value={commitTitlePrompt}
                onChange={(event) => setCommitTitlePrompt(event.target.value)}
              />
              <p className="mt-1 text-xs text-ink-subtle">
                AIでタイトル生成を押したときの instruction です。空で保存すると既定プロンプトに戻ります。
              </p>
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
