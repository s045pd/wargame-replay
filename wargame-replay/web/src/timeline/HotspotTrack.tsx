import { useEffect, useRef, useMemo, useState } from 'react';
import { usePlayback } from '../store/playback';
import { useDirector } from '../store/director';
import { useHotspotFilter } from '../store/hotspotFilter';
import { useI18n } from '../lib/i18n';
import { HotspotEvent } from '../lib/api';

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

/** Type label for display */
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

interface HotspotTrackProps {
  height: number;
  labelWidth: number;
}

export function HotspotTrack({ height, labelWidth }: HotspotTrackProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const { meta, allHotspots: rawHotspots, currentTs, seek } = usePlayback();
  const { typeFilters } = useHotspotFilter();
  const { t } = useI18n();
  const [tooltip, setTooltip] = useState<{ x: number; y: number; hs: HotspotEvent } | null>(null);

  // Filter hotspots by enabled types
  const hotspots = useMemo(
    () => rawHotspots.filter((hs) => typeFilters[hs.type as keyof typeof typeFilters]),
    [rawHotspots, typeFilters],
  );

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
  }, [meta, sortedHotspots, currentTs, startMs, endMs, totalMs]);

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

  // Click to seek to hotspot peak time + fly camera there
  const handleClick = (e: React.MouseEvent) => {
    if (!meta || totalMs <= 0 || !containerRef.current) return;

    const rect = containerRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const canvasWidth = rect.width;
    if (canvasWidth <= 0) return;

    const ratio = Math.max(0, Math.min(1, x / canvasWidth));
    const clickMs = startMs + ratio * totalMs;

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
      // Seek to peak time and fly camera there
      seek(best.peakTs);
      if (best.centerLat !== 0 || best.centerLng !== 0) {
        useDirector.getState().setTargetCamera({
          lat: best.centerLat,
          lng: best.centerLng,
          zoom: 17,
        });
      }
    } else {
      // No hotspot — seek to clicked time
      const d = new Date(clickMs);
      const pad = (n: number) => String(n).padStart(2, '0');
      const ts = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
      seek(ts);
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
  };

  const handleMouseLeave = () => setTooltip(null);

  return (
    <div className="flex items-stretch border-b border-zinc-800" style={{ height }}>
      {/* Label sidebar */}
      <div
        className="shrink-0 flex items-center px-2 text-[10px] font-medium tracking-wider uppercase border-r border-zinc-800"
        style={{ width: labelWidth, color: '#ef4444', borderLeftColor: '#ef4444', borderLeftWidth: 2 }}
      >
        {t('hotspot')}
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
    </div>
  );
}
