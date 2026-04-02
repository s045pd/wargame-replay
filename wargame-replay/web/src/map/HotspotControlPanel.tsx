import { useHotspotFilter, ALL_HOTSPOT_TYPES, HotspotType } from '../store/hotspotFilter';
import { usePlayback } from '../store/playback';
import { useI18n } from '../lib/i18n';
import { useMemo } from 'react';

/** Colour per hotspot type — matches HotspotTrack */
const TYPE_COLORS: Record<HotspotType, string> = {
  firefight:     '#ff9900',
  killstreak:    '#ff3322',
  mass_casualty: '#cc0000',
  engagement:    '#ff8800',
  bombardment:   '#ffee44',
  long_range:    '#00ccff',
};

/**
 * Floating control panel for hotspot debug overlay + per-type filters.
 * Rendered on the map, bottom-right corner above timeline.
 */
export function HotspotControlPanel() {
  const { debugOverlay, toggleDebugOverlay, typeFilters, toggleTypeFilter } = useHotspotFilter();
  const { allHotspots } = usePlayback();
  const { t } = useI18n();

  // Count events per type
  const typeCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const hs of allHotspots) {
      counts[hs.type] = (counts[hs.type] || 0) + 1;
    }
    return counts;
  }, [allHotspots]);

  return (
    <div className="absolute bottom-8 right-2 z-10 bg-zinc-900/90 border border-zinc-700 rounded px-2.5 py-2 text-xs font-mono backdrop-blur-sm min-w-[160px]">
      {/* Debug overlay toggle */}
      <button
        onClick={toggleDebugOverlay}
        className={`w-full flex items-center gap-2 px-2 py-1 rounded text-left text-[11px] font-medium transition-colors mb-1.5 ${
          debugOverlay
            ? 'bg-amber-700/60 text-amber-200 border border-amber-600/50'
            : 'bg-zinc-800/80 text-zinc-400 border border-zinc-700 hover:text-zinc-200'
        }`}
      >
        <span className="text-sm">{debugOverlay ? '🔍' : '○'}</span>
        <span>{t('debug_overlay')}</span>
      </button>

      {/* Separator */}
      <div className="border-t border-zinc-700 my-1.5" />

      {/* Type filter label */}
      <div className="text-zinc-500 text-[10px] uppercase tracking-wider mb-1">
        {t('hotspot_filter')}
      </div>

      {/* Per-type filter buttons */}
      <div className="space-y-0.5">
        {ALL_HOTSPOT_TYPES.map((type) => {
          const enabled = typeFilters[type];
          const count = typeCounts[type] || 0;
          const color = TYPE_COLORS[type];
          return (
            <button
              key={type}
              onClick={() => toggleTypeFilter(type)}
              className={`w-full flex items-center gap-2 px-1.5 py-0.5 rounded text-left transition-colors ${
                enabled
                  ? 'text-zinc-200 hover:bg-zinc-800'
                  : 'text-zinc-600 hover:text-zinc-400'
              }`}
            >
              <span
                className="w-2.5 h-2.5 rounded-sm inline-block border"
                style={{
                  backgroundColor: enabled ? color : 'transparent',
                  borderColor: color,
                  opacity: enabled ? 1 : 0.4,
                }}
              />
              <span className="flex-1 truncate">{t(type)}</span>
              <span className="text-zinc-500 text-[10px]">{count}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
