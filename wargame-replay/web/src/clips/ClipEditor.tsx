import { useEffect, useState } from 'react';
import { useClips, Clip } from '../store/clips';
import { usePlayback } from '../store/playback';
import { ExportDialog } from './ExportDialog';

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
  const { gameId, currentTs, meta } = usePlayback();
  const { clips, loadClips, addClip, updateClip, deleteClip } = useClips();

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editingIdx, setEditingIdx] = useState<number | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editSpeed, setEditSpeed] = useState(1);
  const [exportIdx, setExportIdx] = useState<number | null>(null);

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
          <button
            onClick={() => void handleNewClip()}
            className="text-xs px-2 py-1 bg-blue-600 hover:bg-blue-500 text-white rounded transition-colors"
            title="Create new clip from current time"
          >
            + New Clip
          </button>
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

      {/* List */}
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center h-24 text-zinc-500 text-sm">
            Loading…
          </div>
        ) : clips.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-24 text-zinc-500 text-xs">
            <p>No clips yet.</p>
            <p className="mt-1 text-zinc-600">Press "New Clip" to create one.</p>
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
    </div>
  );
}
