import {
  useHotspotFilter,
  ALL_HOTSPOT_TYPES,
  ALL_PERSONAL_EVENT_TYPES,
  type HotspotType,
  type PersonalEventType,
} from '../store/hotspotFilter';
import { usePlayback } from '../store/playback';
import { useI18n } from '../lib/i18n';
import { useMemo } from 'react';

/** Colour per global hotspot type — matches HotspotTrack */
const TYPE_COLORS: Record<HotspotType, string> = {
  firefight:     '#ff9900',
  killstreak:    '#ff3322',
  mass_casualty: '#cc0000',
  engagement:    '#ff8800',
  bombardment:   '#ffee44',
  long_range:    '#00ccff',
};

/** Colour per personal event type */
const PERSONAL_TYPE_COLORS: Record<PersonalEventType, string> = {
  p_kill:     '#22cc44',
  p_hit:      '#66bb66',
  p_killed:   '#ff3333',
  p_hit_recv: '#ff8866',
  p_heal:     '#44aaff',
  p_revive:   '#aa66ff',
};

interface HotspotControlPanelProps {
  /** Override the outer container className — use to reposition the panel. */
  className?: string;
}

const DEFAULT_CLASSNAME =
  'absolute bottom-8 right-2 z-10 bg-zinc-900/90 border border-zinc-700 rounded px-2.5 py-2 text-xs font-mono backdrop-blur-sm min-w-[160px]';

/**
 * Floating control panel for hotspot debug overlay + per-type filters.
 * When the user manually follows a unit, the filter list switches from
 * global hotspot types to personal event types scoped to that unit.
 */
export function HotspotControlPanel({ className }: HotspotControlPanelProps = {}) {
  const {
    debugOverlay, toggleDebugOverlay,
    masterEnabled, toggleMasterEnabled,
    typeFilters, toggleTypeFilter,
    personalTypeFilters, togglePersonalTypeFilter,
  } = useHotspotFilter();
  const { allHotspots, allKills, selectedUnitId, followSelectedUnit, manualFollow } = usePlayback();
  const { t } = useI18n();

  const isPersonalMode = selectedUnitId !== null && followSelectedUnit && manualFollow;

  // Count events per global hotspot type
  const typeCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const hs of allHotspots) {
      counts[hs.type] = (counts[hs.type] || 0) + 1;
    }
    return counts;
  }, [allHotspots]);

  // Count personal events involving the followed unit
  const personalCounts = useMemo(() => {
    if (!isPersonalMode || selectedUnitId === null) return {};
    const counts: Record<string, number> = {};
    for (const ev of allKills) {
      if (ev.type === 'kill' && ev.src === selectedUnitId) counts['p_kill'] = (counts['p_kill'] || 0) + 1;
      if (ev.type === 'kill' && ev.dst === selectedUnitId) counts['p_killed'] = (counts['p_killed'] || 0) + 1;
      if (ev.type === 'hit' && ev.src === selectedUnitId) counts['p_hit'] = (counts['p_hit'] || 0) + 1;
      if (ev.type === 'hit' && ev.dst === selectedUnitId) counts['p_hit_recv'] = (counts['p_hit_recv'] || 0) + 1;
      if (ev.type === 'heal' && (ev.src === selectedUnitId || ev.dst === selectedUnitId)) counts['p_heal'] = (counts['p_heal'] || 0) + 1;
      if (ev.type === 'revive' && (ev.src === selectedUnitId || ev.dst === selectedUnitId)) counts['p_revive'] = (counts['p_revive'] || 0) + 1;
    }
    return counts;
  }, [isPersonalMode, selectedUnitId, allKills]);

  return (
    <div className={className ?? DEFAULT_CLASSNAME}>
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

      {/* Master toggle — one click to disable/enable ALL hotspots */}
      <button
        onClick={toggleMasterEnabled}
        className={`w-full flex items-center gap-2 px-2 py-1 rounded text-left text-[11px] font-medium transition-colors mb-1.5 ${
          masterEnabled
            ? 'bg-emerald-700/50 text-emerald-200 border border-emerald-600/50'
            : 'bg-zinc-800/80 text-zinc-500 border border-zinc-700 hover:text-zinc-300'
        }`}
      >
        <span className="text-sm">{masterEnabled ? '●' : '○'}</span>
        <span>{t('hotspot_master_toggle')}</span>
      </button>

      {/* Separator */}
      <div className="border-t border-zinc-700 my-1.5" />

      {isPersonalMode ? (
        <>
          <div className={`text-[10px] uppercase tracking-wider mb-1 ${masterEnabled ? 'text-emerald-500' : 'text-zinc-600'}`}>
            {t('personal_event_filter')}
          </div>
          <div className={`space-y-0.5 ${masterEnabled ? '' : 'opacity-40 pointer-events-none'}`}>
            {ALL_PERSONAL_EVENT_TYPES.map((type) => {
              const enabled = personalTypeFilters[type];
              const count = personalCounts[type] || 0;
              const color = PERSONAL_TYPE_COLORS[type];
              return (
                <button
                  key={type}
                  onClick={() => togglePersonalTypeFilter(type)}
                  className={`w-full flex items-center gap-2 px-1.5 py-0.5 rounded text-left transition-colors ${
                    enabled ? 'text-zinc-200 hover:bg-zinc-800' : 'text-zinc-600 hover:text-zinc-400'
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
        </>
      ) : (
        <>
          <div className={`text-[10px] uppercase tracking-wider mb-1 ${masterEnabled ? 'text-zinc-500' : 'text-zinc-600'}`}>
            {t('hotspot_filter')}
          </div>
          <div className={`space-y-0.5 ${masterEnabled ? '' : 'opacity-40 pointer-events-none'}`}>
            {ALL_HOTSPOT_TYPES.map((type) => {
              const enabled = typeFilters[type];
              const count = typeCounts[type] || 0;
              const color = TYPE_COLORS[type];
              return (
                <button
                  key={type}
                  onClick={() => toggleTypeFilter(type)}
                  className={`w-full flex items-center gap-2 px-1.5 py-0.5 rounded text-left transition-colors ${
                    enabled ? 'text-zinc-200 hover:bg-zinc-800' : 'text-zinc-600 hover:text-zinc-400'
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
        </>
      )}
    </div>
  );
}
