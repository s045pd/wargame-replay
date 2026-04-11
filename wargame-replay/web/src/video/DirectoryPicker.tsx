import { useCallback, useEffect, useState } from 'react';
import { ChevronLeft, Folder, FolderOpen, Home, RotateCw } from 'lucide-react';
import { browseDirectory, type BrowseResponse } from '../lib/api';
import { useI18n } from '../lib/i18n';

interface DirectoryPickerProps {
  initialPath?: string;
  onCancel: () => void;
  onConfirm: (absPath: string) => void;
}

/**
 * Server-driven directory picker. Because Chrome's showDirectoryPicker()
 * returns a sandboxed handle (no absolute path), and Firefox/Safari do
 * not support it at all, we instead let the server enumerate
 * subdirectories. Since wargame-replay is a local desktop tool, the
 * server process already has the same filesystem privileges as the user.
 *
 * Keyboard: Enter drills in, Backspace goes up, Escape cancels.
 */
export function DirectoryPicker({ initialPath, onCancel, onConfirm }: DirectoryPickerProps) {
  const t = useI18n((s) => s.t);
  const [data, setData] = useState<BrowseResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedIdx, setSelectedIdx] = useState(0);

  const load = useCallback(async (path: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await browseDirectory(path);
      setData(res);
      setSelectedIdx(0);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(initialPath ?? '');
  }, [initialPath, load]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!data) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        onCancel();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const entry = data.entries[selectedIdx];
        if (entry) void load(entry.path);
      } else if (e.key === 'Backspace') {
        e.preventDefault();
        if (data.parent) void load(data.parent);
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIdx((i) => Math.min(i + 1, data.entries.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIdx((i) => Math.max(i - 1, 0));
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [data, selectedIdx, load, onCancel]);

  const currentPath = data?.path ?? '';
  const parent = data?.parent ?? '';
  const entries = data?.entries ?? [];

  return (
    <div className="flex max-h-[80vh] w-full max-w-xl flex-col rounded-xl border border-zinc-700 bg-zinc-900 shadow-2xl">
      <div className="flex items-center gap-2 border-b border-zinc-800 px-4 py-3">
        <button
          type="button"
          onClick={() => parent && void load(parent)}
          disabled={!parent}
          className="flex h-7 w-7 items-center justify-center rounded text-zinc-300 hover:bg-zinc-800 disabled:opacity-30"
          title={t('video_picker_up')}
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={() => void load('')}
          className="flex h-7 w-7 items-center justify-center rounded text-zinc-300 hover:bg-zinc-800"
          title={t('video_picker_home')}
        >
          <Home className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={() => void load(currentPath)}
          className="flex h-7 w-7 items-center justify-center rounded text-zinc-300 hover:bg-zinc-800"
          title={t('video_rescan')}
        >
          <RotateCw className="h-4 w-4" />
        </button>
        <div
          className="truncate rounded bg-zinc-950 px-2 py-1 text-[11px] font-mono text-zinc-300 flex-1"
          title={currentPath}
        >
          {currentPath || '…'}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-2">
        {loading && <div className="p-4 text-xs text-zinc-500">…</div>}
        {error && (
          <div className="m-2 rounded border border-red-800 bg-red-950/30 p-2 text-xs text-red-300">
            {error}
          </div>
        )}
        {!loading && !error && entries.length === 0 && (
          <div className="p-4 text-xs text-zinc-500">{t('video_picker_empty')}</div>
        )}
        {entries.map((entry, i) => {
          const isSelected = i === selectedIdx;
          const hasVideos = (entry.videoCount ?? 0) > 0;
          return (
            <button
              key={entry.path}
              type="button"
              onClick={() => {
                setSelectedIdx(i);
              }}
              onDoubleClick={() => void load(entry.path)}
              className={`flex w-full items-center gap-2 rounded px-2 py-1 text-left text-xs ${
                isSelected
                  ? 'bg-sky-500/20 text-sky-100'
                  : 'text-zinc-200 hover:bg-zinc-800'
              }`}
            >
              {isSelected ? (
                <FolderOpen className="h-4 w-4 shrink-0 text-sky-300" />
              ) : (
                <Folder className="h-4 w-4 shrink-0 text-zinc-400" />
              )}
              <span className="truncate">{entry.name}</span>
              {hasVideos && (
                <span className="ml-auto shrink-0 text-[10px] text-emerald-400">
                  {entry.videoCount} mp4
                </span>
              )}
            </button>
          );
        })}
      </div>

      <div className="flex items-center justify-between border-t border-zinc-800 px-4 py-3 text-xs">
        <span className="text-zinc-500">{t('video_picker_hint')}</span>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded px-3 py-1.5 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
          >
            {t('video_wizard_cancel')}
          </button>
          <button
            type="button"
            disabled={!currentPath}
            onClick={() => onConfirm(currentPath)}
            className="rounded bg-sky-500 px-3 py-1.5 font-medium text-white hover:bg-sky-400 disabled:cursor-not-allowed disabled:bg-zinc-700 disabled:text-zinc-500"
          >
            {t('video_picker_select')}
          </button>
        </div>
      </div>
    </div>
  );
}
