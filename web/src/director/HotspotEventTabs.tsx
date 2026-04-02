import { useState, useMemo } from 'react';
import { usePlayback } from '../store/playback';
import { useDirector } from '../store/director';
import { useI18n } from '../lib/i18n';
import { HotspotEvent } from '../lib/api';

/** Hotspot type keys in display order */
const TYPES = ['firefight', 'killstreak', 'mass_casualty', 'engagement', 'bombardment', 'long_range'] as const;
type HSType = (typeof TYPES)[number];

/** Tab colors matching HotspotControlPanel */
const TYPE_COLORS: Record<HSType, string> = {
  firefight: '#ff9900',
  killstreak: '#ff3322',
  mass_casualty: '#cc0000',
  engagement: '#ff8800',
  bombardment: '#ffee44',
  long_range: '#00ccff',
};

function formatTime(ts: string): string {
  if (!ts || ts.length < 19) return '';
  return ts.slice(11, 19);
}

function parseTs(ts: string): number {
  return new Date(ts.replace(' ', 'T')).getTime();
}

export function HotspotEventTabs() {
  const { allHotspots, currentTs, seek, coordMode } = usePlayback();
  const { setTargetCamera } = useDirector();
  const { t } = useI18n();
  const [activeTab, setActiveTab] = useState<HSType>('killstreak');

  const curMs = currentTs ? parseTs(currentTs) : 0;

  // Group hotspots by type
  const grouped = useMemo(() => {
    const map: Record<HSType, HotspotEvent[]> = {
      firefight: [],
      killstreak: [],
      mass_casualty: [],
      engagement: [],
      bombardment: [],
      long_range: [],
    };
    for (const hs of allHotspots) {
      const key = hs.type as HSType;
      if (map[key]) map[key].push(hs);
    }
    return map;
  }, [allHotspots]);

  // Events for the active tab, sorted by score desc
  const tabEvents = useMemo(() => {
    return [...(grouped[activeTab] || [])].sort((a, b) => b.score - a.score);
  }, [grouped, activeTab]);

  // Click handler — seek to peak time and fly camera there
  const handleClick = (hs: HotspotEvent) => {
    seek(hs.peakTs);
    if (hs.centerLat === 0 && hs.centerLng === 0) return;
    if (coordMode === 'wgs84') {
      setTargetCamera({ lat: hs.centerLat, lng: hs.centerLng, zoom: 17 });
    } else {
      setTargetCamera({ x: hs.centerLng, y: hs.centerLat, zoom: 8 });
    }
  };

  return (
    <div className="flex flex-col flex-1 min-h-0">
      {/* Tab bar */}
      <div className="flex gap-0.5 mb-2 flex-wrap">
        {TYPES.map((type) => {
          const count = grouped[type].length;
          const isActive = type === activeTab;
          return (
            <button
              key={type}
              onClick={() => setActiveTab(type)}
              className={`relative px-2 py-1 text-[10px] font-medium rounded transition-colors leading-tight ${
                isActive
                  ? 'text-white'
                  : 'text-zinc-500 hover:text-zinc-300 bg-zinc-800/50 hover:bg-zinc-800'
              }`}
              style={isActive ? { backgroundColor: TYPE_COLORS[type] + '30', color: TYPE_COLORS[type] } : undefined}
            >
              {t(type)}
              {count > 0 && (
                <span
                  className={`ml-1 text-[9px] px-1 rounded-full ${
                    isActive ? 'bg-white/20' : 'bg-zinc-700 text-zinc-400'
                  }`}
                >
                  {count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Event list — scrollable */}
      <div className="flex-1 overflow-y-auto space-y-1 min-h-0" style={{ maxHeight: '280px' }}>
        {tabEvents.length === 0 ? (
          <div className="text-xs text-zinc-600 italic py-2">{t('no_events')}</div>
        ) : (
          tabEvents.map((hs) => {
            const hsStart = parseTs(hs.startTs);
            const hsEnd = parseTs(hs.endTs);
            const isNow = curMs >= hsStart && curMs <= hsEnd;
            const isPast = curMs > hsEnd;

            return (
              <button
                key={hs.id}
                onClick={() => handleClick(hs)}
                className={`w-full text-left text-xs rounded px-2 py-1.5 transition-colors border ${
                  isNow
                    ? 'bg-amber-900/40 border-amber-600/50 text-amber-200'
                    : isPast
                      ? 'bg-zinc-800/50 border-transparent text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800'
                      : 'bg-zinc-800 border-transparent text-zinc-300 hover:bg-zinc-700'
                }`}
              >
                {/* Row 1: label + score */}
                <div className="flex justify-between items-center gap-2">
                  <span className="font-medium truncate">
                    {hs.focusName ? `${hs.focusName} · ${hs.label}` : hs.label}
                  </span>
                  <span
                    className="shrink-0 text-[10px] font-mono px-1 rounded"
                    style={{ color: TYPE_COLORS[activeTab] }}
                  >
                    {Math.round(hs.score)}
                  </span>
                </div>
                {/* Row 2: time + stats (killstreak only shows time range) */}
                <div className="flex gap-2 text-[10px] mt-0.5 opacity-70">
                  <span className="font-mono">
                    {formatTime(hs.startTs)}~{formatTime(hs.endTs).slice(3)}
                  </span>
                  {hs.type !== 'killstreak' && hs.type !== 'long_range' && (
                    <>
                      <span>{hs.kills}{t('kills')}</span>
                      <span>{hs.hits}{t('hits')}</span>
                      {hs.units && <span>{hs.units.length}人</span>}
                    </>
                  )}
                </div>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}
