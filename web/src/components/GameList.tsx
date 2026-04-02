import { useEffect, useState, useRef, useCallback } from 'react';
import { fetchGames, fetchMeta, fetchHotspots, uploadFiles, UploadFileResult, GameInfo } from '../lib/api';
import { usePlayback } from '../store/playback';
import { useI18n } from '../lib/i18n';
import { Settings } from './Settings';

function calcDuration(startTime: string, endTime: string): string {
  const start = new Date(startTime.replace(' ', 'T'));
  const end = new Date(endTime.replace(' ', 'T'));
  const diffMs = end.getTime() - start.getTime();
  if (isNaN(diffMs) || diffMs < 0) return '';
  const totalSec = Math.floor(diffMs / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function formatTime(ts: string): string {
  const parts = ts.split(' ');
  if (parts.length < 2) return ts;
  return parts[1].slice(0, 5);
}

function formatDate(ts: string): string {
  return ts.split(' ')[0] ?? ts;
}

function GameCard({ game, onSelect }: { game: GameInfo; onSelect: (g: GameInfo) => void }) {
  const { t } = useI18n();
  const duration = calcDuration(game.startTime, game.endTime);
  const startTime = formatTime(game.startTime);
  const endTime = formatTime(game.endTime);
  const date = formatDate(game.startTime);

  return (
    <button
      onClick={() => onSelect(game)}
      className="w-full text-left bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 hover:border-zinc-600 rounded-xl p-5 transition-all duration-150 group focus:outline-none focus:ring-2 focus:ring-blue-500"
    >
      <div className="text-lg font-bold text-zinc-100 group-hover:text-white mb-3">
        {t('session')} {game.session}
      </div>
      <div className="flex flex-wrap items-center gap-4 mb-3">
        <div className="flex items-center gap-1.5 text-sm text-zinc-300">
          <svg className="w-4 h-4 text-zinc-500" fill="currentColor" viewBox="0 0 20 20">
            <path d="M9 6a3 3 0 11-6 0 3 3 0 016 0zM17 6a3 3 0 11-6 0 3 3 0 016 0zM12.93 17c.046-.327.07-.66.07-1a6.97 6.97 0 00-1.5-4.33A5 5 0 0119 16v1h-6.07zM6 11a5 5 0 015 5v1H1v-1a5 5 0 015-5z" />
          </svg>
          <span>{game.playerCount} {t('players')}</span>
        </div>
        {duration && (
          <div className="flex items-center gap-1.5 text-sm text-zinc-300">
            <svg className="w-4 h-4 text-zinc-500" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-12a1 1 0 10-2 0v4a1 1 0 00.293.707l2.828 2.829a1 1 0 101.415-1.415L11 9.586V6z" clipRule="evenodd" />
            </svg>
            <span>{duration}</span>
          </div>
        )}
      </div>
      <div className="flex items-center gap-2 text-sm text-zinc-400 mb-3">
        <svg className="w-3.5 h-3.5 text-zinc-600 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
          <path fillRule="evenodd" d="M6 2a1 1 0 00-1 1v1H4a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V6a2 2 0 00-2-2h-1V3a1 1 0 10-2 0v1H7V3a1 1 0 00-1-1zm0 5a1 1 0 000 2h8a1 1 0 100-2H6z" clipRule="evenodd" />
        </svg>
        <span>{date}</span>
        <span className="text-zinc-600">·</span>
        <span className="font-mono text-zinc-300">{startTime}</span>
        <span className="text-zinc-600">→</span>
        <span className="font-mono text-zinc-300">{endTime}</span>
      </div>
      <div className="text-xs text-zinc-600 truncate font-mono">
        {game.filename}
      </div>
    </button>
  );
}

function UploadZone({ onUploaded }: { onUploaded: (g: GameInfo) => void }) {
  const { t } = useI18n();
  const fileRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [results, setResults] = useState<UploadFileResult[]>([]);

  const handleFiles = useCallback(async (fileList: FileList | File[]) => {
    const files = Array.from(fileList).filter(
      f => f.name.endsWith('.db') || f.name.endsWith('.txt'),
    );
    if (files.length === 0) {
      setResults([{ filename: '', status: 'error', message: t('upload_no_valid') }]);
      return;
    }
    setUploading(true);
    setResults([]);
    try {
      const res = await uploadFiles(files);
      setResults(res);
      // Notify parent for each successfully imported game
      for (const r of res) {
        if (r.status === 'ok' && r.game) onUploaded(r.game);
      }
    } catch (e: unknown) {
      setResults([{ filename: '', status: 'error', message: String(e instanceof Error ? e.message : e) }]);
    } finally {
      setUploading(false);
    }
  }, [onUploaded, t]);

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    if (e.dataTransfer.files.length > 0) void handleFiles(e.dataTransfer.files);
  }, [handleFiles]);

  const onDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragging(true);
  }, []);

  const onDragLeave = useCallback(() => setDragging(false), []);

  const onChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) void handleFiles(files);
    if (fileRef.current) fileRef.current.value = '';
  }, [handleFiles]);

  const okCount = results.filter(r => r.status === 'ok').length;
  const errCount = results.filter(r => r.status === 'error').length;

  return (
    <div className="w-full max-w-lg">
      <div
        onDrop={onDrop}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onClick={() => fileRef.current?.click()}
        className={`relative cursor-pointer border-2 border-dashed rounded-xl p-6 text-center transition-all duration-150 ${
          dragging
            ? 'border-blue-500 bg-blue-500/10'
            : 'border-zinc-700 hover:border-zinc-500 bg-zinc-900/50 hover:bg-zinc-900'
        }`}
      >
        <input
          ref={fileRef}
          type="file"
          accept=".db,.txt"
          multiple
          onChange={onChange}
          className="hidden"
        />

        {uploading ? (
          <div className="flex flex-col items-center gap-2">
            <div className="w-6 h-6 border-2 border-zinc-500 border-t-blue-400 rounded-full animate-spin" />
            <span className="text-sm text-zinc-400">{t('uploading')}</span>
          </div>
        ) : (
          <>
            <svg className="w-8 h-8 mx-auto text-zinc-600 mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
            </svg>
            <p className="text-sm text-zinc-400">
              {dragging ? t('drop_here') : t('upload_hint')}
            </p>
            <p className="text-[10px] text-zinc-600 mt-1 font-mono">
              {t('file_pattern_hint')}
            </p>
          </>
        )}
      </div>

      {/* Upload results */}
      {results.length > 0 && (
        <div className="mt-2 space-y-1">
          {/* Summary */}
          <div className={`px-3 py-1.5 rounded-lg text-xs text-center ${
            errCount === 0
              ? 'bg-emerald-900/40 border border-emerald-700/60 text-emerald-300'
              : okCount > 0
                ? 'bg-amber-900/40 border border-amber-700/60 text-amber-300'
                : 'bg-red-900/40 border border-red-700/60 text-red-300'
          }`}>
            {okCount > 0 && <span>{t('upload_ok_count').replace('{n}', String(okCount))}</span>}
            {okCount > 0 && errCount > 0 && <span> · </span>}
            {errCount > 0 && <span>{t('upload_err_count').replace('{n}', String(errCount))}</span>}
          </div>
          {/* Per-file details */}
          {results.filter(r => r.status === 'error').map((r, i) => (
            <div key={i} className="px-3 py-1 bg-red-900/30 border border-red-800/40 rounded text-[10px] text-red-400 truncate">
              {r.filename && <span className="font-mono">{r.filename}: </span>}
              {r.message}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function GameList() {
  const { setGame, setAllHotspots } = usePlayback();
  const { t } = useI18n();
  const [games, setGames] = useState<GameInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selecting, setSelecting] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);

  useEffect(() => {
    setLoading(true);
    fetchGames()
      .then(data => setGames(data ?? []))
      .catch((e: unknown) => setError(String(e)))
      .finally(() => setLoading(false));
  }, []);

  const handleSelect = async (g: GameInfo) => {
    if (selecting) return;
    setSelecting(g.id);
    try {
      const [meta, hotspots] = await Promise.all([
        fetchMeta(g.id),
        fetchHotspots(g.id),
      ]);
      setGame(g.id, meta);
      setAllHotspots(hotspots ?? []);
    } catch (e: unknown) {
      setError(String(e));
      setSelecting(null);
    }
  };

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 flex flex-col">
      <div className="border-b border-zinc-800 px-6 py-4 flex items-center">
        <div className="text-sm font-bold text-zinc-100 tracking-wider">{t('app_title')}</div>
        <div className="ml-auto flex items-center gap-3">
          <button
            onClick={() => setShowSettings(true)}
            className="text-zinc-500 hover:text-zinc-200 transition-colors"
            title={t('settings')}
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.325.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.241-.438.613-.431.992a6.759 6.759 0 010 .255c-.007.38.138.75.43.991l1.004.827c.424.35.534.955.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.57 6.57 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.281c-.09.543-.56.941-1.11.941h-2.594c-.55 0-1.019-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.991a6.932 6.932 0 010-.255c.007-.38-.138-.751-.43-.992l-1.004-.827a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.087.22-.128.332-.183.582-.495.644-.869l.214-1.28z" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
          </button>
          <a
            href="https://github.com/s045pd/wargame-replay"
            target="_blank"
            rel="noopener noreferrer"
            className="text-zinc-500 hover:text-zinc-200 transition-colors"
            title="GitHub"
          >
            <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
              <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z" />
            </svg>
          </a>
        </div>
      </div>
      <div className="flex-1 flex flex-col items-center justify-center px-4 py-12">
        <h1 className="text-2xl font-bold text-zinc-100 mb-2">{t('select_game')}</h1>
        <p className="text-sm text-zinc-500 mb-8">{t('choose_session')}</p>

        {error && (
          <div className="mb-6 px-4 py-3 bg-red-900/40 border border-red-700/60 rounded-lg text-sm text-red-300 max-w-md w-full text-center">
            {error}
          </div>
        )}

        {loading && (
          <div className="flex flex-col items-center gap-3 text-zinc-500">
            <div className="w-6 h-6 border-2 border-zinc-700 border-t-zinc-400 rounded-full animate-spin" />
            <span className="text-sm">{t('loading_games')}</span>
          </div>
        )}

        {!loading && !error && games.length === 0 && (
          <div className="flex flex-col items-center gap-2 text-zinc-500 max-w-sm text-center">
            <svg className="w-12 h-12 text-zinc-700 mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
            </svg>
            <p className="text-sm font-medium text-zinc-400">{t('no_games')}</p>
            <p className="text-xs text-zinc-600">{t('no_games_hint')}</p>
          </div>
        )}

        {!loading && games.length > 0 && (
          <div className="w-full max-w-lg space-y-3">
            {games.map(g => (
              <div key={g.id} className="relative">
                <GameCard game={g} onSelect={(game) => void handleSelect(game)} />
                {selecting === g.id && (
                  <div className="absolute inset-0 bg-zinc-900/70 rounded-xl flex items-center justify-center">
                    <div className="w-5 h-5 border-2 border-zinc-500 border-t-blue-400 rounded-full animate-spin" />
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Upload zone — always visible when not loading */}
        {!loading && (
          <div className="mt-6">
            <UploadZone onUploaded={(g) => setGames(prev => [...prev, g])} />
          </div>
        )}
      </div>
      {showSettings && <Settings onClose={() => setShowSettings(false)} />}
    </div>
  );
}
