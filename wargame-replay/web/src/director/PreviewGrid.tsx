import { useEffect, useRef } from 'react';
import { UnitPosition } from '../lib/api';
import { useDirector } from '../store/director';
import { usePlayback } from '../store/playback';
import { useI18n } from '../lib/i18n';

interface QuadrantViewport {
  label: string;
  xMin: number;
  yMin: number;
  xMax: number;
  yMax: number;
}

const QUADRANTS: QuadrantViewport[] = [
  { label: 'NW', xMin: 0, yMin: 0, xMax: 0.5, yMax: 0.5 },
  { label: 'NE', xMin: 0.5, yMin: 0, xMax: 1, yMax: 0.5 },
  { label: 'SW', xMin: 0, yMin: 0.5, xMax: 0.5, yMax: 1 },
  { label: 'SE', xMin: 0.5, yMin: 0.5, xMax: 1, yMax: 1 },
];

function teamColor(team: string): string {
  if (team === 'red') return '#ff4444';
  if (team === 'blue') return '#00ccff';
  return '#aaaaaa';
}

/** Normalize units to [0,1] range regardless of coordinate mode. */
function normalizeUnits(
  units: UnitPosition[],
  coordMode: string,
  bounds?: { minLat: number; maxLat: number; minLng: number; maxLng: number },
): { nx: number; ny: number; team: string; alive: boolean }[] {
  const result: { nx: number; ny: number; team: string; alive: boolean }[] = [];

  if (coordMode === 'wgs84' && bounds) {
    const latRange = bounds.maxLat - bounds.minLat;
    const lngRange = bounds.maxLng - bounds.minLng;
    if (latRange <= 0 || lngRange <= 0) return result;

    for (const u of units) {
      if (u.lat === undefined || u.lng === undefined) continue;
      const nx = (u.lng - bounds.minLng) / lngRange;
      // Flip lat: higher lat = top of screen (lower y)
      const ny = 1 - (u.lat - bounds.minLat) / latRange;
      result.push({ nx, ny, team: u.team, alive: u.alive });
    }
  } else {
    for (const u of units) {
      if (u.x === undefined || u.y === undefined) continue;
      result.push({ nx: u.x, ny: u.y, team: u.team, alive: u.alive });
    }
  }
  return result;
}

function drawPreview(
  ctx: CanvasRenderingContext2D,
  normalizedUnits: { nx: number; ny: number; team: string; alive: boolean }[],
  width: number,
  height: number,
  viewport: QuadrantViewport,
  isActive: boolean,
) {
  ctx.fillStyle = '#0a0a14';
  ctx.fillRect(0, 0, width, height);

  if (isActive) {
    ctx.strokeStyle = '#f59e0b';
    ctx.lineWidth = 2;
    ctx.strokeRect(1, 1, width - 2, height - 2);
  }

  const vw = viewport.xMax - viewport.xMin;
  const vh = viewport.yMax - viewport.yMin;

  for (const unit of normalizedUnits) {
    if (!unit.alive) continue;

    const nx = (unit.nx - viewport.xMin) / vw;
    const ny = (unit.ny - viewport.yMin) / vh;

    if (nx < 0 || nx > 1 || ny < 0 || ny > 1) continue;

    const px = nx * width;
    const py = ny * height;

    ctx.beginPath();
    ctx.arc(px, py, 3, 0, Math.PI * 2);
    ctx.fillStyle = teamColor(unit.team);
    ctx.globalAlpha = 0.85;
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  // Label
  ctx.fillStyle = 'rgba(255,255,255,0.5)';
  ctx.font = '10px monospace';
  ctx.fillText(viewport.label, 6, 14);
}

interface PreviewCanvasProps {
  normalizedUnits: { nx: number; ny: number; team: string; alive: boolean }[];
  viewport: QuadrantViewport;
  isActive: boolean;
  onSelect: () => void;
}

function PreviewCanvas({ normalizedUnits, viewport, isActive, onSelect }: PreviewCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const observer = new ResizeObserver(() => {
      canvas.width = canvas.offsetWidth * window.devicePixelRatio;
      canvas.height = canvas.offsetHeight * window.devicePixelRatio;
    });
    observer.observe(canvas);

    canvas.width = canvas.offsetWidth * window.devicePixelRatio;
    canvas.height = canvas.offsetHeight * window.devicePixelRatio;

    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);

    rafRef.current = requestAnimationFrame(() => {
      const dpr = window.devicePixelRatio;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      drawPreview(ctx, normalizedUnits, canvas.offsetWidth, canvas.offsetHeight, viewport, isActive);
      rafRef.current = null;
    });
  }, [normalizedUnits, viewport, isActive]);

  return (
    <div
      className={`relative cursor-pointer rounded overflow-hidden border ${
        isActive ? 'border-amber-500' : 'border-zinc-700 hover:border-zinc-500'
      }`}
      style={{ height: '90px' }}
      onClick={onSelect}
    >
      <canvas
        ref={canvasRef}
        className="w-full h-full block"
      />
    </div>
  );
}

interface PreviewGridProps {
  units: UnitPosition[];
}

export function PreviewGrid({ units }: PreviewGridProps) {
  const { targetCamera, setTargetCamera } = useDirector();
  const { coordMode, meta } = usePlayback();
  const { t } = useI18n();

  // Normalize all units to [0,1] once
  const normalizedUnits = normalizeUnits(units, coordMode, meta?.bounds);

  const getActiveIndex = (): number => {
    if (!targetCamera) return -1;
    const cx = targetCamera.x ?? 0.5;
    const cy = targetCamera.y ?? 0.5;
    return QUADRANTS.findIndex(
      (q) => cx >= q.xMin && cx < q.xMax && cy >= q.yMin && cy < q.yMax,
    );
  };

  const activeIdx = getActiveIndex();

  const handleSelect = (idx: number) => {
    const q = QUADRANTS[idx];
    const cx = (q.xMin + q.xMax) / 2;
    const cy = (q.yMin + q.yMax) / 2;

    if (coordMode === 'wgs84' && meta?.bounds) {
      const bounds = meta.bounds;
      const latRange = bounds.maxLat - bounds.minLat;
      const lngRange = bounds.maxLng - bounds.minLng;
      const lng = bounds.minLng + cx * lngRange;
      const lat = bounds.maxLat - cy * latRange; // Flip: y=0 is top = maxLat
      setTargetCamera({ lng, lat, zoom: 16 });
    } else {
      setTargetCamera({ x: cx, y: cy, zoom: 6 });
    }
  };

  return (
    <div className="space-y-1">
      <div className="text-xs text-zinc-500 uppercase tracking-wider mb-2">{t('preview')}</div>
      <div className="grid grid-cols-2 gap-1">
        {QUADRANTS.map((q, i) => (
          <PreviewCanvas
            key={q.label}
            normalizedUnits={normalizedUnits}
            viewport={q}
            isActive={activeIdx === i}
            onSelect={() => handleSelect(i)}
          />
        ))}
      </div>
    </div>
  );
}
