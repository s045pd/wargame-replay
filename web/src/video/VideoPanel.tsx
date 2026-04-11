import { useVideos, type LayoutMode } from '../store/videos';
import { FloatingVideoCard } from './FloatingVideoCard';
import { LayoutCell } from './LayoutCell';

/**
 * Container for all active video cards.
 *
 * Supports three layout modes (persisted via useVideos.layoutMode):
 *
 * - `floating` — absolute-positioned draggable cards overlayed on the map.
 * - `dock-right` — vertical column fixed to the right edge of the window;
 *   cards stacked top-to-bottom, width controlled by the panel.
 * - `grid-top` — horizontal row at the top of the screen; cards share the
 *   width evenly.
 *
 * The map container in App.tsx reads the layout mode from the store and
 * shrinks its viewport so it does not get obscured.
 */
export function VideoPanel() {
  const activeIds = useVideos((s) => s.activeGroupIds);
  const layoutMode = useVideos((s) => s.layoutMode);

  if (activeIds.length === 0) return null;

  if (layoutMode === 'floating') {
    return (
      <>
        {activeIds.map((id, index) => (
          <FloatingVideoCard key={id} groupId={id} index={index} />
        ))}
      </>
    );
  }

  return <DockedLayout mode={layoutMode} groupIds={activeIds} />;
}

interface DockedLayoutProps {
  mode: Exclude<LayoutMode, 'floating'>;
  groupIds: string[];
}

function DockedLayout({ mode, groupIds }: DockedLayoutProps) {
  const containerClasses =
    mode === 'dock-right'
      ? 'fixed right-0 top-12 bottom-0 z-30 flex w-[380px] flex-col gap-1 border-l border-zinc-800 bg-zinc-950/90 p-1 backdrop-blur'
      : 'fixed left-0 right-0 top-12 z-30 flex h-[45vh] gap-1 border-b border-zinc-800 bg-zinc-950/90 p-1 backdrop-blur';

  return (
    <div className={containerClasses}>
      {groupIds.map((id) => (
        <LayoutCell key={id} groupId={id} mode={mode} />
      ))}
    </div>
  );
}
