import { Expand, Sparkles, UploadCloud } from 'lucide-react';
import { type DragEvent, useMemo, useState } from 'react';

import type { CommitDetail, StashEntry, WorkingTreeStatus } from '../types';

interface GitOperationPanelProps {
  status: WorkingTreeStatus | null;
  stashes: StashEntry[];
  selectedCommitTitle: string | null;
  selectedCommitSha: string | null;
  selectedCommitFiles: CommitDetail['files'];
  selectedCommitLoading: boolean;
  activeCommitDiffFile: string | null;
  commitTitle: string;
  commitDescription: string;
  busy: boolean;
  onOpenCommitFileDiff: (file: string) => void;
  onCommitTitleChange: (value: string) => void;
  onCommitDescriptionChange: (value: string) => void;
  onStageFile: (file: string) => void;
  onUnstageFile: (file: string) => void;
  onStageAll: () => void;
  onStashFile: (file: string) => void;
  onGenerateTitle: () => void;
  onCommit: () => void;
  onPush: () => void;
}

type DropZone = 'staged' | 'unstaged' | 'stash' | null;

export function GitOperationPanel({
  status,
  stashes,
  selectedCommitTitle,
  selectedCommitSha,
  selectedCommitFiles,
  selectedCommitLoading,
  activeCommitDiffFile,
  commitTitle,
  commitDescription,
  busy,
  onOpenCommitFileDiff,
  onCommitTitleChange,
  onCommitDescriptionChange,
  onStageFile,
  onUnstageFile,
  onStageAll,
  onStashFile,
  onGenerateTitle,
  onCommit,
  onPush
}: GitOperationPanelProps): JSX.Element {
  const [dropZone, setDropZone] = useState<DropZone>(null);

  const unstaged = status?.unstaged ?? [];
  const staged = status?.staged ?? [];

  const draggedPayload = useMemo(
    () => ({
      write(event: DragEvent, file: string, source: 'staged' | 'unstaged'): void {
        event.dataTransfer.setData('text/plain', JSON.stringify({ file, source }));
        event.dataTransfer.effectAllowed = 'move';
      },
      read(event: DragEvent): { file: string; source: 'staged' | 'unstaged' } | null {
        const raw = event.dataTransfer.getData('text/plain');
        if (!raw) {
          return null;
        }

        try {
          const parsed = JSON.parse(raw) as { file?: string; source?: 'staged' | 'unstaged' };
          if (!parsed.file || (parsed.source !== 'staged' && parsed.source !== 'unstaged')) {
            return null;
          }
          return {
            file: parsed.file,
            source: parsed.source
          };
        } catch {
          return null;
        }
      }
    }),
    []
  );

  const handleDrop = (event: DragEvent, target: DropZone): void => {
    event.preventDefault();
    setDropZone(null);

    const payload = draggedPayload.read(event);
    if (!payload) {
      return;
    }

    if (target === 'staged' && payload.source === 'unstaged') {
      onStageFile(payload.file);
      return;
    }

    if (target === 'unstaged' && payload.source === 'staged') {
      onUnstageFile(payload.file);
      return;
    }

    if (target === 'stash') {
      onStashFile(payload.file);
    }
  };

  return (
    <section className="panel flex h-full min-h-0 flex-col p-3">
      <div className="mb-2 px-2">
        <div className="section-title">Git Operations</div>
      </div>

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-1 pb-2">
        <div>
          <div className="mb-1 flex items-center justify-between px-1 text-xs text-ink-subtle">
            <span>Selected Commit Files ({selectedCommitFiles.length})</span>
            <span className="font-mono">{selectedCommitSha ? selectedCommitSha.slice(0, 7) : 'No commit'}</span>
          </div>
          <div className="rounded-2xl border border-black/10 bg-white/65 p-2">
            {selectedCommitLoading ? (
              <div className="px-2 py-3 text-xs text-ink-subtle">選択コミットの変更ファイルを読み込み中...</div>
            ) : selectedCommitFiles.length === 0 ? (
              <div className="px-2 py-3 text-xs text-ink-subtle">
                {selectedCommitSha ? 'このコミットには表示できる変更ファイルがありません。' : 'コミットを選択すると変更ファイルを表示します。'}
              </div>
            ) : (
              <>
                <div className="mb-2 truncate px-2 text-[11px] text-ink-soft">{selectedCommitTitle ?? 'Selected commit'}</div>
                <div className="max-h-36 space-y-1 overflow-y-auto">
                  {selectedCommitFiles.map((file) => {
                    const isActive = activeCommitDiffFile === file.file;

                    return (
                      <button
                        key={`commit-file-${file.file}`}
                        type="button"
                        className={`flex w-full items-center justify-between gap-3 rounded-xl border px-2 py-2 text-left transition ${
                          isActive
                            ? 'border-[#0f172a]/40 bg-[#0f172a] text-white'
                            : 'border-black/5 bg-white/80 text-ink hover:border-accent/25 hover:bg-accent-soft/50'
                        }`}
                        onClick={() => onOpenCommitFileDiff(file.file)}
                      >
                        <div className="min-w-0">
                          <div className="truncate text-xs font-medium">{file.file}</div>
                          <div className={`mt-1 flex items-center gap-2 text-[11px] ${isActive ? 'text-white/80' : 'text-ink-subtle'}`}>
                            <span className="text-[#157347]">+{file.additions}</span>
                            <span className="text-[#b42318]">-{file.deletions}</span>
                          </div>
                        </div>
                        <div className={`flex items-center gap-1 text-[11px] font-semibold ${isActive ? 'text-white' : 'text-accent'}`}>
                          <Expand size={12} />
                          Diff
                        </div>
                      </button>
                    );
                  })}
                </div>
              </>
            )}
          </div>
        </div>

        <div>
          <div className="mb-1 flex items-center justify-between px-1 text-xs text-ink-subtle">
            <span>Unstaged Files ({unstaged.length})</span>
            <button
              className="button button-secondary !px-2 !py-1 text-[11px]"
              type="button"
              disabled={unstaged.length === 0 || busy}
              onClick={onStageAll}
            >
              Stage all
            </button>
          </div>
          <div
            className={`drop-zone max-h-32 overflow-auto ${dropZone === 'unstaged' ? 'is-over' : ''}`}
            onDragOver={(event) => {
              event.preventDefault();
              setDropZone('unstaged');
            }}
            onDragLeave={() => setDropZone(null)}
            onDrop={(event) => handleDrop(event, 'unstaged')}
          >
            {unstaged.length === 0 ? (
              <div className="text-xs text-ink-subtle">未ステージの変更はありません。</div>
            ) : (
              unstaged.map((item) => (
                <div
                  key={`unstaged-${item.file}`}
                  draggable
                  onDragStart={(event) => draggedPayload.write(event, item.file, 'unstaged')}
                  className="mb-1 flex items-center justify-between rounded-lg bg-white/75 px-2 py-1.5 text-xs last:mb-0"
                >
                  <div className="min-w-0">
                    <div className="truncate text-ink">{item.file}</div>
                    <div className="text-[11px] text-ink-subtle">{item.statusLabel}</div>
                  </div>
                  <button
                    type="button"
                    className="button button-secondary !px-2 !py-1 text-[11px]"
                    disabled={busy}
                    onClick={() => onStageFile(item.file)}
                  >
                    Stage
                  </button>
                </div>
              ))
            )}
          </div>
        </div>

        <div>
          <div className="mb-1 px-1 text-xs text-ink-subtle">Staged Files ({staged.length})</div>
          <div
            className={`drop-zone max-h-28 overflow-auto ${dropZone === 'staged' ? 'is-over' : ''}`}
            onDragOver={(event) => {
              event.preventDefault();
              setDropZone('staged');
            }}
            onDragLeave={() => setDropZone(null)}
            onDrop={(event) => handleDrop(event, 'staged')}
          >
            {staged.length === 0 ? (
              <div className="text-xs text-ink-subtle">ステージされたファイルはありません。</div>
            ) : (
              staged.map((item) => (
                <div
                  key={`staged-${item.file}`}
                  draggable
                  onDragStart={(event) => draggedPayload.write(event, item.file, 'staged')}
                  className="mb-1 flex items-center justify-between rounded-lg bg-white/75 px-2 py-1.5 text-xs last:mb-0"
                >
                  <div className="min-w-0">
                    <div className="truncate text-ink">{item.file}</div>
                    <div className="text-[11px] text-ink-subtle">{item.statusLabel}</div>
                  </div>
                  <button
                    type="button"
                    className="button button-secondary !px-2 !py-1 text-[11px]"
                    disabled={busy}
                    onClick={() => onUnstageFile(item.file)}
                  >
                    Unstage
                  </button>
                </div>
              ))
            )}
          </div>
        </div>

        <div>
          <div className="mb-1 px-1 text-xs text-ink-subtle">Stash Area</div>
          <div
            className={`drop-zone ${dropZone === 'stash' ? 'is-over' : ''}`}
            onDragOver={(event) => {
              event.preventDefault();
              setDropZone('stash');
            }}
            onDragLeave={() => setDropZone(null)}
            onDrop={(event) => handleDrop(event, 'stash')}
          >
            <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-ink-soft">
              <UploadCloud size={16} />
              ファイルをここにドロップしてスタッシュ
            </div>
            <div className="max-h-24 space-y-1 overflow-y-auto">
              {stashes.length === 0 ? (
                <div className="text-xs text-ink-subtle">スタッシュはありません。</div>
              ) : (
                stashes.map((stash) => (
                  <div key={stash.id} className="rounded-lg bg-white/70 px-2 py-1.5 text-xs">
                    <div className="font-medium text-ink">{stash.id}</div>
                    <div className="truncate text-ink-subtle">{stash.message}</div>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {stash.files.length > 0 ? (
                        stash.files.map((file) => (
                          <span
                            key={`${stash.id}-${file}`}
                            className="rounded-full bg-accent-soft px-2 py-0.5 text-[10px] text-accent"
                            title={file}
                          >
                            {file}
                          </span>
                        ))
                      ) : (
                        <span className="text-[11px] text-ink-subtle">No file details</span>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        <div className="space-y-2 rounded-2xl border border-black/10 bg-white/65 p-3">
          <div className="text-xs font-semibold uppercase tracking-[0.08em] text-ink-subtle">Commit</div>
          <div className="relative">
            <input
              className="input pr-10"
              placeholder="Commit summary"
              value={commitTitle}
              onChange={(event) => onCommitTitleChange(event.target.value)}
            />
            <button
              type="button"
              className="absolute right-1 top-1 rounded-lg p-2 text-accent transition hover:bg-accent-soft"
              onClick={onGenerateTitle}
              disabled={busy}
              title="AIでタイトル生成"
            >
              <Sparkles size={16} />
            </button>
          </div>
          <textarea
            className="input min-h-20 resize-y"
            placeholder="Description"
            value={commitDescription}
            onChange={(event) => onCommitDescriptionChange(event.target.value)}
          />
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              className="button button-primary"
              disabled={busy || staged.length === 0 || !commitTitle.trim()}
              onClick={onCommit}
            >
              Commit
            </button>
            <button
              type="button"
              className="button button-secondary"
              disabled={busy}
              onClick={onPush}
            >
              Push
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
