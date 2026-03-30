import { Play, Pause, SkipForward, SkipBack, ChevronDown } from 'lucide-react';
import { usePlayback } from '../store/playback';

const SPEEDS = [1, 2, 4, 8, 16] as const;

/** Format an ISO timestamp string as HH:MM:SS */
function formatTime(ts: string): string {
  if (!ts) return '--:--:--';
  const d = new Date(ts);
  if (isNaN(d.getTime())) return '--:--:--';
  return d.toISOString().slice(11, 19);
}

/** Add seconds to an ISO timestamp string, clamped to [min, max] */
function addSeconds(ts: string, seconds: number, min: string, max: string): string {
  const ms = new Date(ts).getTime() + seconds * 1000;
  const minMs = new Date(min).getTime();
  const maxMs = new Date(max).getTime();
  return new Date(Math.max(minMs, Math.min(maxMs, ms))).toISOString();
}

interface TransportControlsProps {
  immersive: boolean;
}

export function TransportControls({ immersive: _immersive }: TransportControlsProps) {
  const { playing, speed, currentTs, meta, play, pause, seek, setSpeed } = usePlayback();

  const handleSkip = (delta: number) => {
    if (!meta) return;
    const next = addSeconds(currentTs, delta, meta.startTime, meta.endTime);
    seek(next);
  };

  const handlePlayPause = () => {
    if (playing) {
      pause();
    } else {
      play();
    }
  };

  return (
    <div className="flex items-center gap-3 px-3 h-10 bg-zinc-900 border-t border-zinc-800 shrink-0">
      {/* Skip back */}
      <button
        onClick={() => handleSkip(-30)}
        title="Skip back 30s"
        className="p-1 text-zinc-400 hover:text-zinc-100 transition-colors"
      >
        <SkipBack size={16} />
      </button>

      {/* Play/Pause */}
      <button
        onClick={handlePlayPause}
        title={playing ? 'Pause' : 'Play'}
        className="p-1 text-zinc-100 hover:text-white transition-colors"
      >
        {playing ? <Pause size={18} /> : <Play size={18} />}
      </button>

      {/* Skip forward */}
      <button
        onClick={() => handleSkip(30)}
        title="Skip forward 30s"
        className="p-1 text-zinc-400 hover:text-zinc-100 transition-colors"
      >
        <SkipForward size={16} />
      </button>

      {/* Divider */}
      <div className="h-4 w-px bg-zinc-700" />

      {/* Current time display */}
      <span className="text-xs font-mono text-zinc-300 min-w-[6rem]">
        {formatTime(currentTs)}
      </span>

      {/* Speed selector */}
      <div className="relative ml-auto flex items-center gap-1">
        <span className="text-xs text-zinc-500">Speed</span>
        <div className="relative">
          <select
            value={speed}
            onChange={e => setSpeed(Number(e.target.value))}
            className="appearance-none bg-zinc-800 text-xs text-zinc-200 border border-zinc-700 rounded px-2 pr-5 py-0.5 cursor-pointer hover:bg-zinc-700 focus:outline-none"
          >
            {SPEEDS.map(s => (
              <option key={s} value={s}>{s}x</option>
            ))}
          </select>
          <ChevronDown
            size={12}
            className="pointer-events-none absolute right-1 top-1/2 -translate-y-1/2 text-zinc-400"
          />
        </div>
      </div>

      {/* H key hint */}
      <span className="text-[10px] text-zinc-600 hidden sm:block">H = immersive</span>
    </div>
  );
}
