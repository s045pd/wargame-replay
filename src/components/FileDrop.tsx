// ── FileDrop: drag-and-drop .db + .txt loading (replaces GameList) ──

import { useCallback, useRef, useState } from 'react';
import { useI18n } from '../lib/i18n';
import { EngineBridge } from '../engine/bridge';
import { usePlayback } from '../store/playback';

interface FileDropProps {
  isMobile?: boolean;
}

export function FileDrop({ isMobile = false }: FileDropProps) {
  const { t } = useI18n();
  const setGame = usePlayback((s) => s.setGame);
  const [dragOver, setDragOver] = useState(false);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState({ stage: '', percent: 0 });
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const processFiles = useCallback(async (files: FileList | File[]) => {
    setError(null);
    setLoading(true);
    setProgress({ stage: 'Reading files...', percent: 0 });

    let dbFile: File | null = null;
    let txtFile: File | null = null;

    for (const f of files) {
      const name = f.name.toLowerCase();
      if (name.endsWith('.db')) dbFile = f;
      else if (name.endsWith('.txt')) txtFile = f;
    }

    if (!dbFile) {
      setError(t('file_drop_no_db') || 'No .db file found. Please select a valid game database file.');
      setLoading(false);
      return;
    }

    try {
      // Read files
      setProgress({ stage: 'Reading .db file...', percent: 1 });
      const dbBuffer = await dbFile.arrayBuffer();

      let txtContent: string | undefined;
      if (txtFile) {
        setProgress({ stage: 'Reading .txt sidecar...', percent: 2 });
        txtContent = await txtFile.text();
      }

      // Initialize engine
      const bridge = new EngineBridge();
      const { meta, hotspots, allKills, timestamps } = await bridge.init(dbBuffer, txtContent, (stage, percent) => {
        setProgress({ stage, percent });
      });

      setGame(meta, hotspots, allKills, bridge, timestamps);
    } catch (err) {
      setError(String(err));
      setLoading(false);
    }
  }, [setGame, t]);

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer.files.length > 0) {
      void processFiles(e.dataTransfer.files);
    }
  }, [processFiles]);

  const onDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(true);
  }, []);

  const onDragLeave = useCallback(() => {
    setDragOver(false);
  }, []);

  const onFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      void processFiles(e.target.files);
    }
  }, [processFiles]);

  return (
    <div className="h-screen bg-zinc-950 text-zinc-100 flex items-center justify-center">
      <div className={`${isMobile ? 'max-w-sm' : 'max-w-lg'} w-full mx-4`}>
        <h1 className={`${isMobile ? 'text-xl' : 'text-2xl'} font-bold text-center mb-2`}>MilSim Replay Lite</h1>
        <p className={`text-zinc-400 ${isMobile ? 'text-xs' : 'text-sm'} text-center mb-6`}>
          {t('file_drop_desc') || 'Browser-only replay viewer. Drop your .db game file (and optional .txt sidecar) to start.'}
        </p>

        <div
          onDrop={onDrop}
          onDragOver={onDragOver}
          onDragLeave={onDragLeave}
          onClick={() => fileInputRef.current?.click()}
          className={`
            border-2 border-dashed rounded-xl ${isMobile ? 'p-8' : 'p-12'} text-center cursor-pointer transition-all
            ${dragOver
              ? 'border-emerald-500 bg-emerald-500/10'
              : 'border-zinc-700 hover:border-zinc-500 bg-zinc-900/50 hover:bg-zinc-900'}
            ${loading ? 'pointer-events-none opacity-60' : ''}
          `}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept=".db,.txt"
            multiple
            onChange={onFileSelect}
            className="hidden"
          />

          {loading ? (
            <div className="space-y-3">
              <div className="text-sm text-zinc-300">{progress.stage}</div>
              <div className="w-full bg-zinc-800 rounded-full h-2">
                <div
                  className="bg-emerald-500 h-2 rounded-full transition-all duration-300"
                  style={{ width: `${progress.percent}%` }}
                />
              </div>
              <div className="text-xs text-zinc-500">{progress.percent}%</div>
            </div>
          ) : (
            <>
              <svg className={`${isMobile ? 'w-10 h-10 mb-3' : 'w-12 h-12 mb-4'} mx-auto text-zinc-600`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                  d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"
                />
              </svg>
              <div className={`text-zinc-300 ${isMobile ? 'text-xs' : 'text-sm'} mb-1`}>
                {isMobile
                  ? (t('file_drop_hint_mobile') || 'Tap to select .db + .txt files')
                  : (t('file_drop_hint') || 'Drop .db + .txt files here, or click to browse')
                }
              </div>
              <div className="text-zinc-500 text-xs">
                {t('file_drop_formats') || 'Supports: .db (game database) + .txt (map sidecar, optional)'}
              </div>
            </>
          )}
        </div>

        {error && (
          <div className="mt-4 p-3 bg-red-900/30 border border-red-800 rounded-lg text-red-300 text-sm">
            {error}
          </div>
        )}
      </div>
    </div>
  );
}

