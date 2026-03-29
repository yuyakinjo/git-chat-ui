import { GitBranch, Github, LayoutDashboard, Settings2, type LucideIcon } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import { ConfigView } from './components/ConfigView';
import { ControllerView } from './components/ControllerView';
import { DashboardView } from './components/DashboardView';
import { api } from './lib/api';
import type { AppConfig, Repository } from './types';

type Screen = 'dashboard' | 'controller' | 'config';

export default function App(): JSX.Element {
  const [screen, setScreen] = useState<Screen>('dashboard');
  const [query, setQuery] = useState('');
  const [repositories, setRepositories] = useState<Repository[]>([]);
  const [loadingRepositories, setLoadingRepositories] = useState(false);
  const [selectedRepository, setSelectedRepository] = useState<Repository | null>(null);
  const [selectedRepositoryGithubUrl, setSelectedRepositoryGithubUrl] = useState<string | null>(null);
  const [notice, setNotice] = useState<string>('');
  const [appConfig, setAppConfig] = useState<AppConfig | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    const params = new URLSearchParams(window.location.search);
    const repoPath = params.get('repoPath')?.trim();
    if (!repoPath) {
      return;
    }

    const repositoryName = repoPath.split('/').filter(Boolean).at(-1) ?? repoPath;
    setSelectedRepository({
      name: repositoryName,
      path: repoPath
    });

    if (params.get('screen') === 'controller') {
      setScreen('controller');
    }
  }, []);

  useEffect(() => {
    let active = true;

    (async () => {
      try {
        const config = await api.getConfig();
        if (active) {
          setAppConfig(config);
        }
      } catch (error) {
        if (active) {
          setNotice(error instanceof Error ? error.message : '設定の読み込みに失敗しました。');
        }
      }
    })();

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!selectedRepository) {
      setSelectedRepositoryGithubUrl(null);
      return;
    }

    let active = true;
    setSelectedRepositoryGithubUrl(null);

    void (async () => {
      try {
        const response = await api.getRepositoryGithubUrl(selectedRepository.path);
        if (active) {
          setSelectedRepositoryGithubUrl(response.url ?? null);
        }
      } catch {
        if (active) {
          setSelectedRepositoryGithubUrl(null);
        }
      }
    })();

    return () => {
      active = false;
    };
  }, [selectedRepository]);

  useEffect(() => {
    if (screen !== 'dashboard') {
      return;
    }

    let active = true;
    const timer = setTimeout(async () => {
      setLoadingRepositories(true);
      try {
        const response = await api.getRepositories(query);
        if (!active) {
          return;
        }
        setRepositories(response.repositories);
      } catch (error) {
        if (active) {
          setNotice(error instanceof Error ? error.message : 'リポジトリ一覧の取得に失敗しました。');
        }
      } finally {
        if (active) {
          setLoadingRepositories(false);
        }
      }
    }, 220);

    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [appConfig?.repositoryScanDepth, query, screen]);

  useEffect(() => {
    if (!notice) {
      return;
    }

    const timer = setTimeout(() => {
      setNotice('');
    }, 3000);

    return () => clearTimeout(timer);
  }, [notice]);

  const navItems = useMemo(
    () => [
      { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
      { id: 'controller', label: 'Controller', icon: GitBranch },
      { id: 'config', label: 'Config', icon: Settings2 }
    ] satisfies Array<{ id: Screen; label: string; icon: LucideIcon }>,
    []
  );

  return (
    <main className="app-shell">
      <div className="mb-3 flex items-center justify-between">
        <div className="panel flex items-center gap-2 p-1">
          {navItems.map((item) => {
            const Icon = item.icon;
            const active = screen === item.id;
            const disabled = item.id === 'controller' && !selectedRepository;
            return (
              <button
                key={item.id}
                type="button"
                disabled={disabled}
                onClick={() => setScreen(item.id)}
                className={`button ${active ? 'button-primary' : 'button-secondary'} !px-3`}
              >
                <span className="flex items-center gap-2">
                  <Icon size={14} />
                  {item.label}
                </span>
              </button>
            );
          })}
        </div>

        {selectedRepositoryGithubUrl ? (
          <a
            href={selectedRepositoryGithubUrl}
            target="_blank"
            rel="noreferrer"
            aria-label={`${selectedRepository?.name ?? 'Repository'} を GitHub で開く`}
            title={`${selectedRepository?.name ?? 'Repository'} を GitHub で開く`}
            className="button button-secondary flex h-10 w-10 items-center justify-center !rounded-full !p-0 text-[#24292f] shadow-sm hover:border-[rgba(0,113,227,0.22)] hover:text-[#0f172a]"
          >
            <Github size={16} />
          </a>
        ) : null}
      </div>

      <div className="h-[calc(100%-58px)]">
        {screen === 'dashboard' ? (
          <DashboardView
            repositories={repositories}
            query={query}
            loading={loadingRepositories}
            onQueryChange={setQuery}
            onSelectRepository={(repository) => {
              void api.markRecentRepository(repository.path);
              setSelectedRepository(repository);
              setScreen('controller');
            }}
          />
        ) : null}

        {screen === 'controller' && selectedRepository ? (
          <ControllerView
            repository={selectedRepository}
            appConfig={appConfig}
            onNotify={setNotice}
          />
        ) : null}

        {screen === 'config' ? (
          <ConfigView
            config={appConfig}
            onNotify={setNotice}
            onConfigSaved={(config) => {
              setAppConfig(config);
            }}
          />
        ) : null}
      </div>

      {notice ? (
        <div className="fixed bottom-4 left-1/2 z-50 w-fit -translate-x-1/2 rounded-full bg-[#111827] px-4 py-2 text-sm text-white shadow-lg">
          {notice}
        </div>
      ) : null}
    </main>
  );
}
