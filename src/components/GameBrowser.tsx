// ── GameBrowser: online game list + local file drop fallback ──

import { useCallback, useEffect, useRef, useState } from 'react';
import { useI18n } from '../lib/i18n';
import { EngineBridge } from '../engine/bridge';
import { usePlayback } from '../store/playback';

interface GameEntry {
  id: string;
  name: string;
  date: string;
  start: string;
  end: string;
  players: number;
  location: string;
  dbSize: number;
  dbUrl: string;
  txtUrl?: string;
}

interface GameIndex {
  games: GameEntry[];
}

interface GameBrowserProps {
  isMobile?: boolean;
}

function formatSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function GameBrowser({ isMobile = false }: GameBrowserProps) {
  const { t } = useI18n();
  const setGame = usePlayback((s) => s.setGame);

  // ── Online game list state ──
  const [games, setGames] = useState<GameEntry[]>([]);
  const [loadingList, setLoadingList] = useState(true);
  const [listError, setListError] = useState<string | null>(null);

  // ── Download + init state ──
  const [activeDownload, setActiveDownload] = useState<string | null>(null);
  const [dlProgress, setDlProgress] = useState({ stage: '', percent: 0 });
  const [error, setError] = useState<string | null>(null);

  // ── Local file drop state ──
  const [showLocalDrop, setShowLocalDrop] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ── Fetch game list on mount ──
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('./games/index.json');
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data: GameIndex = await res.json();
        if (!cancelled) {
          setGames(data.games ?? []);
          setLoadingList(false);
        }
      } catch (e) {
        if (!cancelled) {
          setListError(String(e));
          setLoadingList(false);
        }
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // ── Download remote game and init engine ──
  const loadRemoteGame = useCallback(async (game: GameEntry) => {
    if (activeDownload) return;
    setActiveDownload(game.id);
    setError(null);
    setDlProgress({ stage: t('gb_downloading_db'), percent: 0 });

    try {
      // Download .db with streaming progress
      const dbBuffer = await fetchWithProgress(game.dbUrl, game.dbSize, (pct) => {
        setDlProgress({ stage: t('gb_downloading_db'), percent: Math.round(pct * 70) });
      });

      // Download .txt (small, no progress needed)
      let txtContent: string | undefined;
      if (game.txtUrl) {
        setDlProgress({ stage: t('gb_downloading_txt'), percent: 72 });
        try {
          const txtRes = await fetch(game.txtUrl);
          if (txtRes.ok) txtContent = await txtRes.text();
        } catch {
          // .txt is optional, ignore errors
        }
      }

      // Init engine
      setDlProgress({ stage: t('gb_initializing'), percent: 75 });
      const bridge = new EngineBridge();
      const { meta, hotspots, allKills, timestamps } = await bridge.init(dbBuffer, txtContent, (stage, percent) => {
        // Map engine progress 0-100 into our 75-100 range
        setDlProgress({ stage, percent: 75 + Math.round(percent * 0.25) });
      });

      setGame(meta, hotspots, allKills, bridge, timestamps);
    } catch (err) {
      setError(String(err));
      setActiveDownload(null);
    }
  }, [activeDownload, setGame, t]);

  // ── Process local files (same as old FileDrop) ──
  const processFiles = useCallback(async (files: FileList | File[]) => {
    setError(null);
    setActiveDownload('local');
    setDlProgress({ stage: 'Reading files...', percent: 0 });

    let dbFile: File | null = null;
    let txtFile: File | null = null;
    for (const f of files) {
      const name = f.name.toLowerCase();
      if (name.endsWith('.db')) dbFile = f;
      else if (name.endsWith('.txt')) txtFile = f;
    }
    if (!dbFile) {
      setError(t('file_drop_no_db'));
      setActiveDownload(null);
      return;
    }

    try {
      setDlProgress({ stage: 'Reading .db file...', percent: 1 });
      const dbBuffer = await dbFile.arrayBuffer();
      let txtContent: string | undefined;
      if (txtFile) {
        setDlProgress({ stage: 'Reading .txt sidecar...', percent: 2 });
        txtContent = await txtFile.text();
      }

      const bridge = new EngineBridge();
      const { meta, hotspots, allKills, timestamps } = await bridge.init(dbBuffer, txtContent, (stage, percent) => {
        setDlProgress({ stage, percent });
      });
      setGame(meta, hotspots, allKills, bridge, timestamps);
    } catch (err) {
      setError(String(err));
      setActiveDownload(null);
    }
  }, [setGame, t]);

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer.files.length > 0) void processFiles(e.dataTransfer.files);
  }, [processFiles]);

  const onFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) void processFiles(e.target.files);
  }, [processFiles]);

  const isLoading = activeDownload !== null;

  return (
    <div className="h-screen bg-zinc-950 text-zinc-100 flex flex-col items-center overflow-y-auto">
      <div className={`${isMobile ? 'max-w-sm px-4 pt-8 pb-20' : 'max-w-2xl px-6 pt-16 pb-12'} w-full`}>
        {/* Header */}
        <h1 className={`${isMobile ? 'text-xl' : 'text-2xl'} font-bold text-center mb-1`}>MilSim Replay Lite</h1>
        <p className={`text-zinc-400 ${isMobile ? 'text-xs' : 'text-sm'} text-center mb-6`}>
          {t('gb_subtitle')}
        </p>

        {/* Online game list */}
        <div className="mb-6">
          <h2 className={`${isMobile ? 'text-sm' : 'text-base'} font-semibold text-zinc-300 mb-3`}>
            {t('gb_available_games')}
          </h2>

          {loadingList ? (
            <div className="flex items-center justify-center h-20 text-zinc-500 text-sm">
              {t('loading_games')}
            </div>
          ) : listError ? (
            <div className="p-3 bg-red-900/30 border border-red-800 rounded-lg text-red-300 text-sm">
              {listError}
            </div>
          ) : games.length === 0 ? (
            <div className="flex items-center justify-center h-20 text-zinc-500 text-sm">
              {t('no_games')}
            </div>
          ) : (
            <div className={`grid gap-3 ${isMobile ? 'grid-cols-1' : 'grid-cols-2'}`}>
              {games.map(game => {
                const isThis = activeDownload === game.id;
                return (
                  <button
                    key={game.id}
                    onClick={() => void loadRemoteGame(game)}
                    disabled={isLoading}
                    className={`
                      text-left rounded-lg border transition-all
                      ${isThis
                        ? 'border-emerald-600 bg-emerald-950/50'
                        : isLoading
                          ? 'border-zinc-800 bg-zinc-900/30 opacity-50 cursor-not-allowed'
                          : 'border-zinc-700 bg-zinc-900/50 hover:border-zinc-500 hover:bg-zinc-900 cursor-pointer'
                      }
                      ${isMobile ? 'p-3' : 'p-4'}
                    `}
                  >
                    {/* Title row */}
                    <div className="flex items-center justify-between mb-1.5">
                      <span className={`font-semibold ${isMobile ? 'text-sm' : 'text-base'} text-zinc-100`}>
                        {game.name}
                      </span>
                      <span className="text-xs text-zinc-500">{formatSize(game.dbSize)}</span>
                    </div>

                    {/* Meta row */}
                    <div className={`flex flex-wrap gap-x-3 gap-y-1 ${isMobile ? 'text-[10px]' : 'text-xs'} text-zinc-400`}>
                      <span>📅 {game.date}</span>
                      <span>🕐 {game.start}–{game.end}</span>
                      <span>📍 {game.location}</span>
                      <span>👥 {game.players} {t('players')}</span>
                    </div>

                    {/* Download progress */}
                    {isThis && (
                      <div className="mt-3 space-y-1.5">
                        <div className="text-[11px] text-emerald-300">{dlProgress.stage}</div>
                        <div className="w-full bg-zinc-800 rounded-full h-1.5">
                          <div
                            className="bg-emerald-500 h-1.5 rounded-full transition-all duration-300"
                            style={{ width: `${dlProgress.percent}%` }}
                          />
                        </div>
                        <div className="text-[10px] text-zinc-500 text-right">{dlProgress.percent}%</div>
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Divider */}
        <div className="flex items-center gap-3 mb-4">
          <div className="flex-1 h-px bg-zinc-800" />
          <span className="text-xs text-zinc-600">{t('gb_or_local')}</span>
          <div className="flex-1 h-px bg-zinc-800" />
        </div>

        {/* Local file section — collapsible on desktop, always open on mobile */}
        {isMobile ? (
          <LocalDropZone
            isMobile
            isLoading={isLoading}
            dragOver={dragOver}
            fileInputRef={fileInputRef}
            dlProgress={dlProgress}
            activeDownload={activeDownload}
            onDrop={onDrop}
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onFileSelect={onFileSelect}
            t={t}
          />
        ) : (
          <>
            <button
              onClick={() => setShowLocalDrop(v => !v)}
              className="w-full text-left text-sm text-zinc-400 hover:text-zinc-200 transition-colors mb-3"
            >
              {showLocalDrop ? '▾' : '▸'} {t('gb_load_local')}
            </button>
            {showLocalDrop && (
              <LocalDropZone
                isMobile={false}
                isLoading={isLoading}
                dragOver={dragOver}
                fileInputRef={fileInputRef}
                dlProgress={dlProgress}
                activeDownload={activeDownload}
                onDrop={onDrop}
                onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                onDragLeave={() => setDragOver(false)}
                onFileSelect={onFileSelect}
                t={t}
              />
            )}
          </>
        )}

        {/* Error display */}
        {error && (
          <div className="mt-4 p-3 bg-red-900/30 border border-red-800 rounded-lg text-red-300 text-sm">
            {error}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Helpers ──

async function fetchWithProgress(
  url: string,
  expectedSize: number,
  onProgress: (ratio: number) => void,
): Promise<ArrayBuffer> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download failed: HTTP ${res.status}`);

  const reader = res.body?.getReader();
  if (!reader) {
    // Fallback: no streaming support
    return res.arrayBuffer();
  }

  const contentLength = Number(res.headers.get('content-length')) || expectedSize;
  const chunks: Uint8Array[] = [];
  let received = 0;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.length;
    if (contentLength > 0) {
      onProgress(Math.min(1, received / contentLength));
    }
  }

  // Merge chunks into a single ArrayBuffer
  const merged = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.length;
  }
  return merged.buffer;
}

// ── Local file drop zone (extracted for reuse) ──

interface LocalDropZoneProps {
  isMobile: boolean;
  isLoading: boolean;
  dragOver: boolean;
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  dlProgress: { stage: string; percent: number };
  activeDownload: string | null;
  onDrop: (e: React.DragEvent) => void;
  onDragOver: (e: React.DragEvent) => void;
  onDragLeave: () => void;
  onFileSelect: (e: React.ChangeEvent<HTMLInputElement>) => void;
  t: (key: string) => string;
}

function LocalDropZone({
  isMobile, isLoading, dragOver, fileInputRef, dlProgress, activeDownload,
  onDrop, onDragOver, onDragLeave, onFileSelect, t,
}: LocalDropZoneProps) {
  const showingProgress = activeDownload === 'local';
  return (
    <div
      onDrop={onDrop}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onClick={() => fileInputRef.current?.click()}
      className={`
        border-2 border-dashed rounded-xl ${isMobile ? 'p-6' : 'p-8'} text-center cursor-pointer transition-all
        ${dragOver
          ? 'border-emerald-500 bg-emerald-500/10'
          : 'border-zinc-700 hover:border-zinc-500 bg-zinc-900/50 hover:bg-zinc-900'}
        ${isLoading ? 'pointer-events-none opacity-60' : ''}
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

      {showingProgress ? (
        <div className="space-y-3">
          <div className="text-sm text-zinc-300">{dlProgress.stage}</div>
          <div className="w-full bg-zinc-800 rounded-full h-2">
            <div
              className="bg-emerald-500 h-2 rounded-full transition-all duration-300"
              style={{ width: `${dlProgress.percent}%` }}
            />
          </div>
          <div className="text-xs text-zinc-500">{dlProgress.percent}%</div>
        </div>
      ) : (
        <>
          <svg className={`${isMobile ? 'w-8 h-8 mb-2' : 'w-10 h-10 mb-3'} mx-auto text-zinc-600`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
              d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"
            />
          </svg>
          <div className={`text-zinc-300 ${isMobile ? 'text-xs' : 'text-sm'} mb-1`}>
            {isMobile ? t('file_drop_hint_mobile') : t('file_drop_hint')}
          </div>
          <div className="text-zinc-500 text-xs">
            {t('file_drop_formats')}
          </div>
        </>
      )}
    </div>
  );
}
