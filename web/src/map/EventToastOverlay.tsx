import { useEffect, useRef, useState } from 'react';

interface GameEvent {
  type: string;
  sourceId?: number;
  targetId?: number;
  ts?: string;
  [key: string]: unknown;
}

interface ToastEntry {
  id: number;
  event: GameEvent;
  addedAt: number;
  fading: boolean;
}

interface EventToastOverlayProps {
  events: unknown[];
}

const TOAST_DURATION_MS = 3000;
const FADE_DURATION_MS = 500;
const MAX_TOASTS = 5;

let toastCounter = 0;

function eventColor(type: string): string {
  if (type === 'kill') return 'border-red-600 bg-red-950/80';
  if (type === 'hit') return 'border-amber-600 bg-amber-950/80';
  return 'border-zinc-600 bg-zinc-900/80';
}

function eventLabel(type: string): string {
  if (type === 'kill') return 'KILL';
  if (type === 'hit') return 'HIT';
  return type.toUpperCase();
}

function eventLabelColor(type: string): string {
  if (type === 'kill') return 'text-red-400';
  if (type === 'hit') return 'text-amber-400';
  return 'text-zinc-400';
}

function formatTs(ts: string | undefined): string {
  if (!ts) return '';
  // ISO string: just show HH:MM:SS
  const m = ts.match(/T?(\d{2}:\d{2}:\d{2})/);
  return m ? m[1] : ts.slice(0, 8);
}

export function EventToastOverlay({ events }: EventToastOverlayProps) {
  const [toasts, setToasts] = useState<ToastEntry[]>([]);
  const prevEventsRef = useRef<unknown[]>([]);

  useEffect(() => {
    // Detect genuinely new events by checking reference equality of the array
    if (events === prevEventsRef.current) return;
    const prev = prevEventsRef.current;
    prevEventsRef.current = events;

    // Find new events that weren't there before
    const newEvents = events.slice(prev.length) as GameEvent[];
    if (newEvents.length === 0) return;

    const now = Date.now();
    const added: ToastEntry[] = newEvents.map(ev => ({
      id: ++toastCounter,
      event: ev,
      addedAt: now,
      fading: false,
    }));

    setToasts(prev => {
      const combined = [...prev, ...added];
      // Keep only the last MAX_TOASTS
      return combined.slice(-MAX_TOASTS);
    });
  }, [events]);

  // Tick to remove expired toasts and trigger fade
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
        }).filter(t => {
          const age = now - t.addedAt;
          return age < TOAST_DURATION_MS;
        });
        if (changed || updated.length !== prev.length) return updated;
        return prev;
      });
    }, 100);

    return () => clearInterval(interval);
  }, [toasts.length]);

  if (toasts.length === 0) return null;

  return (
    <div className="absolute bottom-4 left-4 flex flex-col gap-2 z-10 pointer-events-none">
      {toasts.map(toast => {
        const ev = toast.event;
        const type = ev.type ?? 'event';
        return (
          <div
            key={toast.id}
            className={`
              border rounded px-3 py-2 text-xs font-mono backdrop-blur-sm
              transition-opacity duration-500
              ${eventColor(type)}
              ${toast.fading ? 'opacity-0' : 'opacity-100'}
            `}
          >
            <div className="flex items-center gap-2">
              <span className={`font-bold ${eventLabelColor(type)}`}>
                {eventLabel(type)}
              </span>
              {ev.sourceId !== undefined && (
                <span className="text-zinc-300">Unit {ev.sourceId}</span>
              )}
              {ev.targetId !== undefined && (
                <>
                  <span className="text-zinc-500">→</span>
                  <span className="text-zinc-300">Unit {ev.targetId}</span>
                </>
              )}
              {ev.ts && (
                <span className="text-zinc-500 ml-auto">{formatTs(ev.ts)}</span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
