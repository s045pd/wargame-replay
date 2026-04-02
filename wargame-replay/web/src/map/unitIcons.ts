import type * as mapboxgl from 'maplibre-gl';
import { UnitClass } from '../lib/api';

const ICON_SIZE = 28;

type TeamKey = 'red' | 'blue';

const TEAM_COLORS: Record<TeamKey, { fill: string; stroke: string; deadFill: string; deadStroke: string; depletedFill: string }> = {
  red:  { fill: '#e03030', stroke: '#ff8888', deadFill: '#662222', deadStroke: '#994444', depletedFill: '#441111' },
  blue: { fill: '#1890ff', stroke: '#88ccff', deadFill: '#223366', deadStroke: '#446699', depletedFill: '#112244' },
};

/** Rifle — filled circle */
function drawCircle(ctx: CanvasRenderingContext2D, fill: string, stroke: string) {
  const cx = ICON_SIZE / 2;
  const cy = ICON_SIZE / 2;
  const r = ICON_SIZE * 0.34;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.strokeStyle = stroke;
  ctx.lineWidth = 1.8;
  ctx.stroke();
}

/** MG — filled rounded square (方框) */
function drawSquare(ctx: CanvasRenderingContext2D, fill: string, stroke: string) {
  const pad = ICON_SIZE * 0.2;
  const size = ICON_SIZE - pad * 2;
  const r = 2.5;
  ctx.beginPath();
  ctx.moveTo(pad + r, pad);
  ctx.lineTo(pad + size - r, pad);
  ctx.quadraticCurveTo(pad + size, pad, pad + size, pad + r);
  ctx.lineTo(pad + size, pad + size - r);
  ctx.quadraticCurveTo(pad + size, pad + size, pad + size - r, pad + size);
  ctx.lineTo(pad + r, pad + size);
  ctx.quadraticCurveTo(pad, pad + size, pad, pad + size - r);
  ctx.lineTo(pad, pad + r);
  ctx.quadraticCurveTo(pad, pad, pad + r, pad);
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.strokeStyle = stroke;
  ctx.lineWidth = 1.8;
  ctx.stroke();
}

/** Medic — plus/cross shape (加号) */
function drawCross(ctx: CanvasRenderingContext2D, fill: string, stroke: string) {
  const cx = ICON_SIZE / 2;
  const cy = ICON_SIZE / 2;
  const arm = ICON_SIZE * 0.34;
  const w = ICON_SIZE * 0.16;
  ctx.beginPath();
  ctx.moveTo(cx - w, cy - arm);
  ctx.lineTo(cx + w, cy - arm);
  ctx.lineTo(cx + w, cy - w);
  ctx.lineTo(cx + arm, cy - w);
  ctx.lineTo(cx + arm, cy + w);
  ctx.lineTo(cx + w, cy + w);
  ctx.lineTo(cx + w, cy + arm);
  ctx.lineTo(cx - w, cy + arm);
  ctx.lineTo(cx - w, cy + w);
  ctx.lineTo(cx - arm, cy + w);
  ctx.lineTo(cx - arm, cy - w);
  ctx.lineTo(cx - w, cy - w);
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.strokeStyle = stroke;
  ctx.lineWidth = 1.5;
  ctx.stroke();
}

/** Sniper — filled upward triangle (三角) */
function drawTriangle(ctx: CanvasRenderingContext2D, fill: string, stroke: string) {
  const cx = ICON_SIZE / 2;
  const top = ICON_SIZE * 0.14;
  const bot = ICON_SIZE * 0.82;
  const halfW = ICON_SIZE * 0.34;
  ctx.beginPath();
  ctx.moveTo(cx, top);
  ctx.lineTo(cx + halfW, bot);
  ctx.lineTo(cx - halfW, bot);
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.strokeStyle = stroke;
  ctx.lineWidth = 1.8;
  ctx.stroke();
}

/** Marksman — filled diamond (菱形) */
function drawDiamond(ctx: CanvasRenderingContext2D, fill: string, stroke: string) {
  const cx = ICON_SIZE / 2;
  const cy = ICON_SIZE / 2;
  const rx = ICON_SIZE * 0.28;
  const ry = ICON_SIZE * 0.36;
  ctx.beginPath();
  ctx.moveTo(cx, cy - ry);
  ctx.lineTo(cx + rx, cy);
  ctx.lineTo(cx, cy + ry);
  ctx.lineTo(cx - rx, cy);
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.strokeStyle = stroke;
  ctx.lineWidth = 1.8;
  ctx.stroke();
}

type DrawFn = (ctx: CanvasRenderingContext2D, fill: string, stroke: string) => void;

const DRAW_MAP: Record<UnitClass, DrawFn> = {
  rifle: drawCircle,
  mg: drawSquare,
  medic: drawCross,
  marksman: drawDiamond,
  sniper: drawTriangle,
};

// HP levels: 0, 10, 20, ..., 100 (11 levels)
const HP_LEVELS = [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100];

/**
 * Create an icon with HP fill level.
 * Draws depleted color first, then clips to the bottom `hpPct%` and draws bright color.
 */
function createHPIcon(
  drawFn: DrawFn,
  fill: string,
  stroke: string,
  depletedFill: string,
  hpPct: number,
): ImageData {
  const canvas = document.createElement('canvas');
  canvas.width = ICON_SIZE;
  canvas.height = ICON_SIZE;
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, ICON_SIZE, ICON_SIZE);

  if (hpPct >= 100) {
    // Full HP — just draw normally
    drawFn(ctx, fill, stroke);
  } else if (hpPct <= 0) {
    // Dead — draw depleted
    drawFn(ctx, depletedFill, stroke);
  } else {
    // Partial HP — draw depleted base, then clip and draw bright portion
    // 1. Draw depleted (full shape)
    drawFn(ctx, depletedFill, stroke);

    // 2. Clip to bottom hpPct% and overdraw with bright color
    const clipY = ICON_SIZE * (1 - hpPct / 100); // top of bright region
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, clipY, ICON_SIZE, ICON_SIZE - clipY);
    ctx.clip();
    drawFn(ctx, fill, stroke);
    ctx.restore();
  }

  return ctx.getImageData(0, 0, ICON_SIZE, ICON_SIZE);
}

function createDeadIcon(drawFn: DrawFn, deadFill: string, deadStroke: string): ImageData {
  const canvas = document.createElement('canvas');
  canvas.width = ICON_SIZE;
  canvas.height = ICON_SIZE;
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, ICON_SIZE, ICON_SIZE);
  drawFn(ctx, deadFill, deadStroke);
  return ctx.getImageData(0, 0, ICON_SIZE, ICON_SIZE);
}

/**
 * Icon name convention:
 * - Alive with HP: `unit-{team}-{class}-hp{level}` e.g. `unit-red-rifle-hp80`
 * - Dead: `unit-{team}-{class}-dead`
 */
export function iconName(team: string, cls: UnitClass, dead = false, hp = 100): string {
  if (dead) return `unit-${team}-${cls}-dead`;
  // Snap HP to nearest 10
  const level = Math.max(0, Math.min(100, Math.round(hp / 10) * 10));
  return `unit-${team}-${cls}-hp${level}`;
}

/**
 * Register all unit icons on a Mapbox map instance.
 * Generates icons for each (team, class, hp-level) + dead variants.
 */
export function registerUnitIcons(map: mapboxgl.Map): void {
  const teams: TeamKey[] = ['red', 'blue'];
  const classes: UnitClass[] = ['rifle', 'mg', 'medic', 'marksman', 'sniper'];

  for (const team of teams) {
    const colors = TEAM_COLORS[team];
    for (const cls of classes) {
      const drawFn = DRAW_MAP[cls];

      // HP-level icons for alive units
      for (const hpLvl of HP_LEVELS) {
        const id = `unit-${team}-${cls}-hp${hpLvl}`;
        if (!map.hasImage(id)) {
          const img = createHPIcon(drawFn, colors.fill, colors.stroke, colors.depletedFill, hpLvl);
          map.addImage(id, img, { pixelRatio: 2 });
        }
      }

      // Dead icon
      const deadId = `unit-${team}-${cls}-dead`;
      if (!map.hasImage(deadId)) {
        const img = createDeadIcon(drawFn, colors.deadFill, colors.deadStroke);
        map.addImage(deadId, img, { pixelRatio: 2 });
      }
    }
  }
}
