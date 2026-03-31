import { usePlayback } from '../store/playback';
import { useDirector } from '../store/director';
import { MapView } from '../map/MapView';
import { RelativeCanvas } from '../map/RelativeCanvas';
import { PreviewGrid } from './PreviewGrid';
import { AutoSwitch } from './AutoSwitch';
import { HotspotEventTabs } from './HotspotEventTabs';

function formatTs(ts: string): string {
  if (!ts) return '';
  if (ts.length >= 19 && ts[10] === ' ') return ts.slice(11, 19);
  return ts.slice(0, 8);
}

export function DirectorPanel() {
  const { units, coordMode, currentTs } = usePlayback();
  const { targetCamera } = useDirector();

  return (
    <div className="flex-1 flex overflow-hidden">
      {/* Main map area */}
      <div className="relative flex-1">
        {coordMode === 'wgs84' ? (
          <MapView units={units} targetCamera={targetCamera} />
        ) : (
          <RelativeCanvas units={units} />
        )}
        <div className="absolute top-2 left-1/2 -translate-x-1/2 bg-black/60 text-xs font-mono text-zinc-300 px-2 py-1 rounded pointer-events-none z-10">
          {formatTs(currentTs)}
        </div>
      </div>

      {/* Right sidebar */}
      <div
        className="flex flex-col gap-4 bg-zinc-900 border-l border-zinc-800 shrink-0"
        style={{ width: '280px', padding: '12px' }}
      >
        <PreviewGrid units={units} />
        <div className="h-px bg-zinc-800" />
        <AutoSwitch />
        <div className="h-px bg-zinc-800" />
        <HotspotEventTabs />
      </div>
    </div>
  );
}
