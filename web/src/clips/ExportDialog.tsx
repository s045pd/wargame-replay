import { useState } from 'react';
import { useClips } from '../store/clips';

interface ExportDialogProps {
  gameId: string;
  clipIdx: number;
  clipTitle: string;
  onClose: () => void;
}

type ExportFormat = 'metadata' | 'full';

export function ExportDialog({ gameId, clipIdx, clipTitle, onClose }: ExportDialogProps) {
  const { exportClip } = useClips();
  const [format, setFormat] = useState<ExportFormat>('metadata');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleDownload = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await exportClip(gameId, clipIdx, format === 'full');
      const json = JSON.stringify(data, null, 2);
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const safeName = clipTitle.replace(/[^a-z0-9]/gi, '_').toLowerCase() || `clip_${clipIdx}`;
      const suffix = format === 'full' ? '_full' : '_meta';
      a.href = url;
      a.download = `${safeName}${suffix}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      onClose();
    } catch (e: unknown) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };

  return (
    /* Overlay */
    <div
      className="fixed inset-0 bg-black/60 flex items-center justify-center z-[60]"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-zinc-900 border border-zinc-700 rounded-lg shadow-2xl w-80 p-5">
        {/* Title */}
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-bold text-zinc-100 tracking-wider">EXPORT CLIP</h3>
          <button
            onClick={onClose}
            className="text-zinc-400 hover:text-zinc-100 text-lg leading-none transition-colors"
            title="Close"
          >
            ×
          </button>
        </div>

        <p className="text-xs text-zinc-400 mb-4 truncate" title={clipTitle}>
          {clipTitle}
        </p>

        {/* Format selector */}
        <div className="space-y-2 mb-4">
          <label className="flex items-start gap-3 cursor-pointer group">
            <input
              type="radio"
              name="exportFormat"
              value="metadata"
              checked={format === 'metadata'}
              onChange={() => setFormat('metadata')}
              className="mt-0.5 accent-blue-500"
            />
            <div>
              <div className="text-sm text-zinc-200 group-hover:text-zinc-100">Metadata Only (JSON)</div>
              <div className="text-xs text-zinc-500 mt-0.5">
                Clip info + all frame timestamps in range
              </div>
            </div>
          </label>

          <label className="flex items-start gap-3 cursor-pointer group">
            <input
              type="radio"
              name="exportFormat"
              value="full"
              checked={format === 'full'}
              onChange={() => setFormat('full')}
              className="mt-0.5 accent-blue-500"
            />
            <div>
              <div className="text-sm text-zinc-200 group-hover:text-zinc-100">Full Data (JSON + frames)</div>
              <div className="text-xs text-zinc-500 mt-0.5">
                Includes complete unit position data for every frame in the clip
              </div>
            </div>
          </label>
        </div>

        {/* Error */}
        {error && (
          <div className="mb-3 px-3 py-2 bg-red-900/50 border border-red-700 rounded text-xs text-red-300">
            {error}
          </div>
        )}

        {/* Actions */}
        <div className="flex gap-2">
          <button
            onClick={() => void handleDownload()}
            disabled={loading}
            className="flex-1 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm rounded transition-colors"
          >
            {loading ? 'Exporting…' : 'Download'}
          </button>
          <button
            onClick={onClose}
            className="px-4 py-2 bg-zinc-700 hover:bg-zinc-600 text-zinc-300 text-sm rounded transition-colors"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
