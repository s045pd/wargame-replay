import { useEffect, useMemo, useState } from 'react';
import { X, AlertTriangle, Check } from 'lucide-react';
import { useI18n } from '../lib/i18n';
import { useVideos } from '../store/videos';
import { fetchVideoLibrary, type VideoGroup, type VideoSegment } from '../lib/api';
import { formatDurationMs } from './alignMath';

interface RelinkDialogProps {
  group: VideoGroup;
  onClose: () => void;
}

/**
 * Lets the user resolve a group with stale segments by replacing each
 * missing relPath with a still-live one chosen from the video library.
 * Segments that are not stale are preserved unchanged.
 */
export function RelinkDialog({ group, onClose }: RelinkDialogProps) {
  const t = useI18n((s) => s.t);
  const updateGroup = useVideos((s) => s.updateGroup);
  const rescan = useVideos((s) => s.rescan);

  const [library, setLibrary] = useState<VideoSegment[]>([]);
  const [loading, setLoading] = useState(true);
  const [replacements, setReplacements] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetchVideoLibrary().then((segs) => {
      if (!cancelled) {
        setLibrary(segs);
        setLoading(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const staleSegments = useMemo(
    () => group.segments.filter((s) => s.stale),
    [group.segments],
  );

  async function handleSave() {
    setSaving(true);
    // Build new relPath list: each original segment keeps its path unless
    // the user supplied a replacement.
    const newRelPaths = group.segments.map((s) => {
      if (!s.stale) return s.relPath;
      return replacements[s.relPath] ?? s.relPath;
    });
    await updateGroup(group.id, { segmentRelPaths: newRelPaths });
    setSaving(false);
    onClose();
  }

  const allResolved = staleSegments.every((s) => !!replacements[s.relPath]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
      <div className="flex max-h-[85vh] w-full max-w-xl flex-col rounded-xl border border-zinc-700 bg-zinc-900 shadow-2xl">
        <div className="flex items-center justify-between border-b border-zinc-800 px-5 py-3">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-red-400" />
            <h2 className="text-sm font-semibold text-zinc-100">{t('video_relink_title')}</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-7 w-7 items-center justify-center rounded text-zinc-400 hover:bg-zinc-800"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 space-y-3 overflow-y-auto p-5">
          <p className="text-xs text-zinc-400">{t('video_relink_hint')}</p>

          <button
            type="button"
            onClick={() => void rescan()}
            className="rounded border border-zinc-700 px-3 py-1 text-xs text-zinc-300 hover:bg-zinc-800"
          >
            {t('video_rescan')}
          </button>

          {loading && <div className="text-xs text-zinc-500">…</div>}

          {!loading && staleSegments.length === 0 && (
            <div className="rounded border border-dashed border-zinc-800 p-3 text-xs text-zinc-500">
              {t('video_relink_none_stale')}
            </div>
          )}

          {!loading &&
            staleSegments.map((seg) => (
              <div key={seg.relPath} className="rounded border border-zinc-800 bg-zinc-950/40 p-3">
                <div className="mb-1 text-xs text-zinc-500">{t('video_relink_missing')}</div>
                <div className="mb-2 truncate font-mono text-xs text-red-300" title={seg.relPath}>
                  {seg.relPath}
                </div>
                <label className="block text-[11px] text-zinc-500" htmlFor={'replace-' + seg.relPath}>
                  {t('video_relink_replace_with')}
                </label>
                <select
                  id={'replace-' + seg.relPath}
                  value={replacements[seg.relPath] ?? ''}
                  onChange={(e) =>
                    setReplacements((prev) => ({ ...prev, [seg.relPath]: e.target.value }))
                  }
                  className="mt-1 w-full rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-xs text-zinc-100 outline-none focus:border-sky-500"
                >
                  <option value="">—</option>
                  {library.map((lib) => (
                    <option key={lib.relPath} value={lib.relPath}>
                      {lib.relPath} · {formatDurationMs(lib.durationMs)} · {lib.codec}
                    </option>
                  ))}
                </select>
              </div>
            ))}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-zinc-800 px-5 py-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded px-3 py-1.5 text-xs text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
          >
            {t('video_wizard_cancel')}
          </button>
          <button
            type="button"
            disabled={saving || !allResolved || staleSegments.length === 0}
            onClick={() => {
              void handleSave();
            }}
            className="flex items-center gap-1 rounded bg-sky-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-sky-400 disabled:cursor-not-allowed disabled:bg-zinc-700 disabled:text-zinc-500"
          >
            <Check className="h-3 w-3" />
            {t('video_wizard_save')}
          </button>
        </div>
      </div>
    </div>
  );
}
