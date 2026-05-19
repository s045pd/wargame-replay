import { useEffect, useRef, useState } from 'react';
import { useClips, Clip } from '../store/clips';
import { usePlayback } from '../store/playback';
import { useHotspotFilter } from '../store/hotspotFilter';
import { useI18n } from '../lib/i18n';
import { ExportDialog } from './ExportDialog';
import { createStoreZip } from '../lib/zip';
import { recordClip } from './recording';

interface ClipEditorProps {
  onClose: () => void;
}

// addMinutes adds `minutes` minutes to a "YYYY-MM-DD HH:MM:SS" string.
// Handles wrap-around within the same day for simplicity.
function addMinutes(ts: string, minutes: number): string {
  if (!ts || ts.length < 19) return ts;
  try {
    const [datePart, timePart] = ts.split(' ');
    const [h, m, s] = timePart.split(':').map(Number);
    const totalSeconds = h * 3600 + m * 60 + s + minutes * 60;
    const clampedSeconds = Math.max(0, totalSeconds);
    const hh = Math.floor(clampedSeconds / 3600) % 24;
    const mm = Math.floor((clampedSeconds % 3600) / 60);
    const ss = clampedSeconds % 60;
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${datePart} ${pad(hh)}:${pad(mm)}:${pad(ss)}`;
  } catch {
    return ts;
  }
}

export function ClipEditor({ onClose }: ClipEditorProps) {
  const { gameId, currentTs, meta, selectedUnitId } = usePlayback();
  const { clips, loadClips, addClip, updateClip, deleteClip, loadHighlights, importHighlightsAsClips } = useClips();
  const { personalTypeFilters } = useHotspotFilter();
  const { t } = useI18n();

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editingIdx, setEditingIdx] = useState<number | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editSpeed, setEditSpeed] = useState(1);
  const [exportIdx, setExportIdx] = useState<number | null>(null);

  // Auto-highlight + bulk export state
  const [highlightLoading, setHighlightLoading] = useState(false);
  const [autoToast, setAutoToast] = useState<string | null>(null);

  // Bulk video export state
  type BulkState =
    | { phase: 'idle' }
    | { phase: 'recording'; current: number; total: number; title: string; speed: number }
    | { phase: 'zipping'; total: number }
    | { phase: 'done'; total: number };
  const [bulkState, setBulkState] = useState<BulkState>({ phase: 'idle' });
  const bulkAbortRef = useRef<{ aborted: boolean }>({ aborted: false });

  useEffect(() => {
    if (!gameId) return;
    setLoading(true);
    setError(null);
    loadClips(gameId)
      .catch((e: unknown) => setError(String(e)))
      .finally(() => setLoading(false));
  }, [gameId, loadClips]);

  const handleNewClip = async () => {
    if (!gameId) return;
    const base = currentTs || meta?.startTime || '';
    const startTs = addMinutes(base, -2.5);
    const endTs = addMinutes(base, 2.5);
    const hh = base.slice(11, 13);
    const mm = base.slice(14, 16);
    const title = `Clip at ${hh}:${mm}`;
    try {
      await addClip(gameId, { startTs, endTs, title, speed: 1, tags: [] });
    } catch (e: unknown) {
      setError(String(e));
    }
  };

  // Auto-generate highlights and add directly to clip list (no preview step)
  const handleAutoHighlight = async () => {
    if (!gameId || selectedUnitId === null) return;
    setHighlightLoading(true);
    setError(null);
    setAutoToast(null);
    try {
      const enabledTypes: string[] = [];
      for (const [key, enabled] of Object.entries(personalTypeFilters)) {
        if (enabled) enabledTypes.push(key);
      }
      const result = await loadHighlights(gameId, selectedUnitId, enabledTypes);
      if (result.length === 0) {
        setAutoToast(t('no_highlights_found') || 'No highlights found for this unit');
      } else {
        await importHighlightsAsClips(gameId, result);
        setAutoToast(
          (t('highlights_added') || 'Added {n} highlights').replace('{n}', String(result.length))
        );
      }
      setTimeout(() => setAutoToast(null), 3500);
    } catch (e: unknown) {
      setError(String(e));
    } finally {
      setHighlightLoading(false);
    }
  };

  // Bulk video export: record each clip as .webm, zip them all up, download.
  const handleBulkVideoExport = async () => {
    if (clips.length === 0 || bulkState.phase !== 'idle') return;

    // We require a tracked unit so the camera can lock onto it during
    // recording — otherwise the auto-director would frame the full hotspot
    // circle and the video would be too wide.
    if (selectedUnitId === null) {
      setError(t('bulk_export_need_unit') || 'Track a unit first (the camera will follow it during recording).');
      return;
    }
    const followUnitId = selectedUnitId;

    // Estimate real-time duration so the user can decide whether to commit.
    const exportSpeed = 8; // game-time multiplier; balances speed vs intelligibility
    let totalGameSec = 0;
    for (const c of clips) {
      const s = new Date(c.startTs.replace(' ', 'T')).getTime();
      const e = new Date(c.endTs.replace(' ', 'T')).getTime();
      totalGameSec += Math.max(0, (e - s) / 1000);
    }
    const estimatedRealMin = Math.ceil((totalGameSec / exportSpeed + clips.length * 1.2) / 60);
    const confirmMsg = (t('bulk_export_confirm') || 'Record {n} clips at {speed}× speed. Estimated time: ~{min} min. Continue?')
      .replace('{n}', String(clips.length))
      .replace('{speed}', String(exportSpeed))
      .replace('{min}', String(estimatedRealMin));
    if (!window.confirm(confirmMsg)) return;

    bulkAbortRef.current = { aborted: false };
    const blobs: { name: string; data: Uint8Array }[] = [];

    try {
      for (let i = 0; i < clips.length; i++) {
        if (bulkAbortRef.current.aborted) break;
        const c = clips[i]!;
        setBulkState({
          phase: 'recording',
          current: i + 1,
          total: clips.length,
          title: c.title,
          speed: exportSpeed,
        });
        const blob = await recordClip(c, {
          speed: exportSpeed,
          abortSignal: bulkAbortRef.current,
          followUnitId,
        });
        if (bulkAbortRef.current.aborted) break;
        if (!blob) continue; // skipped (e.g. no canvas)
        const safeTitle = c.title.replace(/[^\w一-龥-]/g, '_').slice(0, 40) || 'clip';
        const seq = String(i + 1).padStart(3, '0');
        blobs.push({
          name: `${seq}_${safeTitle}.webm`,
          data: new Uint8Array(await blob.arrayBuffer()),
        });
      }

      if (blobs.length === 0) {
        setBulkState({ phase: 'idle' });
        return;
      }

      setBulkState({ phase: 'zipping', total: blobs.length });
      const zipBlob = createStoreZip(blobs);
      const url = URL.createObjectURL(zipBlob);
      const a = document.createElement('a');
      a.href = url;
      const stem = (gameId ?? 'clips').replace(/[^\w-]/g, '_');
      a.download = `${stem}_clips_${blobs.length}.zip`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      setBulkState({ phase: 'done', total: blobs.length });
      setTimeout(() => setBulkState({ phase: 'idle' }), 3000);
    } catch (e: unknown) {
      setError(String(e));
      setBulkState({ phase: 'idle' });
    }
  };

  const handleBulkCancel = () => {
    bulkAbortRef.current.aborted = true;
  };

  const handleStartEdit = (idx: number) => {
    setEditingIdx(idx);
    setEditTitle(clips[idx].title);
    setEditSpeed(clips[idx].speed);
  };

  const handleSaveEdit = async (idx: number) => {
    if (!gameId) return;
    const clip = clips[idx];
    try {
      await updateClip(gameId, idx, { ...clip, title: editTitle, speed: editSpeed });
      setEditingIdx(null);
    } catch (e: unknown) {
      setError(String(e));
    }
  };

  const handleDelete = async (idx: number) => {
    if (!gameId) return;
    try {
      await deleteClip(gameId, idx);
      if (editingIdx === idx) setEditingIdx(null);
    } catch (e: unknown) {
      setError(String(e));
    }
  };

  const handleSeek = (clip: Clip) => {
    const { seek } = usePlayback.getState();
    seek(clip.startTs);
  };

  const formatRange = (clip: Clip) => {
    const start = clip.startTs.slice(11, 19);
    const end = clip.endTs.slice(11, 19);
    return `${start} – ${end}`;
  };

  return (
    <div className="fixed inset-y-0 right-0 w-80 bg-zinc-900 border-l border-zinc-700 flex flex-col z-50 shadow-2xl">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-700">
        <h2 className="text-sm font-bold text-zinc-100 tracking-wider">CLIPS</h2>
        <div className="flex items-center gap-2">
          {selectedUnitId !== null && (
            <button
              onClick={() => void handleAutoHighlight()}
              disabled={highlightLoading}
              className="text-xs px-2 py-1 bg-amber-600 hover:bg-amber-500 disabled:opacity-50 text-white rounded transition-colors"
              title={t('auto_highlight_desc') || 'Auto-generate highlight clips for tracked unit'}
            >
              {highlightLoading ? '...' : '⚡ ' + (t('auto_highlight') || 'Auto')}
            </button>
          )}
          <button
            onClick={() => void handleNewClip()}
            className="text-xs px-2 py-1 bg-blue-600 hover:bg-blue-500 text-white rounded transition-colors"
            title="Create new clip from current time"
          >
            + New Clip
          </button>
          {clips.length > 0 && (
            <button
              onClick={() => void handleBulkVideoExport()}
              disabled={bulkState.phase !== 'idle'}
              className="text-xs px-2 py-1 bg-emerald-700 hover:bg-emerald-600 disabled:opacity-50 text-white rounded transition-colors"
              title={t('bulk_export_desc') || 'Record all clips as videos and pack into a zip'}
            >
              📦 {t('bulk_export') || 'Export All'}
            </button>
          )}
          <button
            onClick={onClose}
            className="text-zinc-400 hover:text-zinc-100 text-lg leading-none transition-colors"
            title="Close"
          >
            ×
          </button>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="mx-4 mt-2 px-3 py-2 bg-red-900/50 border border-red-700 rounded text-xs text-red-300">
          {error}
        </div>
      )}

      {/* Auto-highlight toast */}
      {autoToast && (
        <div className="mx-4 mt-2 px-3 py-2 bg-amber-900/40 border border-amber-700/60 rounded text-xs text-amber-200">
          {autoToast}
        </div>
      )}

      {/* List */}
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center h-24 text-zinc-500 text-sm">
            Loading…
          </div>
        ) : clips.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-24 text-zinc-500 text-xs">
            <p>No clips yet.</p>
            <p className="mt-1 text-zinc-600">
              {selectedUnitId !== null
                ? (t('auto_highlight_hint') || 'Track a unit and press ⚡ Auto to generate highlights')
                : 'Press "New Clip" to create one.'}
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-zinc-800">
            {clips.map((clip, idx) => (
              <li key={idx} className="group px-4 py-3 hover:bg-zinc-800 transition-colors">
                {editingIdx === idx ? (
                  /* Edit mode */
                  <div className="space-y-2">
                    <input
                      className="w-full bg-zinc-800 border border-zinc-600 text-zinc-100 text-sm px-2 py-1 rounded focus:outline-none focus:border-blue-500"
                      value={editTitle}
                      onChange={(e) => setEditTitle(e.target.value)}
                      placeholder="Clip title"
                    />
                    <div className="flex items-center gap-2">
                      <label className="text-xs text-zinc-400">Speed</label>
                      <input
                        type="number"
                        min={0.1}
                        max={10}
                        step={0.5}
                        className="w-20 bg-zinc-800 border border-zinc-600 text-zinc-100 text-sm px-2 py-1 rounded focus:outline-none focus:border-blue-500"
                        value={editSpeed}
                        onChange={(e) => setEditSpeed(parseFloat(e.target.value) || 1)}
                      />
                      <span className="text-xs text-zinc-500">×</span>
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={() => void handleSaveEdit(idx)}
                        className="flex-1 text-xs py-1 bg-blue-600 hover:bg-blue-500 text-white rounded transition-colors"
                      >
                        Save
                      </button>
                      <button
                        onClick={() => setEditingIdx(null)}
                        className="flex-1 text-xs py-1 bg-zinc-700 hover:bg-zinc-600 text-zinc-300 rounded transition-colors"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  /* View mode */
                  <div className="flex items-start gap-2">
                    <button
                      onClick={() => handleSeek(clip)}
                      className="flex-1 text-left min-w-0"
                      title={`Seek to ${clip.startTs}`}
                    >
                      <div className="text-xs font-mono text-blue-400 truncate">
                        {formatRange(clip)}
                      </div>
                      <div className="text-sm text-zinc-200 mt-0.5 truncate">{clip.title}</div>
                      <div className="text-xs text-zinc-500 mt-0.5">{clip.speed}× speed</div>
                    </button>
                    <div className="flex flex-col gap-1 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button
                        onClick={() => handleStartEdit(idx)}
                        className="text-xs px-1.5 py-0.5 bg-zinc-700 hover:bg-zinc-600 text-zinc-300 rounded transition-colors"
                        title="Edit clip"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => setExportIdx(idx)}
                        className="text-xs px-1.5 py-0.5 bg-zinc-700 hover:bg-zinc-600 text-zinc-300 rounded transition-colors"
                        title="Export clip"
                      >
                        Export
                      </button>
                      <button
                        onClick={() => void handleDelete(idx)}
                        className="text-xs px-1.5 py-0.5 bg-red-900/60 hover:bg-red-800 text-red-300 rounded transition-colors"
                        title="Delete clip"
                      >
                        Del
                      </button>
                    </div>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Footer */}
      <div className="px-4 py-3 border-t border-zinc-700 text-xs text-zinc-500">
        Press <kbd className="px-1 py-0.5 bg-zinc-800 rounded text-zinc-400">C</kbd> to toggle clips panel
      </div>

      {/* Export dialog */}
      {exportIdx !== null && gameId && (
        <ExportDialog
          gameId={gameId}
          clipIdx={exportIdx}
          clipTitle={clips[exportIdx]?.title ?? ''}
          onClose={() => setExportIdx(null)}
        />
      )}

      {/* Bulk video export progress overlay */}
      {bulkState.phase !== 'idle' && (
        <div className="fixed inset-0 z-[100] bg-black/80 backdrop-blur-sm flex items-center justify-center">
          <div className="bg-zinc-900 border border-zinc-700 rounded-lg shadow-2xl w-[420px] max-w-[90vw] p-6">
            <h3 className="text-sm font-bold text-zinc-100 tracking-wider mb-3">
              📦 {t('bulk_export') || 'Export All'}
            </h3>

            {bulkState.phase === 'recording' && (
              <>
                <div className="text-xs text-zinc-400 mb-2">
                  {(t('bulk_export_recording') || 'Recording {i}/{n} · {speed}× speed')
                    .replace('{i}', String(bulkState.current))
                    .replace('{n}', String(bulkState.total))
                    .replace('{speed}', String(bulkState.speed))}
                </div>
                <div className="text-sm text-emerald-400 truncate mb-3" title={bulkState.title}>
                  {bulkState.title}
                </div>
                <div className="w-full h-2 bg-zinc-800 rounded overflow-hidden mb-4">
                  <div
                    className="h-full bg-emerald-600 transition-all"
                    style={{ width: `${(bulkState.current / bulkState.total) * 100}%` }}
                  />
                </div>
                <div className="flex justify-end">
                  <button
                    onClick={handleBulkCancel}
                    className="text-xs px-3 py-1 bg-red-900/60 hover:bg-red-800 text-red-200 rounded transition-colors"
                  >
                    {t('cancel') || 'Cancel'}
                  </button>
                </div>
                <p className="text-[11px] text-zinc-500 mt-3">
                  {t('bulk_export_hint') || 'Do not switch tabs or the recording may pause.'}
                </p>
              </>
            )}

            {bulkState.phase === 'zipping' && (
              <>
                <div className="text-xs text-zinc-400 mb-2">
                  {(t('bulk_export_packing') || 'Packing {n} clips into a zip…').replace('{n}', String(bulkState.total))}
                </div>
                <div className="w-full h-2 bg-zinc-800 rounded overflow-hidden">
                  <div className="h-full bg-emerald-600 animate-pulse w-full" />
                </div>
              </>
            )}

            {bulkState.phase === 'done' && (
              <div className="text-sm text-emerald-400">
                ✓ {(t('bulk_export_done') || 'Exported {n} clips').replace('{n}', String(bulkState.total))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
