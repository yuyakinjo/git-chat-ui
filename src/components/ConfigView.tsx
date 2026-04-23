import { AlertCircle, CheckCircle2, ChevronDown, Eye, EyeOff, LoaderCircle } from "lucide-react";
import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type JSX,
  type KeyboardEvent,
} from "react";

import { api } from "../lib/api";
import { DEFAULT_COMMIT_TITLE_PROMPT, DEFAULT_OPENAI_MODEL } from "../lib/commitTitlePrompt";
import {
  buildOpenAiModelOptions,
  filterOpenAiModelOptions,
  resolveListboxScrollTop,
} from "../lib/openAiModelCombobox";
import type {
  AiGenerationConfig,
  AiProvider,
  AppConfig,
  CommitGraphMode,
  CommitGraphStyle,
  CommitMergeAnimation,
  DiffViewerMode,
  OpenAiModelsResponse,
  TokenValidationResult,
} from "../types";

export {
  buildOpenAiModelOptions,
  filterOpenAiModelOptions,
  resolveListboxScrollTop,
} from "../lib/openAiModelCombobox";

interface ConfigViewProps {
  onNotify: (message: string) => void;
  config: AppConfig | null;
  onConfigSaved: (config: AppConfig) => void;
  onAiGenerationConfigChange: (config: AiGenerationConfig) => void;
}

export type TokenValidationState = "idle" | "checking" | "valid" | "invalid";

const MIN_REPOSITORY_SCAN_DEPTH = 1;
const MAX_REPOSITORY_SCAN_DEPTH = 8;
const COMMIT_TITLE_PROMPT_TEXTAREA_MIN_HEIGHT_PX = 128;
const MERGE_NODE_PREVIEW_SIZE_PX = 14;
const MERGE_NODE_PREVIEW_COLOR = "var(--accent)";

const MERGE_NODE_ANIMATION_OPTIONS: ReadonlyArray<{
  value: CommitMergeAnimation;
  label: string;
}> = [
  { value: "none", label: "None (オフ)" },
  { value: "pulse", label: "Pulse (合流パルス)" },
  { value: "ripple", label: "Ripple (リング波紋)" },
  { value: "orbit", label: "Orbit (周回)" },
  { value: "shimmer", label: "Shimmer (色シマー)" },
  { value: "metaball", label: "Metaball (有機融合)" },
  { value: "morph", label: "Morph (形状変化)" },
  { value: "dissolve", label: "Dissolve (ディゾルブ)" },
  { value: "particle", label: "Particle (パーティクル集束)" },
];

type MergeNodeRingAnimation = Exclude<CommitMergeAnimation, "none" | "pulse">;

function normalizeDepth(value: number): number {
  if (!Number.isFinite(value)) {
    return 4;
  }

  return Math.min(
    Math.max(Math.round(value), MIN_REPOSITORY_SCAN_DEPTH),
    MAX_REPOSITORY_SCAN_DEPTH,
  );
}

function applyConfigToState(config: AppConfig): {
  openAiToken: string;
  openAiModel: string;
  claudeCodeToken: string;
  selectedAiProvider: AiProvider;
  commitTitlePrompt: string;
  commitGraphMode: CommitGraphMode;
  commitGraphStyle: CommitGraphStyle;
  commitMergeAnimation: CommitMergeAnimation;
  diffViewerMode: DiffViewerMode;
  repositoryScanDepth: number;
} {
  return {
    openAiToken: config.openAiToken,
    openAiModel: config.openAiModel,
    claudeCodeToken: config.claudeCodeToken,
    selectedAiProvider: config.selectedAiProvider,
    commitTitlePrompt: config.commitTitlePrompt,
    commitGraphMode: config.commitGraphMode,
    commitGraphStyle: config.commitGraphStyle,
    commitMergeAnimation: config.commitMergeAnimation,
    diffViewerMode: config.diffViewerMode,
    repositoryScanDepth: normalizeDepth(config.repositoryScanDepth),
  };
}

function hasConfiguredToken(token: string): boolean {
  return token.trim().length > 0;
}

export function resolveSelectedAiProvider(
  currentProvider: AiProvider,
  openAiToken: string,
  claudeCodeToken: string,
): AiProvider {
  const hasOpenAiToken = hasConfiguredToken(openAiToken);
  const hasClaudeCodeToken = hasConfiguredToken(claudeCodeToken);

  if (currentProvider === "claudeCode" && !hasClaudeCodeToken && hasOpenAiToken) {
    return "openAi";
  }

  if (currentProvider === "openAi" && !hasOpenAiToken && hasClaudeCodeToken) {
    return "claudeCode";
  }

  return currentProvider;
}

function useTokenValidation(
  token: string,
  validateToken: (token: string) => Promise<TokenValidationResult>,
  trustedToken: string = "",
): TokenValidationState {
  const normalizedToken = token.trim();
  const normalizedTrusted = trustedToken.trim();
  const isTrusted = normalizedToken.length > 0 && normalizedToken === normalizedTrusted;

  const [validationState, setValidationState] = useState<TokenValidationState>(() =>
    isTrusted ? "valid" : "idle",
  );
  const validationRequestIdRef = useRef(0);

  useEffect(() => {
    validationRequestIdRef.current += 1;
    const requestId = validationRequestIdRef.current;

    if (!normalizedToken) {
      setValidationState("idle");
      return;
    }

    if (isTrusted) {
      setValidationState("valid");
      return;
    }

    setValidationState("checking");
    let cancelled = false;

    const timer = setTimeout(() => {
      void (async () => {
        try {
          const result = await validateToken(normalizedToken);
          if (cancelled || validationRequestIdRef.current !== requestId) {
            return;
          }

          setValidationState(result.valid ? "valid" : "invalid");
        } catch {
          if (cancelled || validationRequestIdRef.current !== requestId) {
            return;
          }

          setValidationState("invalid");
        }
      })();
    }, 350);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [isTrusted, normalizedToken, validateToken]);

  return validationState;
}

interface OpenAiTokenAndModelsState {
  validation: TokenValidationState;
  models: string[];
  loading: boolean;
  error: string | null;
}

function useOpenAiTokenAndModels(
  token: string,
  trustedToken: string,
  fetchModels: (token: string) => Promise<OpenAiModelsResponse>,
): OpenAiTokenAndModelsState {
  const normalizedToken = token.trim();
  const normalizedTrusted = trustedToken.trim();
  const isTrusted = normalizedToken.length > 0 && normalizedToken === normalizedTrusted;

  const [state, setState] = useState<OpenAiTokenAndModelsState>(() => ({
    validation: isTrusted ? "valid" : "idle",
    models: [],
    loading: normalizedToken.length > 0,
    error: null,
  }));
  const requestIdRef = useRef(0);

  useEffect(() => {
    requestIdRef.current += 1;
    const requestId = requestIdRef.current;

    if (!normalizedToken) {
      setState({ validation: "idle", models: [], loading: false, error: null });
      return;
    }

    setState({
      validation: isTrusted ? "valid" : "checking",
      models: [],
      loading: true,
      error: null,
    });

    let cancelled = false;
    const debounceMs = isTrusted ? 0 : 350;
    const timer = setTimeout(() => {
      void (async () => {
        try {
          const response = await fetchModels(normalizedToken);
          if (cancelled || requestIdRef.current !== requestId) {
            return;
          }

          setState({
            validation: "valid",
            models: response.models,
            loading: false,
            error: null,
          });
        } catch (error) {
          if (cancelled || requestIdRef.current !== requestId) {
            return;
          }

          setState({
            validation: "invalid",
            models: [],
            loading: false,
            error:
              error instanceof Error ? error.message : "OpenAI モデル一覧を取得できませんでした。",
          });
        }
      })();
    }, debounceMs);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [fetchModels, isTrusted, normalizedToken]);

  return state;
}

export function TokenValidationIndicator({
  providerName,
  validationState,
}: {
  providerName: string;
  validationState: TokenValidationState;
}): JSX.Element | null {
  if (validationState === "idle") {
    return null;
  }

  if (validationState === "checking") {
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

  if (validationState === "valid") {
    return (
      <span
        className="inline-flex items-center text-(--success)"
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

function resolveMergeNodeRingAnimation(
  animation: CommitMergeAnimation,
): MergeNodeRingAnimation | null {
  if (animation === "none" || animation === "pulse") {
    return null;
  }

  return animation;
}

function MergeNodeAnimationPreview({
  animation,
  graphStyle,
}: {
  animation: CommitMergeAnimation;
  graphStyle: CommitGraphStyle;
}): JSX.Element {
  const mergeRingAnimation = resolveMergeNodeRingAnimation(animation);
  const selectedAnimationLabel =
    MERGE_NODE_ANIMATION_OPTIONS.find((option) => option.value === animation)?.label ?? animation;
  const nodeClassName = [
    "block commit-node",
    graphStyle === "japaneseExpress" ? "commit-node--japanese-express" : "",
    animation === "pulse" ? "commit-node-merge-pulse" : "",
  ]
    .filter(Boolean)
    .join(" ");
  const nodeStyle = {
    width: `${MERGE_NODE_PREVIEW_SIZE_PX}px`,
    height: `${MERGE_NODE_PREVIEW_SIZE_PX}px`,
    background: MERGE_NODE_PREVIEW_COLOR,
    ["--merge-pulse-color" as string]: MERGE_NODE_PREVIEW_COLOR,
  } as CSSProperties;
  const ringStyle = {
    width: `${MERGE_NODE_PREVIEW_SIZE_PX}px`,
    height: `${MERGE_NODE_PREVIEW_SIZE_PX}px`,
    ["--merge-pulse-color" as string]: MERGE_NODE_PREVIEW_COLOR,
    ["--merge-particle-radius" as string]: `${Math.round(MERGE_NODE_PREVIEW_SIZE_PX * 1.2)}px`,
  } as CSSProperties;

  return (
    <div
      className="config-view__merge-animation-preview"
      role="img"
      aria-label={`Merge Node Animation preview: ${selectedAnimationLabel}`}
      title={selectedAnimationLabel}
    >
      <span className="config-view__merge-animation-preview-node" aria-hidden="true">
        {mergeRingAnimation ? (
          <span
            aria-hidden="true"
            className={`commit-node-merge-ring commit-node-merge-ring--${mergeRingAnimation}`}
            style={ringStyle}
          />
        ) : null}
        <span aria-hidden="true" className={nodeClassName} style={nodeStyle} />
      </span>
    </div>
  );
}

export function ConfigView({
  onNotify,
  config,
  onConfigSaved,
  onAiGenerationConfigChange,
}: ConfigViewProps): JSX.Element {
  const initialConfigState = config ? applyConfigToState(config) : null;
  const [openAiToken, setOpenAiToken] = useState(initialConfigState?.openAiToken ?? "");
  const [openAiModel, setOpenAiModel] = useState(
    initialConfigState?.openAiModel ?? DEFAULT_OPENAI_MODEL,
  );
  const [claudeCodeToken, setClaudeCodeToken] = useState(initialConfigState?.claudeCodeToken ?? "");
  const [selectedAiProvider, setSelectedAiProvider] = useState<AiProvider>(
    initialConfigState
      ? resolveSelectedAiProvider(
          initialConfigState.selectedAiProvider,
          initialConfigState.openAiToken,
          initialConfigState.claudeCodeToken,
        )
      : "openAi",
  );
  const [commitTitlePrompt, setCommitTitlePrompt] = useState(
    initialConfigState?.commitTitlePrompt ?? "",
  );
  const [commitGraphMode, setCommitGraphMode] = useState<CommitGraphMode>(
    initialConfigState?.commitGraphMode ?? "detailed",
  );
  const [commitGraphStyle, setCommitGraphStyle] = useState<CommitGraphStyle>(
    initialConfigState?.commitGraphStyle ?? "standard",
  );
  const [commitMergeAnimation, setCommitMergeAnimation] = useState<CommitMergeAnimation>(
    initialConfigState?.commitMergeAnimation ?? "none",
  );
  const [diffViewerMode, setDiffViewerMode] = useState<DiffViewerMode>(
    initialConfigState?.diffViewerMode ?? "builtin",
  );
  const [repositoryScanDepth, setRepositoryScanDepth] = useState(
    initialConfigState?.repositoryScanDepth ?? 4,
  );
  const [loading, setLoading] = useState(config === null);
  const [saving, setSaving] = useState(false);
  const [isOpenAiTokenRevealed, setIsOpenAiTokenRevealed] = useState(false);
  const [isClaudeCodeTokenRevealed, setIsClaudeCodeTokenRevealed] = useState(false);
  const [openAiModelFilter, setOpenAiModelFilter] = useState("");
  const [isOpenAiModelFilterDirty, setIsOpenAiModelFilterDirty] = useState(false);
  const [isOpenAiModelComboboxOpen, setIsOpenAiModelComboboxOpen] = useState(false);
  const [activeOpenAiModelIndex, setActiveOpenAiModelIndex] = useState(-1);
  const {
    validation: openAiTokenValidation,
    models: openAiModels,
    loading: loadingOpenAiModels,
    error: openAiModelsError,
  } = useOpenAiTokenAndModels(openAiToken, config?.openAiToken ?? "", api.getOpenAiModels);
  const claudeCodeTokenValidation = useTokenValidation(
    claudeCodeToken,
    api.validateClaudeCodeToken,
    config?.claudeCodeToken ?? "",
  );
  const commitTitlePromptTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const openAiModelComboboxRef = useRef<HTMLDivElement | null>(null);
  const openAiModelInputRef = useRef<HTMLInputElement | null>(null);
  const openAiModelMenuRef = useRef<HTMLDivElement | null>(null);
  const openAiModelOptionRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const openAiModelComboboxId = useId();
  const openAiModelOptions = useMemo(
    () => buildOpenAiModelOptions(openAiModels, openAiModel),
    [openAiModel, openAiModels],
  );
  const openAiModelFilterQuery = isOpenAiModelFilterDirty ? openAiModelFilter : "";
  const normalizedOpenAiModelFilter = useMemo(
    () => openAiModelFilterQuery.trim().toLocaleLowerCase(),
    [openAiModelFilterQuery],
  );
  const filteredOpenAiModelOptions = useMemo(
    () => filterOpenAiModelOptions(openAiModelOptions, openAiModelFilterQuery),
    [openAiModelFilterQuery, openAiModelOptions],
  );
  const openAiModelFilterMatchCount = filteredOpenAiModelOptions.length;
  const isOpenAiModelComboboxEnabled =
    openAiTokenValidation === "valid" && !loadingOpenAiModels && openAiModelOptions.length > 0;
  const openAiModelInputValue = isOpenAiModelComboboxOpen
    ? isOpenAiModelFilterDirty
      ? openAiModelFilter
      : openAiModel
    : openAiModel;
  const isDefaultCommitTitlePrompt = commitTitlePrompt === DEFAULT_COMMIT_TITLE_PROMPT;

  useEffect(() => {
    const textarea = commitTitlePromptTextareaRef.current;
    if (!textarea) {
      return;
    }

    const resizeTextarea = (): void => {
      textarea.style.height = "0px";
      textarea.style.height = `${Math.max(textarea.scrollHeight, COMMIT_TITLE_PROMPT_TEXTAREA_MIN_HEIGHT_PX)}px`;
    };

    resizeTextarea();
    window.addEventListener("resize", resizeTextarea);
    return () => {
      window.removeEventListener("resize", resizeTextarea);
    };
  }, [commitTitlePrompt]);

  useEffect(() => {
    if (!isOpenAiModelComboboxOpen) {
      setActiveOpenAiModelIndex(-1);
      return;
    }

    if (filteredOpenAiModelOptions.length === 0) {
      setActiveOpenAiModelIndex(-1);
      return;
    }

    const selectedIndex = filteredOpenAiModelOptions.indexOf(openAiModel);
    setActiveOpenAiModelIndex((current) => {
      if (selectedIndex >= 0) {
        return selectedIndex;
      }

      if (current >= 0 && current < filteredOpenAiModelOptions.length) {
        return current;
      }

      return 0;
    });
  }, [filteredOpenAiModelOptions, isOpenAiModelComboboxOpen, openAiModel]);

  useEffect(() => {
    if (!isOpenAiModelComboboxOpen || activeOpenAiModelIndex < 0) {
      return;
    }

    const menu = openAiModelMenuRef.current;
    const option = openAiModelOptionRefs.current[activeOpenAiModelIndex];
    if (!menu || !option) {
      return;
    }

    menu.scrollTop = resolveListboxScrollTop({
      optionOffsetTop: option.offsetTop,
      optionOffsetHeight: option.offsetHeight,
      listScrollTop: menu.scrollTop,
      listClientHeight: menu.clientHeight,
    });
  }, [activeOpenAiModelIndex, isOpenAiModelComboboxOpen]);

  useEffect(() => {
    if (!isOpenAiModelComboboxOpen) {
      return;
    }

    const handlePointerDown = (event: PointerEvent): void => {
      const target = event.target;
      if (!(target instanceof Node)) {
        return;
      }

      if (openAiModelComboboxRef.current?.contains(target)) {
        return;
      }

      setIsOpenAiModelComboboxOpen(false);
      setOpenAiModelFilter("");
      setIsOpenAiModelFilterDirty(false);
      setActiveOpenAiModelIndex(-1);
    };

    window.addEventListener("pointerdown", handlePointerDown);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
    };
  }, [isOpenAiModelComboboxOpen]);

  useEffect(() => {
    if (isOpenAiModelComboboxEnabled) {
      return;
    }

    setIsOpenAiModelComboboxOpen(false);
    setOpenAiModelFilter("");
    setIsOpenAiModelFilterDirty(false);
    setActiveOpenAiModelIndex(-1);
  }, [isOpenAiModelComboboxEnabled]);

  useEffect(() => {
    if (!config) {
      return;
    }

    const next = applyConfigToState(config);
    setOpenAiToken(next.openAiToken);
    setOpenAiModel(next.openAiModel);
    setOpenAiModelFilter("");
    setIsOpenAiModelFilterDirty(false);
    setIsOpenAiModelComboboxOpen(false);
    setActiveOpenAiModelIndex(-1);
    setClaudeCodeToken(next.claudeCodeToken);
    setSelectedAiProvider(
      resolveSelectedAiProvider(next.selectedAiProvider, next.openAiToken, next.claudeCodeToken),
    );
    setCommitTitlePrompt(next.commitTitlePrompt);
    setCommitGraphMode(next.commitGraphMode);
    setCommitGraphStyle(next.commitGraphStyle);
    setCommitMergeAnimation(next.commitMergeAnimation);
    setDiffViewerMode(next.diffViewerMode);
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
        setOpenAiModel(next.openAiModel);
        setOpenAiModelFilter("");
        setIsOpenAiModelFilterDirty(false);
        setIsOpenAiModelComboboxOpen(false);
        setActiveOpenAiModelIndex(-1);
        setClaudeCodeToken(next.claudeCodeToken);
        setSelectedAiProvider(
          resolveSelectedAiProvider(
            next.selectedAiProvider,
            next.openAiToken,
            next.claudeCodeToken,
          ),
        );
        setCommitTitlePrompt(next.commitTitlePrompt);
        setCommitGraphMode(next.commitGraphMode);
        setCommitGraphStyle(next.commitGraphStyle);
        setDiffViewerMode(next.diffViewerMode);
        setRepositoryScanDepth(next.repositoryScanDepth);
        onConfigSaved(loadedConfig);
      } catch (error) {
        if (active) {
          onNotify(error instanceof Error ? error.message : "設定を読み込めませんでした。");
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
    setSelectedAiProvider((current) =>
      resolveSelectedAiProvider(current, openAiToken, claudeCodeToken),
    );
  }, [claudeCodeToken, openAiToken]);

  useEffect(() => {
    if (loading) {
      return;
    }

    onAiGenerationConfigChange({
      openAiToken,
      openAiModel,
      claudeCodeToken,
      selectedAiProvider,
      commitTitlePrompt,
    });
  }, [
    claudeCodeToken,
    commitTitlePrompt,
    loading,
    onAiGenerationConfigChange,
    openAiModel,
    openAiToken,
    selectedAiProvider,
  ]);

  const handleProviderCheckboxChange = (provider: AiProvider, checked: boolean): void => {
    if (checked) {
      setSelectedAiProvider(provider);
      return;
    }

    setSelectedAiProvider((current) => {
      if (current !== provider) {
        return current;
      }

      if (provider === "openAi" && hasConfiguredToken(claudeCodeToken)) {
        return "claudeCode";
      }

      if (provider === "claudeCode" && hasConfiguredToken(openAiToken)) {
        return "openAi";
      }

      return provider;
    });
  };

  const closeOpenAiModelCombobox = (): void => {
    setIsOpenAiModelComboboxOpen(false);
    setOpenAiModelFilter("");
    setIsOpenAiModelFilterDirty(false);
    setActiveOpenAiModelIndex(-1);
  };

  const focusOpenAiModelInput = (selectText: boolean): void => {
    requestAnimationFrame(() => {
      const input = openAiModelInputRef.current;
      if (!input) {
        return;
      }

      input.focus();
      if (selectText && input.value) {
        input.select();
      }
    });
  };

  const openOpenAiModelCombobox = (selectText: boolean): void => {
    if (!isOpenAiModelComboboxEnabled) {
      return;
    }

    setIsOpenAiModelComboboxOpen(true);
    setOpenAiModelFilter("");
    setIsOpenAiModelFilterDirty(false);
    focusOpenAiModelInput(selectText);
  };

  const handleOpenAiModelOptionSelect = (modelId: string): void => {
    setOpenAiModel(modelId);
    closeOpenAiModelCombobox();
  };

  const handleOpenAiModelInputFocus = (): void => {
    if (!isOpenAiModelComboboxEnabled || isOpenAiModelComboboxOpen) {
      return;
    }

    setIsOpenAiModelComboboxOpen(true);
    setOpenAiModelFilter("");
    setIsOpenAiModelFilterDirty(false);
    focusOpenAiModelInput(Boolean(openAiModel.trim()));
  };

  const handleOpenAiModelInputChange = (value: string): void => {
    if (!isOpenAiModelComboboxEnabled) {
      return;
    }

    if (!isOpenAiModelComboboxOpen) {
      setIsOpenAiModelComboboxOpen(true);
    }

    setOpenAiModelFilter(value);
    setIsOpenAiModelFilterDirty(true);
  };

  const handleOpenAiModelInputKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (!isOpenAiModelComboboxEnabled) {
      return;
    }

    if (event.key === "Tab") {
      closeOpenAiModelCombobox();
      return;
    }

    if (event.key === "Escape") {
      if (isOpenAiModelComboboxOpen) {
        event.preventDefault();
        closeOpenAiModelCombobox();
        openAiModelInputRef.current?.blur();
      }
      return;
    }

    if (event.key === "ArrowDown") {
      event.preventDefault();
      if (!isOpenAiModelComboboxOpen) {
        openOpenAiModelCombobox(false);
        return;
      }

      setActiveOpenAiModelIndex((current) => {
        if (filteredOpenAiModelOptions.length === 0) {
          return -1;
        }

        return Math.min(current + 1, filteredOpenAiModelOptions.length - 1);
      });
      return;
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      if (!isOpenAiModelComboboxOpen) {
        openOpenAiModelCombobox(false);
        return;
      }

      setActiveOpenAiModelIndex((current) => {
        if (filteredOpenAiModelOptions.length === 0) {
          return -1;
        }

        if (current < 0) {
          return filteredOpenAiModelOptions.length - 1;
        }

        return Math.max(current - 1, 0);
      });
      return;
    }

    if (event.key === "Enter" && isOpenAiModelComboboxOpen && activeOpenAiModelIndex >= 0) {
      event.preventDefault();
      const activeModel = filteredOpenAiModelOptions[activeOpenAiModelIndex];
      if (activeModel) {
        handleOpenAiModelOptionSelect(activeModel);
      }
      return;
    }

    if (!isOpenAiModelComboboxOpen) {
      setIsOpenAiModelComboboxOpen(true);
    }
  };

  const handleSave = async (): Promise<void> => {
    setSaving(true);
    try {
      const normalizedDepth = normalizeDepth(repositoryScanDepth);

      const response = await api.saveConfig({
        openAiToken,
        openAiModel,
        claudeCodeToken,
        selectedAiProvider,
        commitTitlePrompt,
        commitGraphMode,
        commitGraphStyle,
        commitMergeAnimation,
        diffViewerMode,
        repositoryScanDepth: normalizedDepth,
      });

      const nextConfig = response.config ?? (await api.getConfig());
      setOpenAiToken(nextConfig.openAiToken);
      setOpenAiModel(nextConfig.openAiModel);
      setOpenAiModelFilter("");
      setIsOpenAiModelFilterDirty(false);
      setIsOpenAiModelComboboxOpen(false);
      setActiveOpenAiModelIndex(-1);
      setClaudeCodeToken(nextConfig.claudeCodeToken);
      setSelectedAiProvider(
        resolveSelectedAiProvider(
          nextConfig.selectedAiProvider,
          nextConfig.openAiToken,
          nextConfig.claudeCodeToken,
        ),
      );
      setCommitTitlePrompt(nextConfig.commitTitlePrompt);
      onConfigSaved(nextConfig);
      setRepositoryScanDepth(normalizeDepth(nextConfig.repositoryScanDepth));
      setCommitGraphMode(nextConfig.commitGraphMode);
      setCommitGraphStyle(nextConfig.commitGraphStyle);
      setCommitMergeAnimation(nextConfig.commitMergeAnimation);
      setDiffViewerMode(nextConfig.diffViewerMode);

      onNotify("Config を保存しました。");
    } catch (error) {
      onNotify(error instanceof Error ? error.message : "Config 保存に失敗しました。");
    } finally {
      setSaving(false);
    }
  };

  const handleResetCommitTitlePrompt = (): void => {
    setCommitTitlePrompt(DEFAULT_COMMIT_TITLE_PROMPT);
  };

  return (
    <section className="panel mx-auto flex h-full min-h-0 w-full max-w-3xl flex-col overflow-hidden p-6">
      <div className="mb-4 shrink-0">
        <h2 className="text-2xl font-semibold text-ink">Config</h2>
        <p className="text-sm text-ink-soft">
          トークン、コミットグラフ表示、リポジトリ探索設定を管理します。
        </p>
      </div>

      {loading ? (
        <div className="text-sm text-ink-subtle">読み込み中...</div>
      ) : (
        <>
          <div className="min-h-0 flex-1 overflow-y-auto pr-1">
            <div className="space-y-5 pb-4">
              <div className="grid gap-4 rounded-2xl border border-black/10 bg-white/65 p-4">
                <div>
                  <label className="mb-1 block text-xs font-semibold uppercase tracking-[0.08em] text-ink-subtle">
                    Commit Graph Mode
                  </label>
                  <select
                    className="input input-select"
                    value={commitGraphMode}
                    onChange={(event) => setCommitGraphMode(event.target.value as CommitGraphMode)}
                  >
                    <option value="detailed">Detailed (分岐・合流レーン)</option>
                    <option value="simple">Simple (簡易レーン)</option>
                  </select>
                </div>

                <div>
                  <label className="mb-1 block text-xs font-semibold uppercase tracking-[0.08em] text-ink-subtle">
                    Commit Graph Style
                  </label>
                  <select
                    className="input input-select"
                    value={commitGraphStyle}
                    onChange={(event) =>
                      setCommitGraphStyle(event.target.value as CommitGraphStyle)
                    }
                  >
                    <option value="standard">Standard</option>
                    <option value="japaneseExpress">Japanese Express</option>
                  </select>
                </div>

                <div>
                  <label className="mb-1 block text-xs font-semibold uppercase tracking-[0.08em] text-ink-subtle">
                    Merge Node Animation
                  </label>
                  <div className="config-view__merge-animation-field">
                    <div className="config-view__merge-animation-select">
                      <select
                        className="input input-select"
                        value={commitMergeAnimation}
                        onChange={(event) =>
                          setCommitMergeAnimation(event.target.value as CommitMergeAnimation)
                        }
                      >
                        {MERGE_NODE_ANIMATION_OPTIONS.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </div>
                    <MergeNodeAnimationPreview
                      animation={commitMergeAnimation}
                      graphStyle={commitGraphStyle}
                    />
                  </div>
                </div>

                <div>
                  <label className="mb-1 block text-xs font-semibold uppercase tracking-[0.08em] text-ink-subtle">
                    Diff Viewer
                  </label>
                  <select
                    className="input input-select"
                    value={diffViewerMode}
                    onChange={(event) => setDiffViewerMode(event.target.value as DiffViewerMode)}
                  >
                    <option value="builtin">Built-in (既定)</option>
                    <option value="pierre">@pierre/diffs</option>
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
                    `$HOME` 以下の探索深さです（{MIN_REPOSITORY_SCAN_DEPTH} -{" "}
                    {MAX_REPOSITORY_SCAN_DEPTH}）。
                  </p>
                </div>
              </div>

              <div className="grid gap-4 rounded-2xl border border-black/10 bg-white/65 p-4">
                <div>
                  <div className="mb-1 flex items-center justify-between gap-3">
                    <div className="text-xs font-semibold uppercase tracking-[0.08em] text-ink-subtle">
                      OpenAI Token
                    </div>
                    <div className="flex items-center gap-3">
                      <TokenValidationIndicator
                        providerName="OpenAI"
                        validationState={openAiTokenValidation}
                      />
                      <label className="flex items-center gap-1.5 text-[11px] font-medium text-ink-subtle">
                        <input
                          type="checkbox"
                          checked={selectedAiProvider === "openAi"}
                          disabled={!hasConfiguredToken(openAiToken)}
                          onChange={(event) =>
                            handleProviderCheckboxChange("openAi", event.target.checked)
                          }
                        />
                        使用
                      </label>
                    </div>
                  </div>
                  <div className="config-view__token-field">
                    <input
                      className="input"
                      type={isOpenAiTokenRevealed ? "text" : "password"}
                      autoComplete="off"
                      spellCheck={false}
                      placeholder="sk-..."
                      value={openAiToken}
                      onChange={(event) => setOpenAiToken(event.target.value)}
                    />
                    <button
                      type="button"
                      className="config-view__token-reveal"
                      aria-label={
                        isOpenAiTokenRevealed
                          ? "OpenAI token を非表示にする"
                          : "OpenAI token を表示する"
                      }
                      aria-pressed={isOpenAiTokenRevealed}
                      title={isOpenAiTokenRevealed ? "非表示にする" : "表示する"}
                      onClick={() => setIsOpenAiTokenRevealed((current) => !current)}
                    >
                      {isOpenAiTokenRevealed ? (
                        <EyeOff size={16} aria-hidden="true" />
                      ) : (
                        <Eye size={16} aria-hidden="true" />
                      )}
                    </button>
                  </div>
                  <div className="mt-3">
                    <label className="mb-1 block text-xs font-semibold uppercase tracking-[0.08em] text-ink-subtle">
                      OpenAI Model
                    </label>
                    <div ref={openAiModelComboboxRef} className="config-view__combobox">
                      <div
                        className={`config-view__combobox-control${isOpenAiModelComboboxOpen ? " is-open" : ""}`}
                      >
                        <input
                          ref={openAiModelInputRef}
                          className="config-view__combobox-input"
                          role="combobox"
                          aria-autocomplete="list"
                          aria-controls={`${openAiModelComboboxId}-listbox`}
                          aria-expanded={isOpenAiModelComboboxOpen}
                          aria-activedescendant={
                            activeOpenAiModelIndex >= 0
                              ? `${openAiModelComboboxId}-option-${activeOpenAiModelIndex}`
                              : undefined
                          }
                          placeholder="OpenAI model を選択"
                          value={openAiModelInputValue}
                          disabled={openAiTokenValidation !== "valid" || loadingOpenAiModels}
                          onFocus={handleOpenAiModelInputFocus}
                          onChange={(event) => handleOpenAiModelInputChange(event.target.value)}
                          onKeyDown={handleOpenAiModelInputKeyDown}
                        />
                        <button
                          type="button"
                          className="config-view__combobox-toggle"
                          aria-label={
                            isOpenAiModelComboboxOpen
                              ? "OpenAI model list を閉じる"
                              : "OpenAI model list を開く"
                          }
                          disabled={!isOpenAiModelComboboxEnabled}
                          onMouseDown={(event) => event.preventDefault()}
                          onClick={() => {
                            if (isOpenAiModelComboboxOpen) {
                              closeOpenAiModelCombobox();
                              return;
                            }

                            openOpenAiModelCombobox(Boolean(openAiModel.trim()));
                          }}
                        >
                          <ChevronDown size={16} aria-hidden="true" />
                        </button>
                      </div>

                      {isOpenAiModelComboboxOpen ? (
                        <div
                          id={`${openAiModelComboboxId}-listbox`}
                          ref={openAiModelMenuRef}
                          className="config-view__combobox-menu"
                          role="listbox"
                        >
                          {filteredOpenAiModelOptions.length > 0 ? (
                            filteredOpenAiModelOptions.map((modelId, index) => {
                              const isSelected = modelId === openAiModel;
                              const isActive = index === activeOpenAiModelIndex;

                              return (
                                <button
                                  key={modelId}
                                  id={`${openAiModelComboboxId}-option-${index}`}
                                  ref={(element) => {
                                    openAiModelOptionRefs.current[index] = element;
                                  }}
                                  type="button"
                                  role="option"
                                  aria-selected={isSelected}
                                  className={`config-view__combobox-option${isSelected ? " is-selected" : ""}${isActive ? " is-active" : ""}`}
                                  onMouseDown={(event) => event.preventDefault()}
                                  onMouseEnter={() => setActiveOpenAiModelIndex(index)}
                                  onClick={() => handleOpenAiModelOptionSelect(modelId)}
                                >
                                  <span className="config-view__combobox-option-label">
                                    {modelId}
                                  </span>
                                  {isSelected ? (
                                    <span className="config-view__combobox-option-meta">
                                      選択中
                                    </span>
                                  ) : null}
                                </button>
                              );
                            })
                          ) : (
                            <div className="config-view__combobox-empty">
                              一致するモデルはありません
                            </div>
                          )}
                        </div>
                      ) : null}
                    </div>
                    <p className="mt-1 text-xs text-ink-subtle">
                      {openAiTokenValidation !== "valid"
                        ? "有効な OpenAI token を入力すると利用可能モデルを取得します。"
                        : loadingOpenAiModels
                          ? "OpenAI の利用可能モデルを取得中です。"
                          : openAiModelsError
                            ? openAiModelsError
                            : normalizedOpenAiModelFilter
                              ? openAiModelFilterMatchCount > 0
                                ? `モデル名の部分一致で ${openAiModelFilterMatchCount} 件に絞り込んでいます。`
                                : "一致するモデルはありません。"
                              : "入力しながら候補を絞り込み、コミット文生成に使う OpenAI model を選択します。"}
                    </p>
                  </div>
                </div>

                <div>
                  <div className="mb-1 flex items-center justify-between gap-3">
                    <div className="text-xs font-semibold uppercase tracking-[0.08em] text-ink-subtle">
                      Claude Code Token
                    </div>
                    <div className="flex items-center gap-3">
                      <TokenValidationIndicator
                        providerName="Claude Code"
                        validationState={claudeCodeTokenValidation}
                      />
                      <label className="flex items-center gap-1.5 text-[11px] font-medium text-ink-subtle">
                        <input
                          type="checkbox"
                          checked={selectedAiProvider === "claudeCode"}
                          disabled={!hasConfiguredToken(claudeCodeToken)}
                          onChange={(event) =>
                            handleProviderCheckboxChange("claudeCode", event.target.checked)
                          }
                        />
                        使用
                      </label>
                    </div>
                  </div>
                  <div className="config-view__token-field">
                    <input
                      className="input"
                      type={isClaudeCodeTokenRevealed ? "text" : "password"}
                      autoComplete="off"
                      spellCheck={false}
                      placeholder="cc-... / sk-ant-..."
                      value={claudeCodeToken}
                      onChange={(event) => setClaudeCodeToken(event.target.value)}
                    />
                    <button
                      type="button"
                      className="config-view__token-reveal"
                      aria-label={
                        isClaudeCodeTokenRevealed
                          ? "Claude Code token を非表示にする"
                          : "Claude Code token を表示する"
                      }
                      aria-pressed={isClaudeCodeTokenRevealed}
                      title={isClaudeCodeTokenRevealed ? "非表示にする" : "表示する"}
                      onClick={() => setIsClaudeCodeTokenRevealed((current) => !current)}
                    >
                      {isClaudeCodeTokenRevealed ? (
                        <EyeOff size={16} aria-hidden="true" />
                      ) : (
                        <Eye size={16} aria-hidden="true" />
                      )}
                    </button>
                  </div>
                </div>

                <div className="min-w-0">
                  <div className="mb-1 flex items-center justify-between gap-3">
                    <label className="block text-xs font-semibold uppercase tracking-[0.08em] text-ink-subtle">
                      Commit Title Prompt
                    </label>
                    <button
                      type="button"
                      className="button button-secondary px-2! py-1! text-[11px]"
                      disabled={isDefaultCommitTitlePrompt}
                      onClick={handleResetCommitTitlePrompt}
                    >
                      デフォルトに戻す
                    </button>
                  </div>
                  <textarea
                    ref={commitTitlePromptTextareaRef}
                    className="input config-view__commit-title-prompt min-h-32 resize-y"
                    value={commitTitlePrompt}
                    wrap="soft"
                    onChange={(event) => setCommitTitlePrompt(event.target.value)}
                  />
                  <p className="mt-1 text-xs text-ink-subtle">
                    AIでタイトル生成を押したときの instruction
                    です。右のボタンか、空で保存すると既定プロンプトに戻ります。
                  </p>
                </div>
              </div>
            </div>
          </div>

          <div className="mt-4 shrink-0">
            <button
              type="button"
              className="button button-primary"
              disabled={saving}
              onClick={handleSave}
            >
              {saving ? "Saving..." : "Save Config"}
            </button>
          </div>
        </>
      )}
    </section>
  );
}
