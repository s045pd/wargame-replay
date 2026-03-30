import { usePlayback } from '../store/playback';
import { useDirector } from '../store/director';

export function TopBar() {
  const { meta, coordMode } = usePlayback();
  const { mode, setMode } = useDirector();

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
      <div className="flex items-center gap-1">
        <button
          onClick={() => setMode('replay')}
          className={`px-3 py-1 text-xs rounded transition-colors ${
            mode === 'replay'
              ? 'bg-blue-600 text-white'
              : 'bg-zinc-800 hover:bg-zinc-700 text-zinc-300'
          }`}
          title="Replay mode (Tab)"
        >
          Replay
        </button>
        <button
          onClick={() => setMode('director')}
          className={`px-3 py-1 text-xs rounded transition-colors ${
            mode === 'director'
              ? 'bg-amber-600 text-white'
              : 'bg-zinc-800 hover:bg-zinc-700 text-zinc-300'
          }`}
          title="Director mode (Tab)"
        >
          Director
        </button>
      </div>
    </div>
  );
}
