import { useEffect } from 'react';
import { usePlayback } from '../store/playback';
import { useDirector } from '../store/director';
import { MapView } from '../map/MapView';
import { RelativeCanvas } from '../map/RelativeCanvas';
import { PreviewGrid } from './PreviewGrid';
import { AutoSwitch } from './AutoSwitch';

/**
 * Formats a timestamp for display in the event feed.
 * Accepts ISO strings or plain strings.
 */
function formatTs(ts: string): string {
  if (!ts) return '';
  // DB timestamps are "YYYY-MM-DD HH:MM:SS" — extract the time part directly
  if (ts.length >= 19 && ts[10] === ' ') {
    return ts.slice(11, 19);
  }
  return ts.slice(0, 8);
}

interface EventRecord {
  type?: string;
  ts?: string;
  [key: string]: unknown;
}

export function DirectorPanel() {
  const { units, events, coordMode, currentTs } = usePlayback();
  const { targetCamera } = useDirector();

  // Tab key: handled by App; this component just renders

  // Most recent events (up to 8)
  const recentEvents = (events as EventRecord[]).slice(-8).reverse();

  // Camera fly-to is handled by MapView via targetCamera prop
  // For RelativeCanvas, targetCamera x/y is passed as viewport center

  return (
    <div className="flex-1 flex overflow-hidden">
      {/* Main map area ~75% */}
      <div className="relative flex-1">
        {coordMode === 'wgs84' ? (
          <MapView units={units} targetCamera={targetCamera} />
        ) : (
          <RelativeCanvas units={units} />
        )}

        {/* Overlay: current timestamp */}
        <div className="absolute top-2 left-2 bg-black/60 text-xs font-mono text-zinc-300 px-2 py-1 rounded pointer-events-none">
          {formatTs(currentTs)}
        </div>
      </div>

      {/* Right sidebar ~25% */}
      <div
        className="flex flex-col gap-4 bg-zinc-900 border-l border-zinc-800 overflow-y-auto shrink-0"
        style={{ width: '280px', padding: '12px' }}
      >
        {/* Preview thumbnails */}
        <PreviewGrid units={units} />

        <div className="h-px bg-zinc-800" />

        {/* Auto switch controls */}
        <AutoSwitch />

        <div className="h-px bg-zinc-800" />

        {/* Event feed */}
        <div>
          <div className="text-xs text-zinc-500 uppercase tracking-wider mb-2">
            Recent Events
          </div>
          {recentEvents.length === 0 ? (
            <div className="text-xs text-zinc-600 italic">No events yet</div>
          ) : (
            <div className="space-y-1">
              {recentEvents.map((ev, i) => (
                <div
                  key={i}
                  className="text-xs bg-zinc-800 rounded px-2 py-1.5 flex items-start gap-2"
                >
                  <span className="text-zinc-500 font-mono shrink-0">
                    {ev.ts ? formatTs(ev.ts) : '--:--:--'}
                  </span>
                  <span className="text-zinc-300 truncate">
                    {ev.type ?? JSON.stringify(ev).slice(0, 40)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
