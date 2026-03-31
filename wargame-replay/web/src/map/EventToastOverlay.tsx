import { useEffect, useRef, useState } from 'react';
import { GameEvent, UnitPosition } from '../lib/api';
import { useI18n } from '../lib/i18n';

interface ToastEntry {
  id: number;
  event: GameEvent;
  addedAt: number;
  fading: boolean;
  srcTeam: string;
}

interface EventToastOverlayProps {
  events: GameEvent[];
  units: UnitPosition[];
}

const TOAST_DURATION_MS = 5000;
const FADE_DURATION_MS = 500;
const MAX_TOASTS = 10;

let toastCounter = 0;

/** Shape icon mapping for each class */
const CLASS_SHAPES: Record<string, string> = {
  rifle:    '●',
  mg:       '■',
  medic:    '✚',
  sniper:   '▲',
  marksman: '◆',
};

function classShape(cls?: string): string {
  if (!cls) return '•';
  return CLASS_SHAPES[cls] || '•';
}

function formatTs(ts: string | undefined): string {
  if (!ts) return '';
  const m = ts.match(/T?(\d{2}:\d{2}:\d{2})/);
  return m ? m[1] : ts.slice(0, 8);
}

export function EventToastOverlay({ events, units }: EventToastOverlayProps) {
  const [toasts, setToasts] = useState<ToastEntry[]>([]);
  const [showHits, setShowHits] = useState(false);
  const prevEventsRef = useRef<GameEvent[]>([]);
  const { t } = useI18n();

  // Build team lookup from units
  const teamMap = useRef(new Map<number, string>());
  useEffect(() => {
    const m = new Map<number, string>();
    for (const u of units) {
      m.set(u.id, u.team);
    }
    teamMap.current = m;
  }, [units]);

  useEffect(() => {
    if (!events || events === prevEventsRef.current) return;
    prevEventsRef.current = events;

    // Filter: always include kills + revive + heal; include hits only if toggled on
    const relevant = events.filter(e => {
      if (e.type === 'kill' || e.type === 'revive' || e.type === 'heal') return true;
      if (e.type === 'hit' && showHits) return true;
      return false;
    });
    if (relevant.length === 0) return;

    const now = Date.now();
    const added: ToastEntry[] = relevant.map(ev => ({
      id: ++toastCounter,
      event: ev,
      addedAt: now,
      fading: false,
      srcTeam: teamMap.current.get(ev.src) || '',
    }));

    setToasts(prev => [...prev, ...added].slice(-MAX_TOASTS));
  }, [events, showHits]);

  // Cleanup timer
  useEffect(() => {
    if (toasts.length === 0) return;
    const interval = setInterval(() => {
      const now = Date.now();
      setToasts(prev => {
        let changed = false;
        const updated = prev.map(t => {
          const age = now - t.addedAt;
          if (!t.fading && age >= TOAST_DURATION_MS - FADE_DURATION_MS) {
            changed = true;
            return { ...t, fading: true };
          }
          return t;
        }).filter(t => (now - t.addedAt) < TOAST_DURATION_MS);
        if (changed || updated.length !== prev.length) return updated;
        return prev;
      });
    }, 100);
    return () => clearInterval(interval);
  }, [toasts.length]);

  return (
    <div className="absolute bottom-8 left-4 flex flex-col gap-1 z-10" style={{ maxWidth: 360 }}>
      {/* Hit toggle button */}
      <div className="pointer-events-auto mb-1">
        <button
          onClick={() => setShowHits(!showHits)}
          className={`px-2 py-0.5 rounded text-[10px] font-medium transition-colors ${
            showHits
              ? 'bg-amber-700/80 text-amber-200 border border-amber-600'
              : 'bg-zinc-800/80 text-zinc-500 border border-zinc-700 hover:text-zinc-300'
          }`}
        >
          {showHits ? `● ${t('hits')}` : `○ ${t('hits')}`}
        </button>
      </div>

      {/* Toast list */}
      <div className="flex flex-col gap-1 pointer-events-none">
        {toasts.map(toast => {
          const ev = toast.event;
          const srcName = ev.srcName || `#${ev.src}`;
          const dstName = ev.dstName || (ev.dst !== undefined ? `#${ev.dst}` : '?');

          // Kill event — team-colored
          if (ev.type === 'kill') {
            const isRedKill = toast.srcTeam === 'red';
            const borderColor = isRedKill ? 'border-red-600/70' : 'border-cyan-600/70';
            const bgColor = isRedKill ? 'bg-red-950/80' : 'bg-cyan-950/80';
            const srcColor = isRedKill ? 'text-red-400' : 'text-cyan-400';
            const dstColor = isRedKill ? 'text-cyan-400' : 'text-red-400';
            const shapeColor = isRedKill ? 'text-red-500' : 'text-cyan-500';

            return (
              <div
                key={toast.id}
                className={`border rounded px-2.5 py-1 text-xs font-mono backdrop-blur-sm transition-opacity duration-500 ${borderColor} ${bgColor} ${toast.fading ? 'opacity-0' : 'opacity-100'}`}
              >
                <div className="flex items-center gap-1.5">
                  <span className={shapeColor}>{classShape(ev.srcClass)}</span>
                  <span className={`${srcColor} font-medium`}>{srcName}</span>
                  <span className="text-zinc-500 mx-0.5">⚔</span>
                  <span className={`${dstColor} line-through opacity-70`}>{dstName}</span>
                  <span className="text-zinc-600 ml-auto pl-2 text-[10px]">{formatTs(ev.ts)}</span>
                </div>
              </div>
            );
          }

          // Hit event
          if (ev.type === 'hit') {
            return (
              <div
                key={toast.id}
                className={`border rounded px-2.5 py-1 text-xs font-mono backdrop-blur-sm transition-opacity duration-500 border-amber-700/40 bg-amber-950/50 ${toast.fading ? 'opacity-0' : 'opacity-100'}`}
              >
                <div className="flex items-center gap-1.5">
                  <span className="text-amber-500">{classShape(ev.srcClass)}</span>
                  <span className="text-amber-300">{srcName}</span>
                  <span className="text-zinc-600 mx-0.5">→</span>
                  <span className="text-amber-200/70">{dstName}</span>
                  {ev.hp !== undefined && (
                    <span className="text-zinc-500 text-[10px]">HP:{ev.hp}</span>
                  )}
                  <span className="text-zinc-600 ml-auto pl-2 text-[10px]">{formatTs(ev.ts)}</span>
                </div>
              </div>
            );
          }

          // Revive
          if (ev.type === 'revive') {
            return (
              <div
                key={toast.id}
                className={`border rounded px-2.5 py-1 text-xs font-mono backdrop-blur-sm transition-opacity duration-500 border-emerald-600/60 bg-emerald-950/70 ${toast.fading ? 'opacity-0' : 'opacity-100'}`}
              >
                <div className="flex items-center gap-1.5">
                  <span className="text-emerald-500">{classShape(ev.dstClass)}</span>
                  <span className="text-emerald-300">{dstName}</span>
                  <span className="text-emerald-400 text-[10px] ml-1">REVIVE</span>
                  <span className="text-zinc-600 ml-auto pl-2 text-[10px]">{formatTs(ev.ts)}</span>
                </div>
              </div>
            );
          }

          // Heal
          if (ev.type === 'heal') {
            return (
              <div
                key={toast.id}
                className={`border rounded px-2.5 py-1 text-xs font-mono backdrop-blur-sm transition-opacity duration-500 border-green-600/40 bg-green-950/50 ${toast.fading ? 'opacity-0' : 'opacity-100'}`}
              >
                <div className="flex items-center gap-1.5">
                  <span className="text-green-500">{classShape(ev.dstClass)}</span>
                  <span className="text-green-300">{dstName}</span>
                  <span className="text-green-400 text-[10px] ml-1">HP→{ev.hp}</span>
                  <span className="text-zinc-600 ml-auto pl-2 text-[10px]">{formatTs(ev.ts)}</span>
                </div>
              </div>
            );
          }

          return null;
        })}
      </div>
    </div>
  );
}
