import { useEffect, useState } from 'react';
import { TopBar } from './components/TopBar';
import { usePlayback } from './store/playback';
import { fetchGames, fetchMeta, GameInfo } from './lib/api';

export default function App() {
  const { gameId, setGame, connectWs } = usePlayback();
  const [games, setGames] = useState<GameInfo[]>([]);

  useEffect(() => {
    fetchGames().then(setGames).catch(console.error);
  }, []);

  const selectGame = async (g: GameInfo) => {
    const meta = await fetchMeta(g.id);
    setGame(g.id, meta);
    // Will connect WS in next effect
  };

  useEffect(() => {
    if (gameId) {
      connectWs();
    }
  }, [gameId, connectWs]);

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
      <div className="flex-1 relative">
        {/* Map view will go here (Task 10) */}
        <div className="absolute inset-0 flex items-center justify-center text-zinc-600">
          Map Loading...
        </div>
      </div>
      {/* Timeline will go here (Task 11) */}
    </div>
  );
}
