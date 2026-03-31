import { useEffect, useState } from 'react';
import { fetchGames, fetchMeta, GameInfo } from '../lib/api';
import { usePlayback } from '../store/playback';

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
  // "2026-01-17 11:40:00" -> "11:40"
  const parts = ts.split(' ');
  if (parts.length < 2) return ts;
  return parts[1].slice(0, 5);
}

function formatDate(ts: string): string {
  // "2026-01-17 11:40:00" -> "2026-01-17"
  return ts.split(' ')[0] ?? ts;
}

function GameCard({ game, onSelect }: { game: GameInfo; onSelect: (g: GameInfo) => void }) {
  const duration = calcDuration(game.startTime, game.endTime);
  const startTime = formatTime(game.startTime);
  const endTime = formatTime(game.endTime);
  const date = formatDate(game.startTime);

  return (
    <button
      onClick={() => onSelect(game)}
      className="w-full text-left bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 hover:border-zinc-600 rounded-xl p-5 transition-all duration-150 group focus:outline-none focus:ring-2 focus:ring-blue-500"
    >
      {/* Session name */}
      <div className="text-lg font-bold text-zinc-100 group-hover:text-white mb-3">
        Session {game.session}
      </div>

      {/* Stats row */}
      <div className="flex flex-wrap items-center gap-4 mb-3">
        {/* Player count */}
        <div className="flex items-center gap-1.5 text-sm text-zinc-300">
          <svg className="w-4 h-4 text-zinc-500" fill="currentColor" viewBox="0 0 20 20">
            <path d="M9 6a3 3 0 11-6 0 3 3 0 016 0zM17 6a3 3 0 11-6 0 3 3 0 016 0zM12.93 17c.046-.327.07-.66.07-1a6.97 6.97 0 00-1.5-4.33A5 5 0 0119 16v1h-6.07zM6 11a5 5 0 015 5v1H1v-1a5 5 0 015-5z" />
          </svg>
          <span>{game.playerCount} players</span>
        </div>

        {/* Duration */}
        {duration && (
          <div className="flex items-center gap-1.5 text-sm text-zinc-300">
            <svg className="w-4 h-4 text-zinc-500" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-12a1 1 0 10-2 0v4a1 1 0 00.293.707l2.828 2.829a1 1 0 101.415-1.415L11 9.586V6z" clipRule="evenodd" />
            </svg>
            <span>{duration}</span>
          </div>
        )}
      </div>

      {/* Time range */}
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

      {/* Filename */}
      <div className="text-xs text-zinc-600 truncate font-mono">
        {game.filename}
      </div>
    </button>
  );
}

export function GameList() {
  const { setGame } = usePlayback();
  const [games, setGames] = useState<GameInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selecting, setSelecting] = useState<string | null>(null);

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
      const meta = await fetchMeta(g.id);
      setGame(g.id, meta);
    } catch (e: unknown) {
      setError(String(e));
      setSelecting(null);
    }
  };

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 flex flex-col">
      {/* Header */}
      <div className="border-b border-zinc-800 px-6 py-4 flex items-center">
        <div className="text-sm font-bold text-zinc-100 tracking-wider">WARGAME REPLAY</div>
      </div>

      {/* Content */}
      <div className="flex-1 flex flex-col items-center justify-center px-4 py-12">
        <h1 className="text-2xl font-bold text-zinc-100 mb-2">Select a Game</h1>
        <p className="text-sm text-zinc-500 mb-8">Choose a session to replay</p>

        {/* Error state */}
        {error && (
          <div className="mb-6 px-4 py-3 bg-red-900/40 border border-red-700/60 rounded-lg text-sm text-red-300 max-w-md w-full text-center">
            {error}
          </div>
        )}

        {/* Loading state */}
        {loading && (
          <div className="flex flex-col items-center gap-3 text-zinc-500">
            <div className="w-6 h-6 border-2 border-zinc-700 border-t-zinc-400 rounded-full animate-spin" />
            <span className="text-sm">Loading games…</span>
          </div>
        )}

        {/* Empty state */}
        {!loading && !error && games.length === 0 && (
          <div className="flex flex-col items-center gap-2 text-zinc-500 max-w-sm text-center">
            <svg className="w-12 h-12 text-zinc-700 mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
            </svg>
            <p className="text-sm font-medium text-zinc-400">No games found</p>
            <p className="text-xs text-zinc-600">Place .db files in the server directory.</p>
          </div>
        )}

        {/* Game cards */}
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
      </div>
    </div>
  );
}
