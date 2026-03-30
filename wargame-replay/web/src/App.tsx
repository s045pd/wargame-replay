import { useEffect, useState } from 'react';
import { TopBar } from './components/TopBar';
import { usePlayback } from './store/playback';
import { useDirector } from './store/director';
import { useClips } from './store/clips';
import { fetchGames, fetchMeta, GameInfo } from './lib/api';
import { MapView } from './map/MapView';
import { RelativeCanvas } from './map/RelativeCanvas';
import { Timeline } from './timeline/Timeline';
import { DirectorPanel } from './director/DirectorPanel';
import { BookmarkList } from './clips/BookmarkList';

export default function App() {
  const { gameId, setGame, connectWs, units, coordMode, currentTs } = usePlayback();
  const { mode, setMode } = useDirector();
  const { addBookmark } = useClips();
  const [games, setGames] = useState<GameInfo[]>([]);
  const [showBookmarks, setShowBookmarks] = useState(false);

  useEffect(() => {
    fetchGames().then(setGames).catch(console.error);
  }, []);

  const selectGame = async (g: GameInfo) => {
    const meta = await fetchMeta(g.id);
    setGame(g.id, meta);
  };

  useEffect(() => {
    if (gameId) {
      connectWs();
    }
  }, [gameId, connectWs]);

  // Tab key toggles between Replay and Director mode
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (e.key === 'Tab') {
        e.preventDefault();
        setMode(mode === 'replay' ? 'director' : 'replay');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [mode, setMode]);

  // B key — toggle bookmark panel; Shift+B adds a bookmark at current timestamp
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (e.key === 'b' || e.key === 'B') {
        if (e.shiftKey) {
          // Shift+B: add bookmark at current timestamp
          if (!gameId || !currentTs) return;
          const ts = currentTs;
          const hh = ts.slice(11, 13);
          const mm = ts.slice(14, 16);
          const ss = ts.slice(17, 19);
          const title = `Bookmark at ${hh}:${mm}:${ss}`;
          void addBookmark(gameId, { ts, title, tags: [] });
        } else {
          // B: toggle the bookmark panel
          setShowBookmarks((prev) => !prev);
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [gameId, currentTs, addBookmark]);

  if (!gameId) {
    return (
      <div className="h-screen bg-zinc-950 text-zinc-100 flex flex-col items-center justify-center">
        <h1 className="text-2xl font-bold mb-8">WarGame Replay</h1>
        <div className="space-y-2">
          {games.map(g => (
            <button
              key={g.id}
              onClick={() => void selectGame(g)}
              className="block w-80 p-4 bg-zinc-900 hover:bg-zinc-800 rounded-lg text-left border border-zinc-800"
            >
              <div className="font-medium">{g.displayName}</div>
              <div className="text-xs text-zinc-500 mt-1">{g.playerCount} players · {g.filename}</div>
            </button>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen bg-zinc-950 text-zinc-100 flex flex-col">
      <TopBar />
      {mode === 'director' ? (
        <DirectorPanel />
      ) : (
        <div className="flex-1 relative">
          {coordMode === 'wgs84' ? (
            <MapView units={units} />
          ) : (
            <RelativeCanvas units={units} />
          )}
        </div>
      )}
      <Timeline />
      {showBookmarks && (
        <BookmarkList onClose={() => setShowBookmarks(false)} />
      )}
    </div>
  );
}
