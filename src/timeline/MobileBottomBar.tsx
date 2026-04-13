/**
 * MobileBottomBar — compact playback controls for mobile.
 *
 * Layout (bottom → top, thumb-reachable):
 *   ┌─────────────────────────────────────┐
 *   │  seek bar (full width, 32px tall)   │  ← tap/drag to seek
 *   ├─────────────────────────────────────┤
 *   │  ◀30  ▶/❚❚  ▶30   HH:MM:SS  ×64   │  ← 44px transport row
 *   └─────────────────────────────────────┘
 *   safe-area-inset-bottom padding for notched phones
 */

import { useRef, useCallback, useEffect } from 'react';
import { Play, Pause, SkipForward, SkipBack, ChevronDown } from 'lucide-react';
import { usePlayback } from '../store/playback';
import { useI18n } from '../lib/i18n';

const SPEEDS = [1, 2, 4, 8, 16, 32, 64, 128] as const;

function parseDbTs(ts: string): Date {
  return new Date(ts.replace(' ', 'T'));
}

function formatTime(ts: string): string {
  if (!ts) return '--:--:--';
  const d = parseDbTs(ts);
  if (isNaN(d.getTime())) return '--:--:--';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function toDbTs(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function addSeconds(ts: string, seconds: number, min: string, max: string): string {
  const d = parseDbTs(ts);
  d.setSeconds(d.getSeconds() + seconds);
  const minD = parseDbTs(min);
  const maxD = parseDbTs(max);
  const clamped = new Date(Math.max(minD.getTime(), Math.min(maxD.getTime(), d.getTime())));
  return toDbTs(clamped);
}

export function MobileBottomBar() {
  const {
    playing, speed, currentTs, meta, play, pause, seek, setSpeed,
  } = usePlayback();
  const { t } = useI18n();
  const seekBarRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);

  // --- progress ---
  const progress = (() => {
    if (!meta || !currentTs) return 0;
    const s = parseDbTs(meta.startTime).getTime();
    const e = parseDbTs(meta.endTime).getTime();
    const c = parseDbTs(currentTs).getTime();
    const total = e - s;
    if (total <= 0) return 0;
    return Math.max(0, Math.min(1, (c - s) / total));
  })();

  // --- seek from pointer ---
  const seekFromX = useCallback((clientX: number) => {
    if (!meta || !seekBarRef.current) return;
    const rect = seekBarRef.current.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    const s = parseDbTs(meta.startTime).getTime();
    const e = parseDbTs(meta.endTime).getTime();
    const ts = toDbTs(new Date(s + ratio * (e - s)));
    seek(ts);
  }, [meta, seek]);

  // --- pointer events for seek bar ---
  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    dragging.current = true;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    seekFromX(e.clientX);
  }, [seekFromX]);

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (dragging.current) seekFromX(e.clientX);
  }, [seekFromX]);

  const handlePointerUp = useCallback(() => {
    dragging.current = false;
  }, []);

  // --- hotspot canvas (mini version) ---
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const allHotspots = usePlayback((s) => s.allHotspots);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !meta) return;
    const dpr = window.devicePixelRatio ?? 1;
    const w = canvas.offsetWidth;
    const h = canvas.offsetHeight;
    if (w === 0) return;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, w, h);

    const startMs = parseDbTs(meta.startTime).getTime();
    const endMs = parseDbTs(meta.endTime).getTime();
    const total = endMs - startMs;
    if (total <= 0) return;

    const typeColors: Record<string, string> = {
      firefight: '#ef4444', killstreak: '#f59e0b', mass_casualty: '#ec4899',
      engagement: '#3b82f6', bombardment: '#a855f7', long_range: '#22c55e',
    };

    for (const hs of allHotspots) {
      const hsStart = parseDbTs(hs.startTs).getTime();
      const hsEnd = parseDbTs(hs.endTs).getTime();
      const x1 = ((hsStart - startMs) / total) * w;
      const x2 = ((hsEnd - startMs) / total) * w;
      const barW = Math.max(2, x2 - x1);
      ctx.fillStyle = typeColors[hs.type] ?? '#666';
      ctx.globalAlpha = 0.6;
      ctx.fillRect(x1, 0, barW, h);
    }
    ctx.globalAlpha = 1;
  }, [allHotspots, meta, currentTs]);

  const handleSkip = (delta: number) => {
    if (!meta) return;
    const next = addSeconds(currentTs, delta, meta.startTime, meta.endTime);
    seek(next);
  };

  return (
    <div className="flex flex-col bg-zinc-950 border-t border-zinc-800 shrink-0"
      style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}>

      {/* Seek bar — full width, 32px touch target */}
      <div
        ref={seekBarRef}
        className="relative h-8 bg-zinc-900 cursor-pointer"
        style={{ touchAction: 'none' }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
      >
        {/* Hotspot bars background */}
        <canvas
          ref={canvasRef}
          className="absolute inset-0 w-full h-full"
          style={{ display: 'block', pointerEvents: 'none' }}
        />
        {/* Progress fill */}
        <div
          className="absolute top-0 left-0 bottom-0 bg-emerald-600/30 pointer-events-none"
          style={{ width: `${progress * 100}%` }}
        />
        {/* Playhead */}
        <div
          className="absolute top-0 bottom-0 w-0.5 bg-yellow-400 pointer-events-none"
          style={{ left: `${progress * 100}%` }}
        >
          <div className="absolute -top-0.5 left-1/2 -translate-x-1/2 w-3 h-3 rounded-full bg-yellow-400" />
        </div>
      </div>

      {/* Transport row — 48px, thumb-friendly */}
      <div className="flex items-center gap-2 px-3 h-12 bg-zinc-900">
        {/* Skip back */}
        <button
          onClick={() => handleSkip(-30)}
          className="w-10 h-10 flex items-center justify-center text-zinc-400 active:text-zinc-100"
        >
          <SkipBack size={20} />
        </button>

        {/* Play/Pause — larger */}
        <button
          onClick={() => playing ? pause() : play()}
          className="w-12 h-12 flex items-center justify-center text-zinc-100 active:text-white"
        >
          {playing ? <Pause size={26} /> : <Play size={26} />}
        </button>

        {/* Skip forward */}
        <button
          onClick={() => handleSkip(30)}
          className="w-10 h-10 flex items-center justify-center text-zinc-400 active:text-zinc-100"
        >
          <SkipForward size={20} />
        </button>

        {/* Time */}
        <span className="text-xs font-mono text-zinc-300 ml-1">
          {formatTime(currentTs)}
        </span>

        {/* Spacer */}
        <div className="flex-1" />

        {/* Speed selector */}
        <div className="relative flex items-center gap-1">
          <span className="text-xs text-zinc-500">{t('speed')}</span>
          <div className="relative">
            <select
              value={speed}
              onChange={e => setSpeed(Number(e.target.value))}
              className="appearance-none bg-zinc-800 text-sm text-zinc-200 border border-zinc-700 rounded px-2 pr-6 py-1.5 cursor-pointer focus:outline-none"
            >
              {SPEEDS.map(s => (
                <option key={s} value={s}>{s}x</option>
              ))}
            </select>
            <ChevronDown
              size={14}
              className="pointer-events-none absolute right-1.5 top-1/2 -translate-y-1/2 text-zinc-400"
            />
          </div>
        </div>
      </div>
    </div>
  );
}
