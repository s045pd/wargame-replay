import { useEffect, useState } from 'react';
import { TransportControls } from './TransportControls';
import { Track } from './Track';
import { Playhead } from './Playhead';

/** Width of the label sidebar in the track area (must match Track's w-24 = 96px) */
const LABEL_WIDTH = 96;

const TRACKS = [
  { label: 'Hotspot', color: '#ef4444', height: 20 },
  { label: 'Camera',  color: '#60a5fa', height: 20 },
  { label: 'Bookmarks', color: '#22c55e', height: 20 },
  { label: 'Clips',   color: '#a855f7', height: 20 },
] as const;

/**
 * Timeline container.
 *
 * - Normal mode (~120px): TransportControls + 4 named tracks with Playhead overlay.
 * - Immersive mode (~40px): TransportControls only (tracks hidden).
 * - H key toggles between modes.
 */
export function Timeline() {
  const [immersive, setImmersive] = useState(false);

  // Global H key shortcut
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Ignore when typing in inputs
      const tag = (e.target as HTMLElement).tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (e.key === 'h' || e.key === 'H') {
        setImmersive(prev => !prev);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className="flex flex-col bg-zinc-950 border-t border-zinc-800 shrink-0">
      {/* Transport controls row */}
      <TransportControls immersive={immersive} />

      {/* Tracks area — hidden in immersive mode */}
      {!immersive && (
        <div className="relative" style={{ height: TRACKS.reduce((acc, t) => acc + t.height, 0) }}>
          {TRACKS.map(t => (
            <Track
              key={t.label}
              label={t.label}
              height={t.height}
              color={t.color}
            />
          ))}
          {/* Playhead overlaid on top of the tracks */}
          <Playhead trackAreaLeft={LABEL_WIDTH} />
        </div>
      )}
    </div>
  );
}
