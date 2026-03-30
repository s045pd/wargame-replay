import { useEffect, useRef } from 'react';
import { UnitPosition } from '../lib/api';
import { useDirector } from '../store/director';

interface QuadrantViewport {
  label: string;
  // Normalized [0,1] region of the map this preview focuses on
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

function drawPreview(
  ctx: CanvasRenderingContext2D,
  units: UnitPosition[],
  width: number,
  height: number,
  viewport: QuadrantViewport,
  isActive: boolean,
) {
  // Background
  ctx.fillStyle = '#0a0a14';
  ctx.fillRect(0, 0, width, height);

  // Border highlight if active
  if (isActive) {
    ctx.strokeStyle = '#f59e0b';
    ctx.lineWidth = 2;
    ctx.strokeRect(1, 1, width - 2, height - 2);
  }

  const vw = viewport.xMax - viewport.xMin;
  const vh = viewport.yMax - viewport.yMin;

  // Draw units within the viewport
  for (const unit of units) {
    if (!unit.alive) continue;
    if (unit.x === undefined || unit.y === undefined) continue;

    // Map from viewport space to canvas space
    const nx = (unit.x - viewport.xMin) / vw;
    const ny = (unit.y - viewport.yMin) / vh;

    // Slightly draw units outside the viewport as dimmed
    const inside = nx >= 0 && nx <= 1 && ny >= 0 && ny <= 1;
    const px = nx * width;
    const py = ny * height;

    if (!inside) {
      // Skip units outside viewport
      continue;
    }

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
  units: UnitPosition[];
  viewport: QuadrantViewport;
  isActive: boolean;
  onSelect: () => void;
}

function PreviewCanvas({ units, viewport, isActive, onSelect }: PreviewCanvasProps) {
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
      drawPreview(ctx, units, canvas.offsetWidth, canvas.offsetHeight, viewport, isActive);
      rafRef.current = null;
    });
  }, [units, viewport, isActive]);

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

  const getActiveIndex = (): number => {
    if (!targetCamera) return -1;
    // Determine which quadrant the target camera is in
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
    setTargetCamera({ x: cx, y: cy, zoom: 6 });
  };

  return (
    <div className="space-y-1">
      <div className="text-xs text-zinc-500 uppercase tracking-wider mb-2">Preview</div>
      <div className="grid grid-cols-2 gap-1">
        {QUADRANTS.map((q, i) => (
          <PreviewCanvas
            key={q.label}
            units={units}
            viewport={q}
            isActive={activeIdx === i}
            onSelect={() => handleSelect(i)}
          />
        ))}
      </div>
    </div>
  );
}
