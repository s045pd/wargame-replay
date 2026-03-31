import { useEffect, useRef, useState } from 'react';
import { GameEvent, UNIT_CLASS_LABELS, UnitClass } from '../lib/api';

interface ToastEntry {
  id: number;
  event: GameEvent;
  addedAt: number;
  fading: boolean;
}

interface EventToastOverlayProps {
  events: GameEvent[];
}

const TOAST_DURATION_MS = 4000;
const FADE_DURATION_MS = 500;
const MAX_TOASTS = 8;

let toastCounter = 0;

/** Shape icon mapping for each class */
const CLASS_SHAPES: Record<string, string> = {
  rifle:    '●',  // circle
  mg:       '■',  // square
  medic:    '✚',  // cross
  sniper:   '▲',  // triangle
  marksman: '◆',  // diamond
};

function classLabel(cls?: string): string {
  if (!cls) return '?';
  return UNIT_CLASS_LABELS[cls as UnitClass] || cls;
}

function classShape(cls?: string): string {
  if (!cls) return '•';
  return CLASS_SHAPES[cls] || '•';
}

function formatTs(ts: string | undefined): string {
  if (!ts) return '';
  const m = ts.match(/T?(\d{2}:\d{2}:\d{2})/);
  return m ? m[1] : ts.slice(0, 8);
}

export function EventToastOverlay({ events }: EventToastOverlayProps) {
  const [toasts, setToasts] = useState<ToastEntry[]>([]);
  const prevEventsRef = useRef<GameEvent[]>([]);

  useEffect(() => {
    if (!events || events === prevEventsRef.current) return;
    prevEventsRef.current = events;

    // Show both kill and hit events
    const relevant = events.filter(e => e.type === 'kill' || e.type === 'hit');
    if (relevant.length === 0) return;

    const now = Date.now();
    const added: ToastEntry[] = relevant.map(ev => ({
      id: ++toastCounter,
      event: ev,
      addedAt: now,
      fading: false,
    }));

    setToasts(prev => [...prev, ...added].slice(-MAX_TOASTS));
  }, [events]);

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

  if (toasts.length === 0) return null;

  return (
    <div className="absolute bottom-4 left-4 flex flex-col gap-1.5 z-10 pointer-events-none">
      {toasts.map(toast => {
        const ev = toast.event;
        const isKill = ev.type === 'kill';
        const srcName = ev.srcName || `#${ev.src}`;
        const dstName = ev.dstName || (ev.dst !== undefined ? `#${ev.dst}` : '?');

        return (
          <div
            key={toast.id}
            className={`
              border rounded px-3 py-1.5 text-xs font-mono backdrop-blur-sm
              transition-opacity duration-500
              ${isKill
                ? 'border-red-600/80 bg-red-950/85'
                : 'border-amber-600/60 bg-amber-950/70'}
              ${toast.fading ? 'opacity-0' : 'opacity-100'}
            `}
          >
            <div className="flex items-center gap-1.5">
              {/* Event type badge */}
              {isKill ? (
                <span className="font-bold text-red-400 text-[10px] px-1 py-0.5 bg-red-900/60 rounded">
                  击杀
                </span>
              ) : (
                <span className="font-bold text-amber-400 text-[10px] px-1 py-0.5 bg-amber-900/40 rounded">
                  命中
                </span>
              )}

              {/* Attacker: shape + name + class */}
              <span className="text-cyan-400" title={classLabel(ev.srcClass)}>
                {classShape(ev.srcClass)}
              </span>
              <span className="text-cyan-300">{srcName}</span>
              <span className="text-zinc-600 text-[10px]">{classLabel(ev.srcClass)}</span>

              {/* Arrow / weapon indicator */}
              {isKill ? (
                <span className="text-red-500 mx-0.5">⚔</span>
              ) : (
                <span className="text-amber-500 mx-0.5">→</span>
              )}

              {/* Victim: shape + name + class */}
              <span className="text-orange-400" title={classLabel(ev.dstClass)}>
                {classShape(ev.dstClass)}
              </span>
              <span className="text-orange-300">{dstName}</span>
              <span className="text-zinc-600 text-[10px]">{classLabel(ev.dstClass)}</span>

              {/* HP remaining (for hit events) */}
              {!isKill && ev.hp !== undefined && (
                <span className="text-zinc-500 text-[10px] ml-1">HP:{ev.hp}</span>
              )}

              {/* Timestamp */}
              {ev.ts && (
                <span className="text-zinc-600 ml-auto pl-2">{formatTs(ev.ts)}</span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
