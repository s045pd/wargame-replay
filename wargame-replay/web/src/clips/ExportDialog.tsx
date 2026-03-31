import { useState, useRef, useEffect, useCallback } from 'react';
import { useClips } from '../store/clips';
import { usePlayback } from '../store/playback';
import { useI18n } from '../lib/i18n';

interface ExportDialogProps {
  gameId: string;
  clipIdx: number;
  clipTitle: string;
  onClose: () => void;
}

type ExportFormat = 'metadata' | 'full' | 'video';
type RecordState = 'idle' | 'preparing' | 'recording' | 'processing' | 'done';

function parseTs(ts: string): number {
  return new Date(ts.replace(' ', 'T')).getTime();
}

/** Pick a supported MediaRecorder mimeType */
function pickMimeType(): string {
  const candidates = [
    'video/webm;codecs=vp9',
    'video/webm;codecs=vp8',
    'video/webm',
  ];
  for (const mt of candidates) {
    if (MediaRecorder.isTypeSupported(mt)) return mt;
  }
  return 'video/webm';
}

export function ExportDialog({ gameId, clipIdx, clipTitle, onClose }: ExportDialogProps) {
  const { exportClip, clips } = useClips();
  const { t } = useI18n();
  const clip = clips[clipIdx];

  const [format, setFormat] = useState<ExportFormat>('video');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Video recording state
  const [recordState, setRecordState] = useState<RecordState>('idle');
  const [progress, setProgress] = useState(0);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const blobUrlRef = useRef<string | null>(null);

  const safeName = clipTitle.replace(/[^a-z0-9]/gi, '_').toLowerCase() || `clip_${clipIdx}`;

  // --- JSON download (existing functionality) ---
  const handleJsonDownload = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await exportClip(gameId, clipIdx, format === 'full');
      const json = JSON.stringify(data, null, 2);
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
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

  // --- Video recording ---
  const handleStartRecording = useCallback(() => {
    if (!clip) return;
    setError(null);
    setRecordState('preparing');
    setProgress(0);

    // Find the map canvas
    const canvas = document.querySelector('.mapboxgl-canvas') as HTMLCanvasElement;
    if (!canvas) {
      // Fallback: try to find any canvas in the main area
      const fallback = document.querySelector('canvas') as HTMLCanvasElement;
      if (!fallback) {
        setError('Cannot find map canvas for recording');
        setRecordState('idle');
        return;
      }
    }

    const targetCanvas = (document.querySelector('.mapboxgl-canvas') || document.querySelector('canvas')) as HTMLCanvasElement;

    // Seek to clip start
    const { seek, play } = usePlayback.getState();
    seek(clip.startTs);

    // Wait for seek to settle, then start recording
    setTimeout(() => {
      try {
        const stream = targetCanvas.captureStream(30);
        const mimeType = pickMimeType();
        const recorder = new MediaRecorder(stream, {
          mimeType,
          videoBitsPerSecond: 8_000_000, // 8 Mbps for good quality
        });

        chunksRef.current = [];
        recorder.ondataavailable = (e) => {
          if (e.data.size > 0) chunksRef.current.push(e.data);
        };
        recorder.onstop = () => {
          setRecordState('processing');
          const blob = new Blob(chunksRef.current, { type: 'video/webm' });
          const url = URL.createObjectURL(blob);
          blobUrlRef.current = url;
          setRecordState('done');
        };

        recorderRef.current = recorder;
        recorder.start(200); // 200ms timeslice
        play(clip.speed || 64);
        setRecordState('recording');
      } catch (e: unknown) {
        setError(String(e));
        setRecordState('idle');
      }
    }, 1500); // 1.5s delay for seek to render
  }, [clip]);

  // Monitor playback progress to auto-stop at clip end
  useEffect(() => {
    if (recordState !== 'recording' || !clip) return;

    const clipStartMs = parseTs(clip.startTs);
    const clipEndMs = parseTs(clip.endTs);
    const clipDuration = clipEndMs - clipStartMs;

    const unsub = usePlayback.subscribe((state) => {
      if (!state.currentTs) return;
      const curMs = parseTs(state.currentTs);

      // Update progress
      if (clipDuration > 0) {
        const p = Math.max(0, Math.min(1, (curMs - clipStartMs) / clipDuration));
        setProgress(p);
      }

      // Stop when we pass the clip end
      if (curMs >= clipEndMs) {
        const recorder = recorderRef.current;
        if (recorder && recorder.state === 'recording') {
          recorder.stop();
          usePlayback.getState().pause();
        }
      }
    });

    return unsub;
  }, [recordState, clip]);

  const handleStopRecording = () => {
    const recorder = recorderRef.current;
    if (recorder && recorder.state === 'recording') {
      recorder.stop();
      usePlayback.getState().pause();
    }
  };

  const handleDownloadVideo = () => {
    if (!blobUrlRef.current) return;
    const a = document.createElement('a');
    a.href = blobUrlRef.current;
    a.download = `${safeName}.webm`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(blobUrlRef.current);
    blobUrlRef.current = null;
    onClose();
  };

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (recorderRef.current && recorderRef.current.state === 'recording') {
        recorderRef.current.stop();
      }
      if (blobUrlRef.current) {
        URL.revokeObjectURL(blobUrlRef.current);
      }
    };
  }, []);

  const handlePrimaryAction = () => {
    if (format === 'video') {
      if (recordState === 'idle') handleStartRecording();
      else if (recordState === 'done') handleDownloadVideo();
    } else {
      void handleJsonDownload();
    }
  };

  const isRecording = recordState === 'recording' || recordState === 'preparing';

  return (
    <div
      className="fixed inset-0 bg-black/60 flex items-center justify-center z-[60]"
      onClick={(e) => { if (e.target === e.currentTarget && !isRecording) onClose(); }}
    >
      <div className="bg-zinc-900 border border-zinc-700 rounded-lg shadow-2xl w-80 p-5">
        {/* Title */}
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-bold text-zinc-100 tracking-wider">EXPORT CLIP</h3>
          {!isRecording && (
            <button
              onClick={onClose}
              className="text-zinc-400 hover:text-zinc-100 text-lg leading-none transition-colors"
              title="Close"
            >
              ×
            </button>
          )}
        </div>

        <p className="text-xs text-zinc-400 mb-4 truncate" title={clipTitle}>
          {clipTitle}
        </p>

        {/* Format selector — disabled during recording */}
        {!isRecording && recordState !== 'done' && (
          <div className="space-y-2 mb-4">
            {/* Video option */}
            <label className="flex items-start gap-3 cursor-pointer group">
              <input
                type="radio"
                name="exportFormat"
                value="video"
                checked={format === 'video'}
                onChange={() => setFormat('video')}
                className="mt-0.5 accent-blue-500"
              />
              <div>
                <div className="text-sm text-zinc-200 group-hover:text-zinc-100">
                  {t('export_video')}
                </div>
                <div className="text-xs text-zinc-500 mt-0.5">
                  {t('export_video_desc')}
                </div>
              </div>
            </label>

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
        )}

        {/* Recording progress */}
        {isRecording && (
          <div className="mb-4">
            <div className="flex items-center gap-2 mb-2">
              <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
              <span className="text-sm text-red-400 font-medium">
                {recordState === 'preparing' ? t('recording_preparing') : t('recording')}
              </span>
            </div>
            <div className="w-full h-1.5 bg-zinc-700 rounded-full overflow-hidden">
              <div
                className="h-full bg-red-500 rounded-full transition-all duration-300"
                style={{ width: `${Math.round(progress * 100)}%` }}
              />
            </div>
            <div className="text-xs text-zinc-500 mt-1 text-right">
              {Math.round(progress * 100)}%
            </div>
          </div>
        )}

        {/* Processing state */}
        {recordState === 'processing' && (
          <div className="mb-4 text-center text-sm text-zinc-400">
            Processing video…
          </div>
        )}

        {/* Done state */}
        {recordState === 'done' && (
          <div className="mb-4 flex items-center gap-2">
            <span className="text-green-500 text-lg">✓</span>
            <span className="text-sm text-green-400 font-medium">
              {t('recording_done')}
            </span>
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="mb-3 px-3 py-2 bg-red-900/50 border border-red-700 rounded text-xs text-red-300">
            {error}
          </div>
        )}

        {/* Actions */}
        <div className="flex gap-2">
          {isRecording ? (
            <button
              onClick={handleStopRecording}
              className="flex-1 py-2 bg-red-600 hover:bg-red-500 text-white text-sm rounded transition-colors"
            >
              {t('stop_recording')}
            </button>
          ) : (
            <>
              <button
                onClick={handlePrimaryAction}
                disabled={loading || recordState === 'processing'}
                className="flex-1 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm rounded transition-colors"
              >
                {loading
                  ? 'Exporting…'
                  : format === 'video'
                    ? recordState === 'done'
                      ? 'Download Video'
                      : t('record_start')
                    : 'Download'}
              </button>
              {!isRecording && recordState !== 'done' && (
                <button
                  onClick={onClose}
                  className="px-4 py-2 bg-zinc-700 hover:bg-zinc-600 text-zinc-300 text-sm rounded transition-colors"
                >
                  Cancel
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
