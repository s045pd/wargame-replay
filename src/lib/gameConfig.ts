// ── Dynamic per-match game-config inference ─────────────────────────────────
//
// The recording protocol stores raw byte counters for ammo / bandage / revive
// in each unit's 15-byte position entry (flags[2..4]). Those bytes are NOT
// direct game-UI numbers — the backend can rebalance "real" magazine sizes,
// total carry, revive HP, etc. per match. So we infer everything we can
// from the .db itself:
//
//   1. ammoRawMax[class] — protocol byte max (from refill/revival samples).
//   2. ammoTotal / magSize[class] — real bullet counts (from ST=64 DT=7
//      config blocks if present; otherwise from the standard preset).
//   3. reviveCountMax — max(flags[4]) across player units.
//   4. reviveHP — mode of hp values right after a 0 → X transition.
//   5. bandageCount — protocol byte max divided by 5 (one bandage = 5 byte).
//
// Medic gets a sentinel flags[3] = 255 ("infinite" / medical-supply 600HP)
// so we never derive bandage count from medic samples.

import type { UnitClass } from './api';

// ── Public types ─────────────────────────────────────────────────────────

export interface AmmoConfig {
  /** byte max for flags[2] when the magazine is fully loaded (protocol value). */
  rawMax: number;
  /** true total bullets the player sees in-game (e.g. rifle = 300). */
  total: number;
  /** in-game magazine size (e.g. rifle = 30). */
  magSize: number;
  /** weapon ID from DT=7 block byte[2-3], if known. */
  weaponType?: number;
}

export interface GameConfig {
  /** max queue-revive tokens per player (ceiling of flags[4]). */
  reviveCountMax: number;
  /** HP value granted on revive (most common hp after 0→X transitions). */
  reviveHP: number;
  /** number of bandages per non-medic player (derived from flags[3] decay). */
  bandageCount: number;
  /** flags[3] value when bandage stock is full (non-medic; medic uses 255 sentinel). */
  bandageRawMax: number;
  /** per-class ammo configuration. */
  ammo: Record<UnitClass, AmmoConfig>;
  /** true when ammo.total/magSize came from a DT=7 config block (vs preset fallback). */
  ammoSourceFromDB: boolean;
}

// ── Standard preset (截图标准: 步兵 30/300, 医疗 30/150, 机枪 75/300,
// 观察手 10/100, 狙击 5/50). Used as fallback when .db has no DT=7 block. ──

const DEFAULT_AMMO: Record<UnitClass, AmmoConfig> = {
  rifle:    { rawMax: 238, total: 300, magSize: 30 },
  medic:    { rawMax: 238, total: 150, magSize: 30 },
  mg:       { rawMax: 254, total: 300, magSize: 75 },
  marksman: { rawMax: 254, total: 100, magSize: 10 },
  sniper:   { rawMax: 254, total:  50, magSize:  5 },
};

const DEFAULT_CONFIG: GameConfig = {
  reviveCountMax: 2,
  reviveHP: 50,
  bandageCount: 3,
  bandageRawMax: 254,
  ammo: DEFAULT_AMMO,
  ammoSourceFromDB: false,
};

// Class id mapping from flags[1] & 0x07
const CLS_BY_ID: Record<number, UnitClass> = {
  0: 'rifle',
  1: 'mg',
  2: 'marksman',
  3: 'sniper',
  4: 'medic',
};

const CLS_LIST: UnitClass[] = ['rifle', 'mg', 'marksman', 'sniper', 'medic'];

// ── DT=7 ammo-config block (one block per weapon entry, 16 bytes each) ──

export interface AmmoConfigBlock {
  /** insertion index (byte[0]). */
  id: number;
  /** block type — only type=2 carries ammo data. */
  type: number;
  /** weapon ID (byte[2-3] LE): 0x0300 = 突击步枪, 0x0700 = 班用机枪, 0x0101 = 副武器 */
  weaponType: number;
  /** byte[6-7] LE — in-game magazine size. */
  magSize: number;
  /** byte[8-9] LE — total ammo carried. */
  total: number;
  /** byte[10-11] LE — extra slot (medic gets 240 = medical supply marker). */
  extra: number;
}

/** Parse a raw DT=7 blob (longest record per game) into 16-byte ammo blocks. */
export function decodeAmmoConfigBlocks(blob: Uint8Array): AmmoConfigBlock[] {
  const BLOCK_LEN = 16;
  if (!blob || blob.length < BLOCK_LEN) return [];
  const blocks: AmmoConfigBlock[] = [];
  const view = new DataView(blob.buffer, blob.byteOffset, blob.byteLength);
  for (let off = 0; off + BLOCK_LEN <= blob.length; off += BLOCK_LEN) {
    const type = blob[off + 1]!;
    if (type !== 2) continue;
    blocks.push({
      id: blob[off]!,
      type,
      weaponType: view.getUint16(off + 2, true),
      magSize: view.getUint16(off + 6, true),
      total: view.getUint16(off + 8, true),
      extra: view.getUint16(off + 10, true),
    });
  }
  return blocks;
}

// ── Per-unit position scan (single pass, all player units) ──

interface ScanStats {
  // per-class: raw ammo byte samples after refill (+50 jump) and during alive
  postRefillAmmo: Record<UnitClass, number[]>;
  aliveAmmoMax: Record<UnitClass, number>;
  // bandage: per-class distinct values seen
  bandageValues: Record<UnitClass, Set<number>>;
  // revive tokens: max observed across players
  reviveMax: number;
  // revive HP: hp after a 0→X transition
  reviveHPSamples: number[];
}

function emptyStats(): ScanStats {
  const empty = {} as Record<UnitClass, never>;
  const obj = (factory: () => unknown) => {
    const o: Record<string, unknown> = {};
    for (const c of CLS_LIST) o[c] = factory();
    return o as Record<UnitClass, never>;
  };
  return {
    postRefillAmmo: obj(() => []) as Record<UnitClass, number[]>,
    aliveAmmoMax: obj(() => 0) as Record<UnitClass, number>,
    bandageValues: obj(() => new Set<number>()) as Record<UnitClass, Set<number>>,
    reviveMax: 0,
    reviveHPSamples: [],
    ...empty,
  };
}

/**
 * Walk every position frame and accumulate per-class statistics.
 * Iteration is bounded by sql.js (browser) so we use a row-streaming stmt.
 */
function scanPositionFrames(db: {
  prepare(sql: string): {
    step(): boolean;
    get(): unknown[];
    free(): void;
  };
}): ScanStats {
  const stats = emptyStats();
  // Track last-seen state per unit for jump detection
  const prevState = new Map<number, { hp: number; ammo: number; rev: number }>();

  const stmt = db.prepare(`
    SELECT LogData FROM record
    WHERE SrcType=1 AND DataType=1 AND LogData IS NOT NULL
    ORDER BY LogTime
  `);

  while (stmt.step()) {
    const blob = stmt.get()[0] as Uint8Array | null;
    if (!blob || blob.length < 15) continue;
    const n = Math.floor(blob.length / 15);
    for (let i = 0; i < n; i++) {
      const off = i * 15;
      const uid = blob[off]! | (blob[off + 1]! << 8);
      // Skip non-player entities (POIs, vehicles, etc.) — their flag layout differs.
      if (uid >= 700) continue;
      const hp = blob[off + 10]!;
      const clsId = blob[off + 11]! & 0x07;
      const cls = CLS_BY_ID[clsId];
      if (!cls) continue;
      const ammo = blob[off + 12]!;
      const bandage = blob[off + 13]!;
      const rev = blob[off + 14]!;

      const prev = prevState.get(uid);
      prevState.set(uid, { hp, ammo, rev });

      if (hp <= 0) continue; // only alive samples are reliable

      // Track per-class ammo max
      if (ammo > stats.aliveAmmoMax[cls]) stats.aliveAmmoMax[cls] = ammo;

      // Detect refill jump (ammo +50 from previous)
      if (prev && prev.hp > 0 && ammo - prev.ammo >= 50) {
        stats.postRefillAmmo[cls].push(ammo);
      }
      // Revive HP detection: revival burns a token (rev decreases by 1) and
      // the new hp is the "revive HP" config. Filters out fresh respawn at 100
      // (which doesn't burn a token).
      if (prev && prev.rev > 0 && rev === prev.rev - 1 && hp > 0 && hp < 100) {
        stats.reviveHPSamples.push(hp);
      }
      // Bandage value set
      stats.bandageValues[cls].add(bandage);
      // Revive tokens 0-2 range; ignore obvious noise (> 3 means non-player or wrong field)
      if (rev <= 3 && rev > stats.reviveMax) stats.reviveMax = rev;
    }
  }
  stmt.free();
  return stats;
}

// ── Mode helper ──

function mode<T extends number | string>(arr: T[]): T | undefined {
  if (arr.length === 0) return undefined;
  const counts = new Map<T, number>();
  let best: T = arr[0]!;
  let bestN = 0;
  for (const v of arr) {
    const n = (counts.get(v) ?? 0) + 1;
    counts.set(v, n);
    if (n > bestN) { bestN = n; best = v; }
  }
  return best;
}

// ── Bandage protocol: bytes [..240, 244, 249, 254, 255]
// Step size between bandage tiers is ~5 byte. count = (rawMax - lowestNormal) / 5. ──

function inferBandageCount(values: Set<number>): { count: number; rawMax: number } {
  // Filter to typical range [200, 255] — sub-200 entries are death snapshots.
  const high = [...values].filter(v => v >= 200 && v <= 255).sort((a, b) => b - a);
  if (high.length === 0) return { count: 3, rawMax: 254 };
  const rawMax = high[0]!;
  // Skip the 255 sentinel (medic-style "infinite") when computing tiers —
  // non-medic full is 254. If both 254 and 255 are present, anchor on 254.
  let anchor = rawMax;
  if (rawMax === 255 && high.includes(254)) anchor = 254;
  let count = 0;
  let expected = anchor;
  for (const v of high) {
    if (v > anchor) continue; // skip 255 if anchored on 254
    if (Math.abs(v - expected) <= 1) {
      count++;
      expected -= 5;
    } else if (v < expected - 1) {
      break;
    }
  }
  // count includes the "full" state; subtract 1 for usable bandages.
  count -= 1;
  // Fall back to 3 when observed variation is too sparse to be reliable.
  if (count < 3) count = 3;
  return { count, rawMax: anchor };
}

// ── Per-class ammo raw max: prefer post-refill mode, fall back to aliveMax. ──

function inferAmmoRawMax(stats: ScanStats, cls: UnitClass): number {
  const refills = stats.postRefillAmmo[cls];
  if (refills.length >= 3) {
    const m = mode(refills);
    if (m !== undefined) return m;
  }
  const aliveMax = stats.aliveAmmoMax[cls];
  if (aliveMax > 0) return aliveMax;
  return DEFAULT_AMMO[cls].rawMax;
}

// ── Bind DT=7 blocks to classes via "byte rawMax + total ordering" heuristic ──

function bindAmmoBlocks(
  blocks: AmmoConfigBlock[],
  rawMax: Record<UnitClass, number>,
): Record<UnitClass, AmmoConfig> | null {
  if (blocks.length === 0) return null;

  const out: Partial<Record<UnitClass, AmmoConfig>> = {};

  // Group blocks by weapon type. Within each group, sort by total ascending —
  // medic (low total) before rifle (high total) for the same weapon.
  const byWeapon = new Map<number, AmmoConfigBlock[]>();
  for (const b of blocks) {
    if (b.total === 0) continue; // sidearm / empty slots
    const list = byWeapon.get(b.weaponType) ?? [];
    list.push(b);
    byWeapon.set(b.weaponType, list);
  }

  // Heuristic mapping:
  //  - 0x0300 weapon, smallest total → medic (extra=240 medical-supply marker confirms)
  //  - 0x0300 weapon, largest total → rifle
  //  - 0x0300 weapon, mag=5 total<=60 → sniper
  //  - 0x0700 weapon (班用机枪) → mg or marksman (disambiguate by mag size)
  for (const [wt, list] of byWeapon) {
    list.sort((a, b) => a.total - b.total);
    if (wt === 0x0300) {
      // smallest mag (=5) → sniper
      const sniperBlock = list.find(b => b.magSize === 5);
      if (sniperBlock) out.sniper = { rawMax: rawMax.sniper, total: sniperBlock.total, magSize: sniperBlock.magSize, weaponType: wt };
      // rifle-class assault rifles (mag=30)
      const assaults = list.filter(b => b.magSize === 30);
      if (assaults.length === 1) {
        // Single AR — could be either rifle or medic; pick by extra=240
        const b = assaults[0]!;
        if (b.extra === 240) out.medic = { rawMax: rawMax.medic, total: b.total, magSize: b.magSize, weaponType: wt };
        else out.rifle = { rawMax: rawMax.rifle, total: b.total, magSize: b.magSize, weaponType: wt };
      } else if (assaults.length >= 2) {
        // Two ARs — smaller total = medic, larger = rifle
        out.medic = { rawMax: rawMax.medic, total: assaults[0]!.total, magSize: assaults[0]!.magSize, weaponType: wt };
        out.rifle = { rawMax: rawMax.rifle, total: assaults[assaults.length - 1]!.total, magSize: assaults[assaults.length - 1]!.magSize, weaponType: wt };
      }
    } else if (wt === 0x0700) {
      // 班用机枪 — could be mg (mag=75) or marksman (mag=10/15)
      for (const b of list) {
        if (b.magSize >= 50) out.mg = { rawMax: rawMax.mg, total: b.total, magSize: b.magSize, weaponType: wt };
        else out.marksman = { rawMax: rawMax.marksman, total: b.total, magSize: b.magSize, weaponType: wt };
      }
    }
  }

  // Fill any unbound class with the default preset.
  const result: Record<UnitClass, AmmoConfig> = { ...DEFAULT_AMMO };
  let boundAny = false;
  for (const c of CLS_LIST) {
    if (out[c]) {
      result[c] = { ...out[c]!, rawMax: rawMax[c] };
      boundAny = true;
    } else {
      result[c] = { ...DEFAULT_AMMO[c], rawMax: rawMax[c] };
    }
  }
  return boundAny ? result : null;
}

// ── Top-level inference ──

/**
 * Scan the .db once and produce a full GameConfig.
 * Falls back to standard preset for any field that can't be inferred.
 */
export function inferGameConfig(
  db: { prepare(sql: string): { step(): boolean; get(): unknown[]; free(): void } },
  ammoBlocks: AmmoConfigBlock[],
): GameConfig {
  const stats = scanPositionFrames(db);

  // Per-class raw ammo max
  const rawMax: Record<UnitClass, number> = {
    rifle:    inferAmmoRawMax(stats, 'rifle'),
    medic:    inferAmmoRawMax(stats, 'medic'),
    mg:       inferAmmoRawMax(stats, 'mg'),
    marksman: inferAmmoRawMax(stats, 'marksman'),
    sniper:   inferAmmoRawMax(stats, 'sniper'),
  };

  // Ammo total + magSize (DT=7 blocks if any, else preset)
  const bound = bindAmmoBlocks(ammoBlocks, rawMax);
  const ammo: Record<UnitClass, AmmoConfig> = bound ?? {
    rifle:    { ...DEFAULT_AMMO.rifle,    rawMax: rawMax.rifle },
    medic:    { ...DEFAULT_AMMO.medic,    rawMax: rawMax.medic },
    mg:       { ...DEFAULT_AMMO.mg,       rawMax: rawMax.mg },
    marksman: { ...DEFAULT_AMMO.marksman, rawMax: rawMax.marksman },
    sniper:   { ...DEFAULT_AMMO.sniper,   rawMax: rawMax.sniper },
  };

  // Bandage — use the union of non-medic class values
  const allBandage = new Set<number>();
  for (const c of CLS_LIST) {
    if (c === 'medic') continue;
    for (const v of stats.bandageValues[c]) allBandage.add(v);
  }
  const { count: bandageCount, rawMax: bandageRawMax } = inferBandageCount(allBandage);

  // Revive HP — mode of post-revival hp samples
  const reviveHP = stats.reviveHPSamples.length >= 3
    ? (mode(stats.reviveHPSamples) ?? DEFAULT_CONFIG.reviveHP)
    : DEFAULT_CONFIG.reviveHP;

  return {
    reviveCountMax: stats.reviveMax > 0 ? stats.reviveMax : DEFAULT_CONFIG.reviveCountMax,
    reviveHP,
    bandageCount,
    bandageRawMax,
    ammo,
    ammoSourceFromDB: bound !== null,
  };
}

/** Synthesize a default GameConfig when no .db is available (UI fallback). */
export function defaultGameConfig(): GameConfig {
  return {
    ...DEFAULT_CONFIG,
    ammo: { ...DEFAULT_AMMO },
  };
}

// ── Public display helpers ────────────────────────────────────────────────

export interface AmmoInfo {
  /** estimated current bullets (raw / rawMax × total). */
  bullets: number;
  /** total bullets when full. */
  total: number;
  /** in-game magazine size. */
  magSize: number;
  /** 0–100 percentage. */
  percent: number;
}

/**
 * Convert the raw flags[2] byte into a real bullet count.
 *
 * Empirically every shot decrements `raw` by 1 (1:1 byte ↔ bullet). When the
 * weapon's total carry is smaller than the byte's max value (e.g. sniper:
 * total 50 vs rawMax 254), the byte starts at `rawMax` and the "empty" point
 * is `rawMax - total`. A linear scale would round-drop and cause the UI to
 * appear stuck at 49/50 (the bug). The offset model below preserves the
 * 1:1 relationship the user observes in-game.
 *
 * When `total > rawMax` (e.g. rifle card says 300 but byte caps at 238),
 * we cap displayed bullets at `total` so the bar still shows a 0..total range,
 * even though it can only reach `rawMax` at full.
 */
export function ammoInfo(raw: number, cls: UnitClass, cfg: GameConfig): AmmoInfo {
  const c = cfg.ammo[cls];
  // Byte value at which real bullets = 0.
  const emptyByte = Math.max(0, c.rawMax - c.total);
  // 1:1 mapping: each byte unit above emptyByte = 1 bullet.
  const bullets = Math.max(0, Math.min(c.total, raw - emptyByte));
  return {
    bullets,
    total: c.total,
    magSize: c.magSize,
    percent: c.total > 0 ? Math.round((bullets / c.total) * 100) : 0,
  };
}

/**
 * Convert flags[3] raw byte into a bandage count.
 * Returns -1 to signal "infinite" (medic gets 600HP medical supply, byte=255).
 */
export function bandageCount(raw: number, cls: UnitClass, cfg: GameConfig): number {
  if (cls === 'medic') return -1; // ∞
  if (raw <= 0) return 0;
  // Quantize: full=rawMax → bandageCount; each used = -5
  // Tier i (i = bandageCount, bandageCount-1, ..., 0) corresponds to byte ≥ rawMax - 5*i + 1
  // Equivalently: idx = floor((rawMax - raw) / 5), count = max(0, bandageCount - idx)
  const used = Math.floor((cfg.bandageRawMax - raw) / 5);
  return Math.max(0, Math.min(cfg.bandageCount, cfg.bandageCount - used));
}
