import { usePlayback } from '../store/playback';

export function TopBar() {
  const { meta, coordMode } = usePlayback();

  return (
    <div className="h-12 bg-zinc-900 border-b border-zinc-800 flex items-center px-4 gap-4">
      <div className="text-sm font-bold text-zinc-100 tracking-wider">
        WARGAME REPLAY
      </div>
      <div className="h-4 w-px bg-zinc-700" />
      {meta && (
        <div className="text-xs text-zinc-400">
          {meta.players.length} players · {coordMode}
        </div>
      )}
      <div className="flex-1" />
      <div className="flex items-center gap-2">
        <button className="px-3 py-1 text-xs bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded">
          Replay
        </button>
        <button className="px-3 py-1 text-xs bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded">
          Director
        </button>
      </div>
    </div>
  );
}
