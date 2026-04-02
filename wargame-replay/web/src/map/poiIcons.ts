/**
 * POI / location icon system — Canvas-drawn icons registered on Mapbox map.
 *
 * Each icon is a single-color silhouette drawn into a 32×32 canvas.
 * Color is parameterised so one shape definition serves all team variants.
 * A "destroyed" overlay (diagonal X) can be composited on top.
 *
 * Naming convention:  poi-{type}-{color}       e.g. poi-tank-red
 *                     poi-{type}-{color}-dead   e.g. poi-tank-red-dead
 */

import type * as mapboxgl from 'maplibre-gl';

const S = 32; // icon canvas size (px)
const S2 = S / 2; // center

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type POIIconKey =
  | 'base' | 'supply' | 'control' | 'flag' | 'medic' | 'ammo'
  | 'fob' | 'explode' | 'radar' | 'shield' | 'defense'
  | 'tank' | 'helicopter' | 'mortar' | 'truck' | 'sword'
  | 'plane' | 'uav' | 'soldier' | 'assault' | 'danger' | 'dog';

export const POI_ICON_KEYS: POIIconKey[] = [
  'base', 'supply', 'control', 'flag', 'medic', 'ammo',
  'fob', 'explode', 'radar', 'shield', 'defense',
  'tank', 'helicopter', 'mortar', 'truck', 'sword',
  'plane', 'uav', 'soldier', 'assault', 'danger', 'dog',
];

type DrawFn = (ctx: CanvasRenderingContext2D, color: string) => void;

// ---------------------------------------------------------------------------
// Drawing helpers
// ---------------------------------------------------------------------------

function ctx32(): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = S;
  c.height = S;
  return [c, c.getContext('2d')!];
}

// ---------------------------------------------------------------------------
// Icon draw functions — each draws a filled silhouette into a 32×32 canvas
// ---------------------------------------------------------------------------

/** base — military building: rectangular body + dome roof + chimney */
const drawBase: DrawFn = (ctx, c) => {
  ctx.fillStyle = c;
  // Chimney
  ctx.fillRect(14, 3, 4, 7);
  ctx.fillRect(12, 3, 8, 2);
  // Dome roof
  ctx.beginPath();
  ctx.arc(S2, 16, 10, Math.PI, 0);
  ctx.fill();
  // Body
  ctx.fillRect(6, 16, 20, 12);
  // Door
  ctx.clearRect(13, 22, 6, 6);
};

/** supply — 3 stacked crates (pyramid) with X binding marks */
const drawSupply: DrawFn = (ctx, c) => {
  ctx.fillStyle = c;
  ctx.strokeStyle = c;
  ctx.lineWidth = 1.2;

  const drawCrate = (x: number, y: number, w: number, h: number) => {
    ctx.fillRect(x, y, w, h);
    // X mark (cut out)
    ctx.save();
    ctx.globalCompositeOperation = 'destination-out';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(x + 2, y + 2);
    ctx.lineTo(x + w - 2, y + h - 2);
    ctx.moveTo(x + w - 2, y + 2);
    ctx.lineTo(x + 2, y + h - 2);
    ctx.stroke();
    ctx.restore();
  };

  drawCrate(4, 18, 10, 10);   // bottom-left
  drawCrate(18, 18, 10, 10);  // bottom-right
  drawCrate(11, 6, 10, 10);   // top center
};

/** control — concentric rotated squares (diamond in diamond) */
const drawControl: DrawFn = (ctx, c) => {
  ctx.fillStyle = c;
  // Outer diamond
  ctx.beginPath();
  ctx.moveTo(S2, 2);
  ctx.lineTo(30, S2);
  ctx.lineTo(S2, 30);
  ctx.lineTo(2, S2);
  ctx.closePath();
  ctx.fill();
  // Cut inner diamond (transparent)
  ctx.globalCompositeOperation = 'destination-out';
  ctx.beginPath();
  ctx.moveTo(S2, 9);
  ctx.lineTo(23, S2);
  ctx.lineTo(S2, 23);
  ctx.lineTo(9, S2);
  ctx.closePath();
  ctx.fill();
  ctx.globalCompositeOperation = 'source-over';
};

/** flag — waving flag on a pole */
const drawFlag: DrawFn = (ctx, c) => {
  ctx.fillStyle = c;
  // Pole
  ctx.fillRect(6, 4, 2.5, 24);
  // Ball finial
  ctx.beginPath();
  ctx.arc(7.25, 4, 2, 0, Math.PI * 2);
  ctx.fill();
  // Flag body — curved shape billowing right
  ctx.beginPath();
  ctx.moveTo(8.5, 6);
  ctx.quadraticCurveTo(20, 4, 26, 8);
  ctx.quadraticCurveTo(22, 12, 26, 16);
  ctx.quadraticCurveTo(18, 14, 8.5, 18);
  ctx.closePath();
  ctx.fill();
};

/** medic — bold plus/cross symbol */
const drawMedic: DrawFn = (ctx, c) => {
  ctx.fillStyle = c;
  // Vertical bar
  ctx.fillRect(11, 4, 10, 24);
  // Horizontal bar
  ctx.fillRect(4, 11, 24, 10);
};

/** ammo — stacked ammunition bars with bullet tips */
const drawAmmo: DrawFn = (ctx, c) => {
  ctx.fillStyle = c;
  const barH = 4;
  const gap = 2.5;
  const startY = 5;
  for (let i = 0; i < 4; i++) {
    const y = startY + i * (barH + gap);
    // Main bar
    ctx.fillRect(6, y, 18, barH);
    // Bullet tip (rounded right end)
    ctx.beginPath();
    ctx.arc(24, y + barH / 2, barH / 2, -Math.PI / 2, Math.PI / 2);
    ctx.fill();
  }
};

/** fob — tent / A-frame shelter with entrance */
const drawFob: DrawFn = (ctx, c) => {
  ctx.fillStyle = c;
  // Triangle body
  ctx.beginPath();
  ctx.moveTo(S2, 4);
  ctx.lineTo(28, 28);
  ctx.lineTo(4, 28);
  ctx.closePath();
  ctx.fill();
  // Entrance cutout
  ctx.globalCompositeOperation = 'destination-out';
  ctx.beginPath();
  ctx.moveTo(S2, 20);
  ctx.lineTo(S2 + 4, 28);
  ctx.lineTo(S2 - 4, 28);
  ctx.closePath();
  ctx.fill();
  ctx.globalCompositeOperation = 'source-over';
};

/** explode — starburst explosion */
const drawExplode: DrawFn = (ctx, c) => {
  ctx.fillStyle = c;
  const cx = S2, cy = S2;
  const outerR = 13;
  const innerR = 6;
  const points = 8;
  ctx.beginPath();
  for (let i = 0; i < points * 2; i++) {
    const angle = (i * Math.PI) / points - Math.PI / 2;
    const r = i % 2 === 0 ? outerR : innerR;
    const x = cx + r * Math.cos(angle);
    const y = cy + r * Math.sin(angle);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.fill();
};

/** radar — satellite dish on stand */
const drawRadar: DrawFn = (ctx, c) => {
  ctx.fillStyle = c;
  ctx.strokeStyle = c;
  ctx.lineWidth = 2;
  // Dish (bowl arc)
  ctx.beginPath();
  ctx.arc(S2, 10, 10, Math.PI * 0.15, Math.PI * 0.85);
  ctx.lineTo(S2, 14);
  ctx.closePath();
  ctx.fill();
  // Feed horn (small circle)
  ctx.beginPath();
  ctx.arc(S2, 6, 2, 0, Math.PI * 2);
  ctx.fill();
  // Stand — center pole
  ctx.beginPath();
  ctx.moveTo(S2, 14);
  ctx.lineTo(S2, 26);
  ctx.stroke();
  // Tripod legs
  ctx.beginPath();
  ctx.moveTo(S2, 26);
  ctx.lineTo(S2 - 8, 29);
  ctx.moveTo(S2, 26);
  ctx.lineTo(S2 + 8, 29);
  ctx.moveTo(S2, 26);
  ctx.lineTo(S2, 29);
  ctx.stroke();
};

/** shield — heraldic shield with two chevrons */
const drawShield: DrawFn = (ctx, c) => {
  ctx.fillStyle = c;
  // Shield outline
  ctx.beginPath();
  ctx.moveTo(5, 4);
  ctx.lineTo(27, 4);
  ctx.lineTo(27, 18);
  ctx.quadraticCurveTo(27, 26, S2, 30);
  ctx.quadraticCurveTo(5, 26, 5, 18);
  ctx.closePath();
  ctx.fill();
  // Chevron cutouts (two V shapes)
  ctx.globalCompositeOperation = 'destination-out';
  ctx.lineWidth = 2.5;
  ctx.lineCap = 'round';
  ctx.strokeStyle = '#000';
  // Upper chevron
  ctx.beginPath();
  ctx.moveTo(10, 12);
  ctx.lineTo(S2, 16);
  ctx.lineTo(22, 12);
  ctx.stroke();
  // Lower chevron
  ctx.beginPath();
  ctx.moveTo(10, 19);
  ctx.lineTo(S2, 23);
  ctx.lineTo(22, 19);
  ctx.stroke();
  ctx.globalCompositeOperation = 'source-over';
};

/** defense — brick wall / barricade */
const drawDefense: DrawFn = (ctx, c) => {
  ctx.fillStyle = c;
  const brickW = 8;
  const brickH = 5;
  const gap = 1.5;
  // Row 1 (top) — 3 bricks offset by half
  const y1 = 10;
  ctx.fillRect(2, y1, brickW, brickH);
  ctx.fillRect(2 + brickW + gap, y1, brickW, brickH);
  ctx.fillRect(2 + (brickW + gap) * 2, y1, brickW, brickH);
  // Row 2 — offset by half brick
  const y2 = y1 + brickH + gap;
  const off = (brickW + gap) / 2;
  ctx.fillRect(2 + off, y2, brickW, brickH);
  ctx.fillRect(2 + off + brickW + gap, y2, brickW, brickH);
  // Row 3 — same as row 1
  const y3 = y2 + brickH + gap;
  ctx.fillRect(2, y3, brickW, brickH);
  ctx.fillRect(2 + brickW + gap, y3, brickW, brickH);
  ctx.fillRect(2 + (brickW + gap) * 2, y3, brickW, brickH);
};

/** tank — side-view tank silhouette */
const drawTank: DrawFn = (ctx, c) => {
  ctx.fillStyle = c;
  // Tracks (bottom)
  roundRect(ctx, 3, 21, 26, 7, 3);
  ctx.fill();
  // Hull
  ctx.fillRect(5, 15, 22, 6);
  // Turret
  ctx.fillRect(10, 10, 12, 6);
  // Barrel
  ctx.fillRect(22, 12, 8, 2.5);
};

/** helicopter — top-down with rotor blades */
const drawHelicopter: DrawFn = (ctx, c) => {
  ctx.fillStyle = c;
  ctx.strokeStyle = c;
  // Body (oval)
  ctx.beginPath();
  ctx.ellipse(S2, S2, 4, 6, 0, 0, Math.PI * 2);
  ctx.fill();
  // Tail boom
  ctx.fillRect(S2 - 1, S2 + 4, 2, 8);
  // Tail rotor
  ctx.fillRect(S2 - 4, S2 + 11, 8, 1.5);
  // Main rotor blades (X pattern)
  ctx.lineWidth = 1.8;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(S2 - 13, S2 - 1);
  ctx.lineTo(S2 + 13, S2 + 1);
  ctx.moveTo(S2 + 1, S2 - 13);
  ctx.lineTo(S2 - 1, S2 + 5);
  ctx.stroke();
  // Hub
  ctx.beginPath();
  ctx.arc(S2, S2, 2, 0, Math.PI * 2);
  ctx.fill();
};

/** mortar — angled tube on baseplate */
const drawMortar: DrawFn = (ctx, c) => {
  ctx.fillStyle = c;
  ctx.strokeStyle = c;
  ctx.lineWidth = 3;
  ctx.lineCap = 'round';
  // Barrel (angled)
  ctx.beginPath();
  ctx.moveTo(22, 6);
  ctx.lineTo(10, 22);
  ctx.stroke();
  // Barrel opening (wider top)
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(22, 6, 3, 0, Math.PI * 2);
  ctx.fill();
  // Baseplate
  ctx.fillRect(4, 26, 20, 3);
  // Bipod
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(14, 16);
  ctx.lineTo(8, 26);
  ctx.moveTo(14, 16);
  ctx.lineTo(20, 26);
  ctx.stroke();
};

/** truck — side-view military truck */
const drawTruck: DrawFn = (ctx, c) => {
  ctx.fillStyle = c;
  // Cargo bed
  ctx.fillRect(12, 8, 17, 14);
  // Cab
  ctx.fillRect(3, 12, 10, 10);
  // Windshield cutout
  ctx.globalCompositeOperation = 'destination-out';
  ctx.beginPath();
  ctx.moveTo(3, 12);
  ctx.lineTo(8, 12);
  ctx.lineTo(3, 17);
  ctx.closePath();
  ctx.fill();
  ctx.globalCompositeOperation = 'source-over';
  // Wheels
  ctx.beginPath();
  ctx.arc(9, 25, 3.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(23, 25, 3.5, 0, Math.PI * 2);
  ctx.fill();
  // Axle bar
  ctx.fillRect(3, 22, 26, 2);
};

/** sword — vertical sword pointing down */
const drawSword: DrawFn = (ctx, c) => {
  ctx.fillStyle = c;
  // Blade
  ctx.beginPath();
  ctx.moveTo(S2, 28);       // tip
  ctx.lineTo(S2 - 2.5, 12); // left edge
  ctx.lineTo(S2 + 2.5, 12); // right edge
  ctx.closePath();
  ctx.fill();
  // Crossguard
  ctx.fillRect(8, 10, 16, 3);
  // Handle
  ctx.fillRect(S2 - 1.5, 4, 3, 6);
  // Pommel
  ctx.beginPath();
  ctx.arc(S2, 3, 2.5, 0, Math.PI * 2);
  ctx.fill();
};

/** plane — top-down fixed-wing aircraft */
const drawPlane: DrawFn = (ctx, c) => {
  ctx.fillStyle = c;
  // Fuselage
  ctx.beginPath();
  ctx.moveTo(S2, 2);        // nose
  ctx.lineTo(S2 + 2.5, 8);
  ctx.lineTo(S2 + 2.5, 24);
  ctx.lineTo(S2 + 1, 29);   // tail
  ctx.lineTo(S2 - 1, 29);
  ctx.lineTo(S2 - 2.5, 24);
  ctx.lineTo(S2 - 2.5, 8);
  ctx.closePath();
  ctx.fill();
  // Main wings (swept back)
  ctx.beginPath();
  ctx.moveTo(S2, 12);
  ctx.lineTo(28, 18);
  ctx.lineTo(26, 20);
  ctx.lineTo(S2, 16);
  ctx.lineTo(6, 20);
  ctx.lineTo(4, 18);
  ctx.closePath();
  ctx.fill();
  // Tail wings
  ctx.beginPath();
  ctx.moveTo(S2, 24);
  ctx.lineTo(22, 27);
  ctx.lineTo(21, 28);
  ctx.lineTo(S2, 26);
  ctx.lineTo(11, 28);
  ctx.lineTo(10, 27);
  ctx.closePath();
  ctx.fill();
};

/** uav — top-down quadcopter drone */
const drawUav: DrawFn = (ctx, c) => {
  ctx.fillStyle = c;
  ctx.strokeStyle = c;
  // Central body
  ctx.fillRect(S2 - 3, S2 - 3, 6, 6);
  // Arms (diagonal)
  ctx.lineWidth = 2;
  ctx.lineCap = 'round';
  const armLen = 10;
  const offsets = [
    [-1, -1], [1, -1], [1, 1], [-1, 1],
  ];
  for (const [dx, dy] of offsets) {
    const ex = S2 + dx * armLen;
    const ey = S2 + dy * armLen;
    ctx.beginPath();
    ctx.moveTo(S2, S2);
    ctx.lineTo(ex, ey);
    ctx.stroke();
    // Rotor circle at tip
    ctx.beginPath();
    ctx.arc(ex, ey, 3.5, 0, Math.PI * 2);
    ctx.stroke();
  }
};

/** soldier — helmet + head front view */
const drawSoldier: DrawFn = (ctx, c) => {
  ctx.fillStyle = c;
  // Helmet (dome, wider)
  ctx.beginPath();
  ctx.ellipse(S2, 12, 11, 8, 0, Math.PI, 0);
  ctx.fill();
  // Helmet brim
  ctx.fillRect(4, 11, 24, 3);
  // Face / head
  ctx.beginPath();
  ctx.ellipse(S2, 20, 7, 8, 0, 0, Math.PI);
  ctx.fill();
};

/** assault — two upward-pointing triangles side by side */
const drawAssault: DrawFn = (ctx, c) => {
  ctx.fillStyle = c;
  // Left triangle
  ctx.beginPath();
  ctx.moveTo(8, 6);
  ctx.lineTo(15, 26);
  ctx.lineTo(1, 26);
  ctx.closePath();
  ctx.fill();
  // Right triangle
  ctx.beginPath();
  ctx.moveTo(24, 6);
  ctx.lineTo(31, 26);
  ctx.lineTo(17, 26);
  ctx.closePath();
  ctx.fill();
};

/** danger — circle with exclamation mark */
const drawDanger: DrawFn = (ctx, c) => {
  ctx.strokeStyle = c;
  ctx.fillStyle = c;
  // Circle outline
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.arc(S2, S2, 12, 0, Math.PI * 2);
  ctx.stroke();
  // Exclamation bar
  ctx.fillRect(S2 - 1.5, 9, 3, 11);
  // Exclamation dot
  ctx.beginPath();
  ctx.arc(S2, 24, 2, 0, Math.PI * 2);
  ctx.fill();
};

/** dog — K9 unit / military dog side view silhouette */
const drawDog: DrawFn = (ctx, c) => {
  ctx.fillStyle = c;
  ctx.beginPath();
  // Head
  ctx.moveTo(24, 10);
  ctx.lineTo(28, 8);  // ear
  ctx.lineTo(29, 11);
  ctx.lineTo(30, 11); // nose
  ctx.lineTo(30, 13);
  ctx.lineTo(27, 14); // jaw
  // Body
  ctx.lineTo(24, 14);
  ctx.lineTo(24, 16);
  ctx.quadraticCurveTo(22, 18, 20, 18);
  // Back
  ctx.quadraticCurveTo(14, 17, 8, 18);
  // Tail
  ctx.lineTo(4, 12);
  ctx.lineTo(5, 13);
  ctx.lineTo(7, 16);
  // Hind legs
  ctx.lineTo(8, 24);
  ctx.lineTo(10, 24);
  ctx.lineTo(11, 19);
  ctx.lineTo(14, 19);
  ctx.lineTo(14, 24);
  ctx.lineTo(16, 24);
  ctx.lineTo(17, 19);
  // Belly
  ctx.quadraticCurveTo(20, 20, 22, 19);
  // Front legs
  ctx.lineTo(22, 24);
  ctx.lineTo(24, 24);
  ctx.lineTo(24, 18);
  ctx.lineTo(26, 18);
  ctx.lineTo(26, 24);
  ctx.lineTo(28, 24);
  ctx.lineTo(28, 18);
  ctx.lineTo(26, 15);
  ctx.lineTo(26, 12);
  ctx.closePath();
  ctx.fill();
};

// ---------------------------------------------------------------------------
// Draw function registry
// ---------------------------------------------------------------------------

const DRAW_MAP: Record<POIIconKey, DrawFn> = {
  base: drawBase,
  supply: drawSupply,
  control: drawControl,
  flag: drawFlag,
  medic: drawMedic,
  ammo: drawAmmo,
  fob: drawFob,
  explode: drawExplode,
  radar: drawRadar,
  shield: drawShield,
  defense: drawDefense,
  tank: drawTank,
  helicopter: drawHelicopter,
  mortar: drawMortar,
  truck: drawTruck,
  sword: drawSword,
  plane: drawPlane,
  uav: drawUav,
  soldier: drawSoldier,
  assault: drawAssault,
  danger: drawDanger,
  dog: drawDog,
};

// ---------------------------------------------------------------------------
// Canvas helpers
// ---------------------------------------------------------------------------

/** Rounded rect helper (not all browsers have ctx.roundRect) */
function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, w: number, h: number, r: number,
) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

/** Draw the destroyed X overlay */
function drawDestroyedOverlay(ctx: CanvasRenderingContext2D) {
  ctx.strokeStyle = 'rgba(0,0,0,0.7)';
  ctx.lineWidth = 3;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(4, 4);
  ctx.lineTo(S - 4, S - 4);
  ctx.moveTo(S - 4, 4);
  ctx.lineTo(4, S - 4);
  ctx.stroke();
}

// ---------------------------------------------------------------------------
// Image generation
// ---------------------------------------------------------------------------

function createPOIIcon(key: POIIconKey, color: string): ImageData {
  const [, ctx] = ctx32();
  ctx.clearRect(0, 0, S, S);
  DRAW_MAP[key](ctx, color);
  return ctx.getImageData(0, 0, S, S);
}

function createPOIIconDead(key: POIIconKey, color: string): ImageData {
  const [, ctx] = ctx32();
  ctx.clearRect(0, 0, S, S);
  DRAW_MAP[key](ctx, color);
  // Dim the icon
  ctx.globalCompositeOperation = 'source-atop';
  ctx.fillStyle = 'rgba(0,0,0,0.45)';
  ctx.fillRect(0, 0, S, S);
  ctx.globalCompositeOperation = 'source-over';
  // Slash overlay
  drawDestroyedOverlay(ctx);
  return ctx.getImageData(0, 0, S, S);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Standard team/POI colors for registration */
export const POI_COLORS: Record<string, string> = {
  red: '#e03030',
  blue: '#1890ff',
  yellow: '#f5a623',
  white: '#e0e0e0',
  black: '#3a3a3a',
  neutral: '#ffaa00',
};

/**
 * Build the icon image name used in Mapbox.
 *
 * @param key     Icon type key  e.g. 'tank'
 * @param color   Color key      e.g. 'red'
 * @param dead    Whether to use the destroyed variant
 */
export function poiIconName(key: POIIconKey, color: string, dead = false): string {
  const base = `poi-${key}-${color}`;
  return dead ? `${base}-dead` : base;
}

/**
 * Register all POI icons on a Mapbox map instance.
 * Generates icons for each (type × color) + dead variants.
 */
export function registerPOIIcons(map: mapboxgl.Map): void {
  const colorKeys = Object.keys(POI_COLORS);

  for (const key of POI_ICON_KEYS) {
    for (const ck of colorKeys) {
      const hex = POI_COLORS[ck];
      // Normal variant
      const id = poiIconName(key, ck);
      if (!map.hasImage(id)) {
        map.addImage(id, createPOIIcon(key, hex), { pixelRatio: 2 });
      }
      // Destroyed variant
      const deadId = poiIconName(key, ck, true);
      if (!map.hasImage(deadId)) {
        map.addImage(deadId, createPOIIconDead(key, hex), { pixelRatio: 2 });
      }
    }
  }
}

/**
 * Map numeric POI type (from game data) to an icon key.
 * Falls back to 'flag' for unknown types.
 */
export function poiTypeToIconKey(poiType: number): POIIconKey {
  switch (poiType) {
    case 1: return 'base';
    case 2: return 'fob';         // 兵站 (supply station)
    case 3: return 'supply';     // supply cache
    case 4: return 'control';    // 争夺点 (contest point)
    case 5: return 'base';       // 前哨 (outpost)
    default: return 'flag';
  }
}

/**
 * Map numeric team (from game data) to a color key.
 */
export function poiTeamToColorKey(team: number): string {
  if (team === 0) return 'red';
  if (team === 1) return 'blue';
  return 'neutral';
}
