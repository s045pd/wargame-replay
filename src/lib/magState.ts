// ── Magazine state tracker ──────────────────────────────────────────────
//
// The recording protocol only stores total remaining bullets (flags[2] byte),
// not a separate "current magazine" field. But real-world reload mechanics
// discard the partial mag on each reload, which IS reflected in the byte
// stream as periodic large drops between sample frames (e.g. rifle drops of
// 16/32/48 — not pure firing).
//
// This per-unit state machine reconstructs a plausible "current magazine /
// reserve" split by simulating the byte stream forward:
//
//   byte ↓ 1   → fire 1 bullet (currentMag -= 1; auto-reload if empty)
//   byte ↓ N   → fire N bullets (each handled through auto-reload boundary)
//   byte ↑     → supply / revival: re-fill (currentMag = full, rest in reserve)
//   force-sync → after each update, ensure currentMag + reserve = totalBullets
//                (this is how reload-discard events get absorbed: when byte
//                dropped more than the simulated firing predicted, the "lost"
//                bullets are subtracted from reserve, matching real-world
//                "discarded partial mag goes into ammo box that's been used up")
//
// The reconstruction is approximate — without a real reload-event signal we
// can't perfectly time when a reload-discard happened — but the resulting
// `currentMag` value stays in [0, magSize] and total = byte-derived bullets
// at all times.

import type { UnitClass } from './api';
import type { GameConfig } from './gameConfig';

export interface MagState {
  /** Bullets currently in the chambered magazine (0..magSize). */
  currentMag: number;
  /** Bullets carried in reserve mags (total - currentMag). */
  reserve: number;
  /** Sum of currentMag + reserve (== bullets derived from byte). */
  total: number;
  /** Magazine capacity for this class (game-card value). */
  magSize: number;
}

interface Tracker {
  /** Last seen raw flags[2] byte value. */
  prevByte: number;
  state: MagState;
}

function deriveBullets(rawByte: number, cls: UnitClass, cfg: GameConfig): number {
  const c = cfg.ammo[cls];
  const empty = Math.max(0, c.rawMax - c.total);
  return Math.max(0, Math.min(c.total, rawByte - empty));
}

function initialState(bullets: number, magSize: number): MagState {
  const currentMag = Math.min(magSize, bullets);
  const reserve = Math.max(0, bullets - currentMag);
  return { currentMag, reserve, total: bullets, magSize };
}

/**
 * Service maintaining one Tracker per unit. Caller must reset() on seek
 * (because the state machine is forward-only) and dispose() on game change.
 */
export class MagStateService {
  private trackers = new Map<number, Tracker>();

  /**
   * Apply one position-frame observation for a unit. Returns the updated
   * magazine state. Idempotent for the same byte value.
   */
  update(unitId: number, rawByte: number, cls: UnitClass, cfg: GameConfig): MagState {
    const bullets = deriveBullets(rawByte, cls, cfg);
    const magSize = cfg.ammo[cls].magSize;

    let tracker = this.trackers.get(unitId);
    if (!tracker) {
      tracker = { prevByte: rawByte, state: initialState(bullets, magSize) };
      this.trackers.set(unitId, tracker);
      return tracker.state;
    }

    const delta = rawByte - tracker.prevByte;
    tracker.prevByte = rawByte;

    if (delta === 0) {
      // byte unchanged but mag-size could have changed (config swap) — keep state in sync.
      tracker.state = this.forceSync(tracker.state, bullets, magSize);
      return tracker.state;
    }

    if (delta > 0) {
      // Supply pickup or revival: assume player gets a full chambered mag.
      tracker.state = initialState(bullets, magSize);
      return tracker.state;
    }

    // delta < 0 → bullets consumed (firing + possibly reload-discard).
    let shotsRemaining = -delta;
    while (shotsRemaining > 0 && (tracker.state.currentMag > 0 || tracker.state.reserve > 0)) {
      if (tracker.state.currentMag > 0) {
        tracker.state.currentMag -= 1;
      } else {
        // Auto-reload from reserve.
        const newMag = Math.min(magSize, tracker.state.reserve);
        tracker.state.currentMag = newMag;
        tracker.state.reserve -= newMag;
        if (tracker.state.currentMag > 0) tracker.state.currentMag -= 1;
        else break; // truly out of ammo
      }
      shotsRemaining -= 1;
    }

    tracker.state = this.forceSync(tracker.state, bullets, magSize);
    return tracker.state;
  }

  /**
   * Ensure currentMag + reserve = bullets (byte-derived ground truth).
   * If the simulation under-shot (rare), pad reserve. If it over-shot (because
   * the actual byte drop included a reload-discard we didn't model), trim
   * reserve first, then currentMag.
   */
  private forceSync(state: MagState, bullets: number, magSize: number): MagState {
    const computed = state.currentMag + state.reserve;
    if (computed === bullets) {
      return { ...state, total: bullets, magSize };
    }
    if (computed < bullets) {
      // Add the surplus to reserve (supply we didn't catch as a +delta).
      return {
        currentMag: state.currentMag,
        reserve: state.reserve + (bullets - computed),
        total: bullets,
        magSize,
      };
    }
    // Over-shot: byte dropped faster than our shot simulation. The excess is
    // most likely a reload-discard event — bullets that were in the previous
    // mag and were thrown away. Subtract from reserve first (those were the
    // "rest of the reload-discarded mag"), then trim currentMag.
    let surplus = computed - bullets;
    const newReserve = Math.max(0, state.reserve - surplus);
    surplus -= state.reserve - newReserve;
    const newMag = Math.max(0, state.currentMag - surplus);
    return { currentMag: newMag, reserve: newReserve, total: bullets, magSize };
  }

  /** Get the current state for a unit without updating (returns null if untracked). */
  peek(unitId: number): MagState | null {
    return this.trackers.get(unitId)?.state ?? null;
  }

  /** Clear all trackers — call this on seek or game change. */
  reset(): void {
    this.trackers.clear();
  }
}

// ── Public display helper ───────────────────────────────────────────────

export interface MagDisplay {
  /** "30 / 270" style string. -1 reserve / undefined mag means no estimate. */
  text: string;
  currentMag: number;
  reserve: number;
}

export function formatMag(state: MagState | null | undefined): MagDisplay {
  if (!state) return { text: '—', currentMag: 0, reserve: 0 };
  return {
    text: `${state.currentMag} / ${state.reserve}`,
    currentMag: state.currentMag,
    reserve: state.reserve,
  };
}

// ── Module-level singleton (one tracker shared across the playback session) ──

let _singleton: MagStateService | null = null;

export function getMagStateService(): MagStateService {
  if (!_singleton) _singleton = new MagStateService();
  return _singleton;
}

export function resetMagStateService(): void {
  if (_singleton) _singleton.reset();
}
