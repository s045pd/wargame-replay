import { useEffect, useRef, useMemo, useState } from 'react';
import { usePlayback } from '../store/playback';
import { useDirector } from '../store/director';
import { useVisualConfig } from '../store/visualConfig';
import { useHotspotFilter, type PersonalEventType } from '../store/hotspotFilter';
import { isFreeTileStyle } from '../map/styles';
import { useI18n } from '../lib/i18n';
import type { HotspotEvent, GameEvent } from '../lib/api';

/** Colour per global hotspot type */
const TYPE_COLORS: Record<string, string> = {
  firefight:     '#ff9900',
  killstreak:    '#ff3322',
  mass_casualty: '#cc0000',
  engagement:    '#ff8800',
  bombardment:   '#ffee44',
  long_range:    '#00ccff',
};
const DEFAULT_COLOR = '#ff9900';

/** Colour per personal event type */
const PERSONAL_TYPE_COLORS: Record<PersonalEventType, string> = {
  p_kill:     '#22cc44',
  p_hit:      '#66bb66',
  p_killed:   '#ff3333',
  p_hit_recv: '#ff8866',
  p_heal:     '#44aaff',
  p_revive:   '#aa66ff',
};

/** Type label for display (global) */
const TYPE_LABELS: Record<string, string> = {
  firefight:     '交火',
  killstreak:    '连杀',
  mass_casualty: '大规模伤亡',
  engagement:    '大规模交火',
  bombardment:   '轰炸',
  long_range:    '超远击杀',
};

function parseTs(ts: string): number {
  return new Date(ts.replace(' ', 'T')).getTime();
}

function formatHHMMSS(ts: string): string {
  if (!ts || ts.length < 19) return '';
  return ts.slice(11, 19);
}

// ── Personal Event helpers ──

interface PersonalEvent {
  type: PersonalEventType;
  ts: string;
  tsMs: number;
  name: string;
  event: GameEvent;
}

function buildPersonalEvents(allKills: GameEvent[], unitId: number): PersonalEvent[] {
  const result: PersonalEvent[] = [];
  for (const ev of allKills) {
    if (ev.type === 'kill' && ev.src === unitId) {
      result.push({ type: 'p_kill', ts: ev.ts, tsMs: parseTs(ev.ts), name: ev.dstName ?? '', event: ev });
    }
    if (ev.type === 'kill' && ev.dst === unitId) {
      result.push({ type: 'p_killed', ts: ev.ts, tsMs: parseTs(ev.ts), name: ev.srcName ?? '', event: ev });
    }
    if (ev.type === 'hit' && ev.src === unitId) {
      result.push({ type: 'p_hit', ts: ev.ts, tsMs: parseTs(ev.ts), name: ev.dstName ?? '', event: ev });
    }
    if (ev.type === 'hit' && ev.dst === unitId) {
      result.push({ type: 'p_hit_recv', ts: ev.ts, tsMs: parseTs(ev.ts), name: ev.srcName ?? '', event: ev });
    }
    if (ev.type === 'heal' && (ev.src === unitId || ev.dst === unitId)) {
      result.push({ type: 'p_heal', ts: ev.ts, tsMs: parseTs(ev.ts), name: (ev.src === unitId ? ev.dstName : ev.srcName) ?? '', event: ev });
    }
    if (ev.type === 'revive' && (ev.src === unitId || ev.dst === unitId)) {
      result.push({ type: 'p_revive', ts: ev.ts, tsMs: parseTs(ev.ts), name: (ev.src === unitId ? ev.dstName : ev.srcName) ?? '', event: ev });
    }
  }
  return result;
}

// ── Component ──

interface HotspotTrackProps {
  height: number;
  labelWidth: number;
}

export function HotspotTrack({ height, labelWidth }: HotspotTrackProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const { meta, allHotspots: rawHotspots, allKills, currentTs, seek, selectedUnitId, followSelectedUnit, manualFollow } = usePlayback();
  const { masterEnabled, typeFilters, personalTypeFilters } = useHotspotFilter();
  const { t } = useI18n();
  const [tooltip, setTooltip] = useState<{ x: number; y: number; hs: HotspotEvent } | null>(null);
  const [personalTooltip, setPersonalTooltip] = useState<{ x: number; y: number; pe: PersonalEvent } | null>(null);

  const isPersonalMode = selectedUnitId !== null && followSelectedUnit && manualFollow;

  // Filter global hotspots
  const hotspots = useMemo(
    () => masterEnabled
      ? rawHotspots.filter((hs) => typeFilters[hs.type as keyof typeof typeFilters])
      : [],
    [rawHotspots, masterEnabled, typeFilters],
  );

  // Build + filter personal events
  const personalEvents = useMemo(() => {
    if (!isPersonalMode || !masterEnabled || selectedUnitId === null) return [];
    const all = buildPersonalEvents(allKills, selectedUnitId);
    return all.filter((pe) => personalTypeFilters[pe.type]);
  }, [isPersonalMode, masterEnabled, allKills, selectedUnitId, personalTypeFilters]);

  const startMs = useMemo(() => (meta ? parseTs(meta.startTime) : 0), [meta]);
  const endMs = useMemo(() => (meta ? parseTs(meta.endTime) : 0), [meta]);
  const totalMs = endMs - startMs;

  // Memoize sorted hotspots — avoids O(n log n) sort every render/frame
  const sortedHotspots = useMemo(
    () => [...hotspots].sort((a, b) => a.score - b.score),
    [hotspots],
  );

  // Draw on canvas
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
      // ── Personal events: vertical tick marks ──
      for (const pe of personalEvents) {
        const x = ((pe.tsMs - startMs) / totalMs) * w;
        const color = PERSONAL_TYPE_COLORS[pe.type];
        const isNear = curMs >= pe.tsMs - 2000 && curMs <= pe.tsMs + 2000;

        ctx.fillStyle = color;
        ctx.globalAlpha = isNear ? 0.9 : 0.3;
        // Thin vertical bar
        ctx.fillRect(x - 1, 2, 2, h - 4);

        // Brighter top marker for nearby events
        if (isNear) {
          ctx.globalAlpha = 1;
          ctx.fillRect(x - 2, 0, 4, 4);
        }
        ctx.globalAlpha = 1;
      }
      return;
    }

    // ── Global hotspot bars ──
    for (const hs of sortedHotspots) {
      const hsStart = parseTs(hs.startTs);
      const hsEnd = parseTs(hs.endTs);
      const hsPeak = parseTs(hs.peakTs);

      const x1 = ((hsStart - startMs) / totalMs) * w;
      const x2 = ((hsEnd - startMs) / totalMs) * w;
      const barW = Math.max(2, x2 - x1);

      const color = TYPE_COLORS[hs.type] || DEFAULT_COLOR;
      const isActive = curMs >= hsStart && curMs <= hsEnd;

      ctx.fillStyle = color;
      ctx.globalAlpha = isActive ? 0.95 : 0.3;
      const barY = 2;
      const barH = h - 4;
      ctx.fillRect(x1, barY, barW, barH);

      if (isActive) {
        ctx.strokeStyle = color;
        ctx.globalAlpha = 1;
        ctx.lineWidth = 1;
        ctx.strokeRect(x1, barY, barW, barH);

        const peakX = ((hsPeak - startMs) / totalMs) * w;
        ctx.fillStyle = '#ffffff';
        ctx.globalAlpha = 0.8;
        ctx.fillRect(peakX - 0.5, 0, 1, h);
      }

      ctx.globalAlpha = 1;
    }
  }, [meta, isPersonalMode, personalEvents, sortedHotspots, currentTs, startMs, endMs, totalMs]);

  // Resize observer
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const observer = new ResizeObserver(() => {
      canvasRef.current?.dispatchEvent(new Event('resize'));
    });
    observer.observe(canvas);
    return () => observer.disconnect();
  }, []);

  // Click handler
  const handleClick = (e: React.MouseEvent) => {
    if (!meta || totalMs <= 0 || !containerRef.current) return;

    const rect = containerRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const canvasWidth = rect.width;
    if (canvasWidth <= 0) return;

    const ratio = Math.max(0, Math.min(1, x / canvasWidth));
    const clickMs = startMs + ratio * totalMs;

    if (isPersonalMode) {
      // Find nearest personal event
      let closest: PersonalEvent | null = null;
      let closestDist = Infinity;
      for (const pe of personalEvents) {
        const dist = Math.abs(pe.tsMs - clickMs);
        if (dist < closestDist) {
          closestDist = dist;
          closest = pe;
        }
      }
      if (closest && closestDist < totalMs * 0.02) {
        seek(closest.ts);
      } else {
        seekToMs(clickMs, seek);
      }
      return;
    }

    // Global hotspot click
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
    } else {
      seekToMs(clickMs, seek);
    }
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
      let closest: PersonalEvent | null = null;
      let closestDist = Infinity;
      for (const pe of personalEvents) {
        const dist = Math.abs(pe.tsMs - hoverMs);
        if (dist < closestDist) {
          closestDist = dist;
          closest = pe;
        }
      }
      if (closest && closestDist < totalMs * 0.01) {
        setPersonalTooltip({ x: e.clientX, y: rect.top, pe: closest });
      } else {
        setPersonalTooltip(null);
      }
      setTooltip(null);
      return;
    }

    // Global hotspot hover
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
      setTooltip({ x: e.clientX, y: rect.top, hs: best });
    } else {
      setTooltip(null);
    }
    setPersonalTooltip(null);
  };

  const handleMouseLeave = () => {
    setTooltip(null);
    setPersonalTooltip(null);
  };

  const labelColor = isPersonalMode ? '#22cc88' : '#ef4444';

  return (
    <div className="flex items-stretch border-b border-zinc-800" style={{ height }}>
      {/* Label sidebar */}
      <div
        className="shrink-0 flex items-center px-2 text-[10px] font-medium tracking-wider uppercase border-r border-zinc-800"
        style={{ width: labelWidth, color: labelColor, borderLeftColor: labelColor, borderLeftWidth: 2 }}
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

      {/* Global hotspot tooltip */}
      {tooltip && (
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

      {/* Personal event tooltip */}
      {personalTooltip && (
        <div
          className="fixed z-50 bg-zinc-900/95 border border-zinc-600 rounded px-2 py-1.5 text-xs font-mono text-zinc-200 pointer-events-none backdrop-blur-sm shadow-lg"
          style={{ left: personalTooltip.x + 8, top: personalTooltip.y - 48 }}
        >
          <div className="flex items-center gap-2">
            <span
              className="w-2 h-2 rounded-full inline-block"
              style={{ backgroundColor: PERSONAL_TYPE_COLORS[personalTooltip.pe.type] }}
            />
            <span className="font-bold">{t(personalTooltip.pe.type)}</span>
          </div>
          <div className="text-zinc-400 text-[10px] mt-0.5">
            {personalTooltip.pe.name && `${personalTooltip.pe.name} · `}
            {formatHHMMSS(personalTooltip.pe.ts)}
          </div>
        </div>
      )}
    </div>
  );
}

/** Convert a unix ms to game timestamp string and seek. */
function seekToMs(ms: number, seek: (ts: string) => void): void {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  const ts = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  seek(ts);
}
