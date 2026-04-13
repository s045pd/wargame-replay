import type * as mapboxgl from 'maplibre-gl';
import { UnitClass } from '../lib/api';

export interface IconConfig {
  size: number;
  redFill: string;
  redStroke: string;
  redDeadFill: string;
  redDeadStroke: string;
  redDepletedFill: string;
  blueFill: string;
  blueStroke: string;
  blueDeadFill: string;
  blueDeadStroke: string;
  blueDepletedFill: string;
}

function lighten(hex: string, amount = 0.4): string {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.min(255, ((n >> 16) & 0xff) + Math.round(255 * amount));
  const g = Math.min(255, ((n >> 8) & 0xff) + Math.round(255 * amount));
  const b = Math.min(255, (n & 0xff) + Math.round(255 * amount));
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
}

function darken(hex: string, amount = 0.5): string {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.round(((n >> 16) & 0xff) * (1 - amount));
  const g = Math.round(((n >> 8) & 0xff) * (1 - amount));
  const b = Math.round((n & 0xff) * (1 - amount));
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
}

const DEFAULT_CONFIG: IconConfig = {
  size: 28,
  redFill: '#e03030',
  redStroke: lighten('#e03030'),
  redDeadFill: '#662222',
  redDeadStroke: lighten('#662222'),
  redDepletedFill: darken('#e03030'),
  blueFill: '#1890ff',
  blueStroke: lighten('#1890ff'),
  blueDeadFill: '#223366',
  blueDeadStroke: lighten('#223366'),
  blueDepletedFill: darken('#1890ff'),
};

type TeamKey = 'red' | 'blue';

function teamColorsFromConfig(config: IconConfig): Record<TeamKey, { fill: string; stroke: string; deadFill: string; deadStroke: string; depletedFill: string }> {
  return {
    red: {
      fill: config.redFill,
      stroke: config.redStroke,
      deadFill: config.redDeadFill,
      deadStroke: config.redDeadStroke,
      depletedFill: config.redDepletedFill,
    },
    blue: {
      fill: config.blueFill,
      stroke: config.blueStroke,
      deadFill: config.blueDeadFill,
      deadStroke: config.blueDeadStroke,
      depletedFill: config.blueDepletedFill,
    },
  };
}

/** Rifle — filled circle */
function drawCircle(ctx: CanvasRenderingContext2D, fill: string, stroke: string, iconSize: number) {
  const cx = iconSize / 2;
  const cy = iconSize / 2;
  const r = iconSize * 0.34;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.strokeStyle = stroke;
  ctx.lineWidth = 1.8;
  ctx.stroke();
}

/** MG — filled rounded square (方框) */
function drawSquare(ctx: CanvasRenderingContext2D, fill: string, stroke: string, iconSize: number) {
  const pad = iconSize * 0.2;
  const size = iconSize - pad * 2;
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
function drawCross(ctx: CanvasRenderingContext2D, fill: string, stroke: string, iconSize: number) {
  const cx = iconSize / 2;
  const cy = iconSize / 2;
  const arm = iconSize * 0.34;
  const w = iconSize * 0.16;
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
function drawTriangle(ctx: CanvasRenderingContext2D, fill: string, stroke: string, iconSize: number) {
  const cx = iconSize / 2;
  const top = iconSize * 0.14;
  const bot = iconSize * 0.82;
  const halfW = iconSize * 0.34;
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
function drawDiamond(ctx: CanvasRenderingContext2D, fill: string, stroke: string, iconSize: number) {
  const cx = iconSize / 2;
  const cy = iconSize / 2;
  const rx = iconSize * 0.28;
  const ry = iconSize * 0.36;
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

type DrawFn = (ctx: CanvasRenderingContext2D, fill: string, stroke: string, iconSize: number) => void;

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
  iconSize: number,
): ImageData {
  const canvas = document.createElement('canvas');
  canvas.width = iconSize;
  canvas.height = iconSize;
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, iconSize, iconSize);

  if (hpPct >= 100) {
    // Full HP — just draw normally
    drawFn(ctx, fill, stroke, iconSize);
  } else if (hpPct <= 0) {
    // Dead — draw depleted
    drawFn(ctx, depletedFill, stroke, iconSize);
  } else {
    // Partial HP — draw depleted base, then clip and draw bright portion
    // 1. Draw depleted (full shape)
    drawFn(ctx, depletedFill, stroke, iconSize);

    // 2. Clip to bottom hpPct% and overdraw with bright color
    const clipY = iconSize * (1 - hpPct / 100); // top of bright region
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, clipY, iconSize, iconSize - clipY);
    ctx.clip();
    drawFn(ctx, fill, stroke, iconSize);
    ctx.restore();
  }

  return ctx.getImageData(0, 0, iconSize, iconSize);
}

function createDeadIcon(drawFn: DrawFn, deadFill: string, deadStroke: string, iconSize: number): ImageData {
  const canvas = document.createElement('canvas');
  canvas.width = iconSize;
  canvas.height = iconSize;
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, iconSize, iconSize);
  drawFn(ctx, deadFill, deadStroke, iconSize);
  return ctx.getImageData(0, 0, iconSize, iconSize);
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
 * Build a full IconConfig from a partial override + defaults.
 * When only main colors are provided (redFill / blueFill / redDeadFill / blueDeadFill),
 * derives stroke and depleted variants automatically.
 */
function resolveConfig(partial?: Partial<IconConfig>): IconConfig {
  if (!partial) return DEFAULT_CONFIG;

  const redFill = partial.redFill ?? DEFAULT_CONFIG.redFill;
  const blueFill = partial.blueFill ?? DEFAULT_CONFIG.blueFill;
  const redDeadFill = partial.redDeadFill ?? DEFAULT_CONFIG.redDeadFill;
  const blueDeadFill = partial.blueDeadFill ?? DEFAULT_CONFIG.blueDeadFill;

  return {
    size: partial.size ?? DEFAULT_CONFIG.size,
    redFill,
    redStroke: partial.redStroke ?? lighten(redFill),
    redDeadFill,
    redDeadStroke: partial.redDeadStroke ?? lighten(redDeadFill),
    redDepletedFill: partial.redDepletedFill ?? darken(redFill),
    blueFill,
    blueStroke: partial.blueStroke ?? lighten(blueFill),
    blueDeadFill,
    blueDeadStroke: partial.blueDeadStroke ?? lighten(blueDeadFill),
    blueDepletedFill: partial.blueDepletedFill ?? darken(blueFill),
  };
}

/**
 * Register all unit icons on a Mapbox map instance.
 * Generates icons for each (team, class, hp-level) + dead variants.
 *
 * Accepts an optional partial config to override default colors and size.
 * When called again with different config, existing images are updated in place.
 */
export function registerUnitIcons(map: mapboxgl.Map, config?: Partial<IconConfig>): void {
  const resolved = resolveConfig(config);
  const teamColors = teamColorsFromConfig(resolved);
  const iconSize = resolved.size;
  const teams: TeamKey[] = ['red', 'blue'];
  const classes: UnitClass[] = ['rifle', 'mg', 'medic', 'marksman', 'sniper'];

  for (const team of teams) {
    const colors = teamColors[team];
    for (const cls of classes) {
      const drawFn = DRAW_MAP[cls];

      // HP-level icons for alive units
      for (const hpLvl of HP_LEVELS) {
        const id = `unit-${team}-${cls}-hp${hpLvl}`;
        const img = createHPIcon(drawFn, colors.fill, colors.stroke, colors.depletedFill, hpLvl, iconSize);
        if (map.hasImage(id)) {
          map.updateImage(id, img);
        } else {
          map.addImage(id, img, { pixelRatio: 2 });
        }
      }

      // Dead icon
      const deadId = `unit-${team}-${cls}-dead`;
      const deadImg = createDeadIcon(drawFn, colors.deadFill, colors.deadStroke, iconSize);
      if (map.hasImage(deadId)) {
        map.updateImage(deadId, deadImg);
      } else {
        map.addImage(deadId, deadImg, { pixelRatio: 2 });
      }
    }
  }
}
