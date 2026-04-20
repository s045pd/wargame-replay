import { useEffect, useRef, useMemo, useState } from 'react';
import { usePlayback } from '../store/playback';
import { useDirector } from '../store/director';
import { useVisualConfig } from '../store/visualConfig';
import { useHotspotFilter, type PersonalEventType } from '../store/hotspotFilter';
import { isFreeTileStyle } from '../map/styles';
import { useI18n } from '../lib/i18n';
import { HotspotEvent, GameEvent } from '../lib/api';

/** Colour per hotspot type */
const TYPE_COLORS: Record<string, string> = {
  firefight:     '#ff9900',
  killstreak:    '#ff3322',
  mass_casualty: '#cc0000',
  engagement:    '#ff8800',
  bombardment:   '#ffee44',
  long_range:    '#00ccff',
};
const DEFAULT_COLOR = '#ff9900';

/** Colour per personal event type — matches HotspotControlPanel */
const PERSONAL_TYPE_COLORS: Record<PersonalEventType, string> = {
  p_kill:     '#22cc44',
  p_hit:      '#66bb66',
  p_killed:   '#ff3333',
  p_hit_recv: '#ff8866',
  p_heal:     '#44aaff',
  p_revive:   '#aa66ff',
};

/** Render priority (higher = drawn on top) */
const PERSONAL_TYPE_PRIORITY: Record<PersonalEventType, number> = {
  p_killed: 5,
  p_kill:   4,
  p_revive: 3,
  p_heal:   2,
  p_hit_recv: 1,
  p_hit:    0,
};

/** Type label for display */
const TYPE_LABELS: Record<string, string> = {
  firefight:     '交火',
  killstreak:    '连杀',
  mass_casualty: '大规模伤亡',
  engagement:    '大规模交火',
  bombardment:   '轰炸',
  long_range:    '超远击杀',
};

/** Classify a GameEvent into its personal event type relative to the followed unit. */
function classifyPersonalEvent(ev: GameEvent, unitId: number): PersonalEventType | null {
  if (ev.type === 'kill') return ev.src === unitId ? 'p_kill' : ev.dst === unitId ? 'p_killed' : null;
  if (ev.type === 'hit') return ev.src === unitId ? 'p_hit' : ev.dst === unitId ? 'p_hit_recv' : null;
  if (ev.type === 'heal') return (ev.src === unitId || ev.dst === unitId) ? 'p_heal' : null;
  if (ev.type === 'revive') return (ev.src === unitId || ev.dst === unitId) ? 'p_revive' : null;
  return null;
}

interface PersonalMark {
  ms: number;
  type: PersonalEventType;
  ev: GameEvent;
}

function parseTs(ts: string): number {
  return new Date(ts.replace(' ', 'T')).getTime();
}

function formatHHMMSS(ts: string): string {
  if (!ts || ts.length < 19) return '';
  return ts.slice(11, 19);
}

interface HotspotTrackProps {
  height: number;
  labelWidth: number;
}

export function HotspotTrack({ height, labelWidth }: HotspotTrackProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const { meta, allHotspots: rawHotspots, allKills, currentTs, seek, selectedUnitId, followSelectedUnit, manualFollow } = usePlayback();
  const { typeFilters, personalTypeFilters } = useHotspotFilter();
  const { t } = useI18n();
  const [tooltip, setTooltip] = useState<
    | { x: number; y: number; kind: 'hotspot'; hs: HotspotEvent }
    | { x: number; y: number; kind: 'personal'; mark: PersonalMark }
    | null
  >(null);

  const isPersonalMode = selectedUnitId !== null && followSelectedUnit && manualFollow;

  // In non-personal mode, apply per-type visibility filters to hotspots.
  // In personal mode we switch to individual combat events (below) and this
  // list is unused by the draw path.
  const hotspots = useMemo(
    () => rawHotspots.filter((hs) => typeFilters[hs.type as keyof typeof typeFilters]),
    [rawHotspots, typeFilters],
  );

  // Individual combat-event marks for the followed unit, grouped and ordered
  // by render priority so stronger signals (kills, being killed) draw on top.
  const personalMarks = useMemo(() => {
    if (!isPersonalMode || selectedUnitId == null) return [] as PersonalMark[];
    const marks: PersonalMark[] = [];
    for (const ev of allKills) {
      const type = classifyPersonalEvent(ev, selectedUnitId);
      if (!type) continue;
      if (!personalTypeFilters[type]) continue;
      marks.push({ ms: parseTs(ev.ts), type, ev });
    }
    marks.sort((a, b) => PERSONAL_TYPE_PRIORITY[a.type] - PERSONAL_TYPE_PRIORITY[b.type]);
    return marks;
  }, [isPersonalMode, selectedUnitId, allKills, personalTypeFilters]);

  const startMs = useMemo(() => (meta ? parseTs(meta.startTime) : 0), [meta]);
  const endMs = useMemo(() => (meta ? parseTs(meta.endTime) : 0), [meta]);
  const totalMs = endMs - startMs;

  // Memoize sorted hotspots — avoids O(n log n) sort every render/frame
  const sortedHotspots = useMemo(
    () => [...hotspots].sort((a, b) => a.score - b.score),
    [hotspots],
  );

  // Draw hotspot bars on canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !meta || totalMs <= 0) return;

    const dpr = window.devicePixelRatio ?? 1;
    const w = canvas.offsetWidth;
    const h = canvas.offsetHeight;
    if (w === 0 || h === 0) return;

    canvas.width = w * dpr;
    canvas.height = h * dpr;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, w, h);

    const curMs = currentTs ? parseTs(currentTs) : startMs;

    if (isPersonalMode) {
      // Personal mode: thin vertical ticks per combat event, coloured by type
      const tickY = 2;
      const tickH = h - 4;
      const tickW = 2;
      for (const mark of personalMarks) {
        const x = ((mark.ms - startMs) / totalMs) * w;
        const color = PERSONAL_TYPE_COLORS[mark.type];
        // Played events are full opacity; upcoming events dim
        const isPast = mark.ms <= curMs;
        ctx.fillStyle = color;
        ctx.globalAlpha = isPast ? 0.95 : 0.35;
        ctx.fillRect(x - tickW / 2, tickY, tickW, tickH);
      }
      ctx.globalAlpha = 1;
      return;
    }

    for (const hs of sortedHotspots) {
      const hsStart = parseTs(hs.startTs);
      const hsEnd = parseTs(hs.endTs);
      const hsPeak = parseTs(hs.peakTs);

      const x1 = ((hsStart - startMs) / totalMs) * w;
      const x2 = ((hsEnd - startMs) / totalMs) * w;
      const barW = Math.max(2, x2 - x1);

      const color = TYPE_COLORS[hs.type] || DEFAULT_COLOR;
      const isActive = curMs >= hsStart && curMs <= hsEnd;

      // Bar
      ctx.fillStyle = color;
      ctx.globalAlpha = isActive ? 0.95 : 0.3;
      const barY = 2;
      const barH = h - 4;
      ctx.fillRect(x1, barY, barW, barH);

      // Bright border for active
      if (isActive) {
        ctx.strokeStyle = color;
        ctx.globalAlpha = 1;
        ctx.lineWidth = 1;
        ctx.strokeRect(x1, barY, barW, barH);

        // Peak tick
        const peakX = ((hsPeak - startMs) / totalMs) * w;
        ctx.fillStyle = '#ffffff';
        ctx.globalAlpha = 0.8;
        ctx.fillRect(peakX - 0.5, 0, 1, h);
      }

      ctx.globalAlpha = 1;
    }
  }, [meta, sortedHotspots, personalMarks, isPersonalMode, currentTs, startMs, endMs, totalMs]);

  // Resize observer for responsive redraw
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const observer = new ResizeObserver(() => {
      // Trigger re-render by forcing state update
      canvasRef.current?.dispatchEvent(new Event('resize'));
    });
    observer.observe(canvas);
    return () => observer.disconnect();
  }, []);

  /** Find nearest personal mark within a pixel tolerance. */
  const findNearestPersonalMark = (hoverMs: number, canvasWidth: number): PersonalMark | null => {
    if (personalMarks.length === 0 || totalMs <= 0) return null;
    const msPerPx = totalMs / canvasWidth;
    const tolerancePx = 4;
    const toleranceMs = tolerancePx * msPerPx;
    let best: PersonalMark | null = null;
    let bestPriority = -1;
    let bestDist = Infinity;
    for (const mark of personalMarks) {
      const dist = Math.abs(mark.ms - hoverMs);
      if (dist > toleranceMs) continue;
      const prio = PERSONAL_TYPE_PRIORITY[mark.type];
      if (prio > bestPriority || (prio === bestPriority && dist < bestDist)) {
        best = mark;
        bestPriority = prio;
        bestDist = dist;
      }
    }
    return best;
  };

  // Click to seek: in personal mode seek to the nearest event; otherwise seek
  // to the hotspot peak (and fly the camera). Falls back to the clicked time.
  const handleClick = (e: React.MouseEvent) => {
    if (!meta || totalMs <= 0 || !containerRef.current) return;

    const rect = containerRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const canvasWidth = rect.width;
    if (canvasWidth <= 0) return;

    const ratio = Math.max(0, Math.min(1, x / canvasWidth));
    const clickMs = startMs + ratio * totalMs;

    if (isPersonalMode) {
      const mark = findNearestPersonalMark(clickMs, canvasWidth);
      if (mark) {
        seek(mark.ev.ts);
        return;
      }
      // Fall through to raw-time seek
    } else {
      // Find the hotspot at this position (pick highest score if overlap)
      let best: HotspotEvent | null = null;
      for (const hs of hotspots) {
        const hsStart = parseTs(hs.startTs);
        const hsEnd = parseTs(hs.endTs);
        if (clickMs >= hsStart && clickMs <= hsEnd) {
          if (!best || hs.score > best.score) {
            best = hs;
          }
        }
      }

      if (best) {
        seek(best.peakTs);
        if (best.centerLat !== 0 || best.centerLng !== 0) {
          const vc = useVisualConfig.getState();
          const pb = usePlayback.getState();
          const maxZ = isFreeTileStyle(pb.mapStyle)
            ? Math.min(17, vc.freeMaxZoom)
            : 17;
          useDirector.getState().setTargetCamera({
            lat: best.centerLat,
            lng: best.centerLng,
            zoom: maxZ,
          });
        }
        return;
      }
    }

    // Nothing hit — seek to the raw clicked time
    const d = new Date(clickMs);
    const pad = (n: number) => String(n).padStart(2, '0');
    const ts = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
    seek(ts);
  };

  // Hover tooltip
  const handleMouseMove = (e: React.MouseEvent) => {
    if (!meta || totalMs <= 0 || !containerRef.current) return;

    const rect = containerRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const canvasWidth = rect.width;
    if (canvasWidth <= 0) return;

    const ratio = Math.max(0, Math.min(1, x / canvasWidth));
    const hoverMs = startMs + ratio * totalMs;

    if (isPersonalMode) {
      const mark = findNearestPersonalMark(hoverMs, canvasWidth);
      if (mark) {
        setTooltip({ x: e.clientX, y: rect.top, kind: 'personal', mark });
      } else {
        setTooltip(null);
      }
      return;
    }

    let best: HotspotEvent | null = null;
    for (const hs of hotspots) {
      const hsStart = parseTs(hs.startTs);
      const hsEnd = parseTs(hs.endTs);
      if (hoverMs >= hsStart && hoverMs <= hsEnd) {
        if (!best || hs.score > best.score) {
          best = hs;
        }
      }
    }

    if (best) {
      setTooltip({ x: e.clientX, y: rect.top, kind: 'hotspot', hs: best });
    } else {
      setTooltip(null);
    }
  };

  const handleMouseLeave = () => setTooltip(null);

  return (
    <div className="flex items-stretch border-b border-zinc-800" style={{ height }}>
      {/* Label sidebar — recolors to personal hue while manually following */}
      <div
        className="shrink-0 flex items-center px-2 text-[10px] font-medium tracking-wider uppercase border-r border-zinc-800"
        style={{
          width: labelWidth,
          color: isPersonalMode ? '#a855f7' : '#ef4444',
          borderLeftColor: isPersonalMode ? '#a855f7' : '#ef4444',
          borderLeftWidth: 2,
        }}
      >
        {isPersonalMode ? t('personal_events') : t('hotspot')}
      </div>
      {/* Canvas */}
      <div
        ref={containerRef}
        className="flex-1 relative overflow-hidden cursor-pointer"
        onClick={handleClick}
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
      >
        <canvas
          ref={canvasRef}
          className="absolute inset-0 w-full h-full"
          style={{ display: 'block' }}
        />
      </div>

      {/* Tooltip */}
      {tooltip && tooltip.kind === 'hotspot' && (
        <div
          className="fixed z-50 bg-zinc-900/95 border border-zinc-600 rounded px-2 py-1.5 text-xs font-mono text-zinc-200 pointer-events-none backdrop-blur-sm shadow-lg"
          style={{ left: tooltip.x + 8, top: tooltip.y - 48 }}
        >
          <div className="flex items-center gap-2">
            <span
              className="w-2 h-2 rounded-full inline-block"
              style={{ backgroundColor: TYPE_COLORS[tooltip.hs.type] || DEFAULT_COLOR }}
            />
            <span className="font-bold">{tooltip.hs.label}</span>
          </div>
          <div className="text-zinc-400 text-[10px] mt-0.5">
            {TYPE_LABELS[tooltip.hs.type] || tooltip.hs.type}
            {tooltip.hs.focusName ? ` · ${tooltip.hs.focusName}` : ''}
            {' · '}
            {formatHHMMSS(tooltip.hs.startTs)} ~ {formatHHMMSS(tooltip.hs.endTs)}
            {' · '}
            score {tooltip.hs.score.toFixed(0)}
          </div>
        </div>
      )}
      {tooltip && tooltip.kind === 'personal' && (
        <div
          className="fixed z-50 bg-zinc-900/95 border border-zinc-600 rounded px-2 py-1.5 text-xs font-mono text-zinc-200 pointer-events-none backdrop-blur-sm shadow-lg"
          style={{ left: tooltip.x + 8, top: tooltip.y - 48 }}
        >
          <div className="flex items-center gap-2">
            <span
              className="w-2 h-2 rounded-full inline-block"
              style={{ backgroundColor: PERSONAL_TYPE_COLORS[tooltip.mark.type] }}
            />
            <span className="font-bold">{t(tooltip.mark.type)}</span>
          </div>
          <div className="text-zinc-400 text-[10px] mt-0.5">
            {formatHHMMSS(tooltip.mark.ev.ts)}
            {tooltip.mark.ev.srcName ? ` · ${tooltip.mark.ev.srcName}` : ''}
            {tooltip.mark.ev.dstName ? ` → ${tooltip.mark.ev.dstName}` : ''}
          </div>
        </div>
      )}
    </div>
  );
}
