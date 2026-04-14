import { usePlayback } from '../store/playback';
import { PreviewGrid } from './PreviewGrid';
import { AutoSwitch } from './AutoSwitch';
import { HotspotEventTabs } from './HotspotEventTabs';

/**
 * Director sidebar — no longer owns a MapView instance.
 * The map lives in App.tsx and stays mounted across mode switches
 * to avoid costly re-initialization (globe intro animation).
 */
export function DirectorPanel() {
  const { units, currentTs } = usePlayback();

  return (
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
  );
}
