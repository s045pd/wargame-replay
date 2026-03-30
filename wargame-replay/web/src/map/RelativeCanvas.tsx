import { useEffect, useRef } from 'react';
import { UnitPosition } from '../lib/api';

interface RelativeCanvasProps {
  units: UnitPosition[];
}

const GRID_COLOR = 'rgba(255,255,255,0.05)';
const GRID_DIVISIONS = 10;
const UNIT_RADIUS = 5;
const GLOW_RADIUS = 12;

function teamColor(team: string): string {
  if (team === 'red') return '#ff4444';
  if (team === 'blue') return '#00ccff';
  return '#aaaaaa';
}

function teamGlowColor(team: string): string {
  if (team === 'red') return 'rgba(255, 136, 0, 0.3)';
  if (team === 'blue') return 'rgba(0, 102, 255, 0.3)';
  return 'rgba(100, 100, 100, 0.3)';
}

function drawFrame(ctx: CanvasRenderingContext2D, units: UnitPosition[], width: number, height: number) {
  // Dark background
  ctx.fillStyle = '#0a0a0f';
  ctx.fillRect(0, 0, width, height);

  // Grid
  ctx.strokeStyle = GRID_COLOR;
  ctx.lineWidth = 1;
  for (let i = 0; i <= GRID_DIVISIONS; i++) {
    const x = (i / GRID_DIVISIONS) * width;
    const y = (i / GRID_DIVISIONS) * height;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, height);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
    ctx.stroke();
  }

  // Units
  for (const unit of units) {
    if (!unit.alive) continue;
    if (unit.x === undefined || unit.y === undefined) continue;

    const px = unit.x * width;
    const py = unit.y * height;

    // Glow
    ctx.beginPath();
    ctx.arc(px, py, GLOW_RADIUS, 0, Math.PI * 2);
    ctx.fillStyle = teamGlowColor(unit.team);
    ctx.fill();

    // Dot
    ctx.beginPath();
    ctx.arc(px, py, UNIT_RADIUS, 0, Math.PI * 2);
    ctx.fillStyle = teamColor(unit.team);
    ctx.fill();

    // Border
    ctx.strokeStyle = 'rgba(255,255,255,0.4)';
    ctx.lineWidth = 1;
    ctx.stroke();
  }
}

export function RelativeCanvas({ units }: RelativeCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const resize = () => {
      canvas.width = canvas.offsetWidth * window.devicePixelRatio;
      canvas.height = canvas.offsetHeight * window.devicePixelRatio;
      ctx.setTransform(window.devicePixelRatio, 0, 0, window.devicePixelRatio, 0, 0);
    };

    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);

    return () => {
      observer.disconnect();
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);

    rafRef.current = requestAnimationFrame(() => {
      const w = canvas.offsetWidth;
      const h = canvas.offsetHeight;
      drawFrame(ctx, units, w, h);
      rafRef.current = null;
    });
  }, [units]);

  return (
    <canvas
      ref={canvasRef}
      className="absolute inset-0 w-full h-full"
      style={{ display: 'block' }}
    />
  );
}
