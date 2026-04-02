import { useEffect, useRef, useCallback, useMemo } from 'react';
import { usePlayback } from '../store/playback';
import { useDirector } from '../store/director';
import { useHotspotFilter } from '../store/hotspotFilter';
import type { HotspotEvent } from '../lib/api';

/** Pre-parsed hotspot with cached timestamps to avoid repeated Date parsing in hot loops */
interface ParsedHotspot {
  hs: HotspotEvent;
  startMs: number;
  endMs: number;
  isPersonal: boolean;
}

// ─── Tuning constants ───────────────────────────────────────────────────────

/** Minimum real-time milliseconds between camera switches */
const SWITCH_COOLDOWN_MS = 6000;
/** Random jitter added to cooldown (± this fraction) */
const COOLDOWN_JITTER = 0.3;

/** Seconds before a hotspot starts to begin pre-tracking the focus unit */
const PRE_TRACK_SECONDS = 8;

// Slowdown settings are read from the playback store (user-configurable)

// ─── Helpers ────────────────────────────────────────────────────────────────

function parseTs(ts: string): number {
  return new Date(ts.replace(' ', 'T')).getTime();
}

/** Format a millisecond game timestamp back to an ISO-style string for seek() */
function msToTs(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/** Is this hotspot type a "personal" type that should get focus mode? */
function isPersonalType(hs: HotspotEvent): boolean {
  return (hs.type === 'killstreak' || hs.type === 'long_range') && !!hs.focusUnitId;
}

/** Is this hotspot type a "critical" type that must be shown (bypasses cooldown, gets seek-back + lock)? */
function isCriticalType(hs: HotspotEvent): boolean {
  return isPersonalType(hs) || hs.type === 'bombardment';
}

/**
 * Convert a radius in metres to an appropriate Mapbox zoom level.
 * For personal hotspots we zoom in tighter.
 */
function radiusToZoom(radiusM: number, personal: boolean): number {
  const targetPx = personal ? 200 : 350;
  const z = 20 - Math.log2(Math.max(radiusM, 20) / (targetPx * 0.075));
  return Math.max(14, Math.min(20, z));
}

/**
 * Weighted random pick from an array.
 * Weight = score^1.5 so higher scores are favoured but not deterministic.
 */
function weightedRandomPick(items: HotspotEvent[]): HotspotEvent {
  if (items.length === 1) return items[0];
  const weights = items.map((h) => Math.pow(h.score, 1.5));
  const total = weights.reduce((a, b) => a + b, 0);
  let r = Math.random() * total;
  for (let i = 0; i < items.length; i++) {
    r -= weights[i];
    if (r <= 0) return items[i];
  }
  return items[items.length - 1];
}

/** Cooldown with random jitter so the same speed doesn't always hit the same moments */
function jitteredCooldown(): number {
  return SWITCH_COOLDOWN_MS * (1 + (Math.random() * 2 - 1) * COOLDOWN_JITTER);
}

// ─── Hook ───────────────────────────────────────────────────────────────────

/**
 * Auto-director hook.  Flies the camera to active hotspot events, activates
 * focus mode for personal hotspots (killstreak / long_range), slows playback,
 * and provides natural variation so each viewing feels different.
 *
 * Key behaviours:
 *  - Manual follow override: if user manually follows a unit, director is fully paused
 *  - Personal hotspot lock: once entered, director seeks to event start and locks
 *    switching until the event's end timestamp is reached (game-time lock)
 *  - Personal hotspots ALWAYS use focus mode (dark map, dimmed background units)
 */
export function useHotspotDirector() {
  // ── Reactive values (gate effect execution) ──
  const { allHotspots: hotspots, currentTs, playing, coordMode, speed } = usePlayback();
  const { autoMode } = useDirector();
  const { typeFilters } = useHotspotFilter();

  // ── Pre-compute parsed timestamps + filters ──
  const parsedHotspots = useMemo(() => {
    const result: ParsedHotspot[] = [];
    for (const hs of hotspots) {
      if (!typeFilters[hs.type as keyof typeof typeFilters]) continue;
      result.push({
        hs,
        startMs: parseTs(hs.startTs),
        endMs: parseTs(hs.endTs),
        isPersonal: isPersonalType(hs),
      });
    }
    return result;
  }, [hotspots, typeFilters]);

  // ── Refs (local tracking state, invisible to React) ──
  const lastHotspotIdRef = useRef<number | null>(null);
  const preTrackingIdRef = useRef<number | null>(null);
  const followingUnitRef = useRef<number | null>(null);
  const cooldownRef = useRef<number>(SWITCH_COOLDOWN_MS);
  /** Game-time lock: while curMs < this value, switching is forbidden (personal hotspot playback) */
  const lockUntilGameMsRef = useRef<number>(0);
  /** The hotspot ID we are currently locked to */
  const lockedHotspotIdRef = useRef<number | null>(null);
  /** Track last observed speed to detect manual user speed changes */
  const prevSpeedRef = useRef<number>(usePlayback.getState().speed);

  // ── Full cleanup: exit focus + restore speed + clear follow + clear refs ──
  const fullCleanup = useCallback(() => {
    const dir = useDirector.getState();
    dir.restoreSpeed();
    dir.exitFocusMode();
    dir.setActiveHotspotId(null);
    dir.setHotspotScore(0);
    dir.setSwitchLocked(false);

    const pb = usePlayback.getState();
    // Don't touch the user's manual follow state — only clear director-initiated follow
    if (!pb.manualFollow && followingUnitRef.current !== null) {
      pb.setFollowSelectedUnit(false);
      pb.setSelectedUnitId(null);
    }
    followingUnitRef.current = null;

    lastHotspotIdRef.current = null;
    preTrackingIdRef.current = null;
    lockUntilGameMsRef.current = 0;
    lockedHotspotIdRef.current = null;
  }, []);

  // ── Speed-change detection (reacts to reactive `speed` from store) ──
  useEffect(() => {
    if (prevSpeedRef.current !== speed) {
      prevSpeedRef.current = speed;
      if (useDirector.getState().slowdown.active) return;
      if (followingUnitRef.current !== null) return;
      lastHotspotIdRef.current = null;
      preTrackingIdRef.current = null;
      cooldownRef.current = jitteredCooldown();
    }
  }, [speed]);

  // ── Main director loop ──
  useEffect(() => {
    // ── Guard: not active ──
    if (!autoMode || !playing || !currentTs) {
      fullCleanup();
      return;
    }

    // ── Manual follow override ──
    // If the user manually followed a unit, the director does NOT interfere at all.
    const pb = usePlayback.getState();
    if (pb.manualFollow) {
      // Clean up any director-owned state (focus mode, slowdown, lock) without
      // touching the user's follow/selection. This ensures a clean transition
      // when the user eventually unfollows.
      const dir = useDirector.getState();
      if (dir.slowdown.active) dir.restoreSpeed();
      if (dir.focusMode.active) dir.exitFocusMode();
      if (dir.switchLocked) dir.setSwitchLocked(false);
      if (dir.activeHotspotId !== null) dir.setActiveHotspotId(null);
      dir.setHotspotScore(0);
      followingUnitRef.current = null;
      lastHotspotIdRef.current = null;
      preTrackingIdRef.current = null;
      lockUntilGameMsRef.current = 0;
      lockedHotspotIdRef.current = null;
      return;
    }

    const curMs = parseTs(currentTs);
    const dir = useDirector.getState();

    // ═══════════════════════════════════════════════════════════════════
    //  Game-time lock check — critical hotspots (personal + bombardment)
    //  must play from start to end.  While locked, no switching allowed.
    // ═══════════════════════════════════════════════════════════════════
    if (lockUntilGameMsRef.current > 0) {
      if (curMs < lockUntilGameMsRef.current) {
        // Still within the locked hotspot — update score display and return
        const lockedPh = parsedHotspots.find(ph => ph.hs.id === lockedHotspotIdRef.current);
        if (lockedPh) {
          dir.setHotspotScore(Math.min(1, lockedPh.hs.score / 200));
          dir.setActiveHotspotId(lockedPh.hs.id);
        }
        return;
      }
      // Lock expired — clean up focus mode and fall through to fresh selection
      // Keep the expired hotspot's ID to prevent immediate re-selection
      lastHotspotIdRef.current = lockedHotspotIdRef.current;
      lockUntilGameMsRef.current = 0;
      lockedHotspotIdRef.current = null;
      dir.setSwitchLocked(false);
      dir.exitFocusMode();
      dir.restoreSpeed();
      if (followingUnitRef.current !== null) {
        pb.setFollowSelectedUnit(false);
        followingUnitRef.current = null;
      }
      pb.setSelectedUnitId(null);
      // Fall through to fresh selection ↓
    }

    // ═══════════════════════════════════════════════════════════════════
    //  Phase 1 — Pre-tracking (look ahead for upcoming personal hotspots)
    // ═══════════════════════════════════════════════════════════════════
    let preTrackTarget: HotspotEvent | null = null;
    for (const ph of parsedHotspots) {
      if (!ph.isPersonal) continue;
      const preTrackStart = ph.startMs - PRE_TRACK_SECONDS * 1000;
      if (curMs >= preTrackStart && curMs < ph.startMs) {
        if (!preTrackTarget || ph.hs.score > preTrackTarget.score) {
          preTrackTarget = ph.hs;
        }
      }
    }

    if (preTrackTarget && preTrackTarget.id !== preTrackingIdRef.current) {
      const now = Date.now();
      if (now - dir.lastSwitchTime >= cooldownRef.current) {
        preTrackingIdRef.current = preTrackTarget.id;
        followingUnitRef.current = preTrackTarget.focusUnitId!;
        pb.setSelectedUnitId(preTrackTarget.focusUnitId!);
        pb.setFollowSelectedUnit(true);
        dir.recordSwitch();
        cooldownRef.current = jitteredCooldown();
      }
    }

    // ═══════════════════════════════════════════════════════════════════
    //  Phase 2 — Collect currently-active hotspots
    // ═══════════════════════════════════════════════════════════════════
    const active: HotspotEvent[] = [];
    for (const ph of parsedHotspots) {
      if (curMs >= ph.startMs && curMs <= ph.endMs) {
        active.push(ph.hs);
      }
    }

    // ── Nothing active ──
    if (active.length === 0) {
      if (preTrackingIdRef.current !== null) return; // still pre-tracking
      fullCleanup();
      return;
    }

    // ═══════════════════════════════════════════════════════════════════
    //  Phase 3 — Focus-mode hard lock (legacy non-lock personal hotspots)
    //  If focus mode is active but no game-time lock (shouldn't normally happen
    //  after the refactor, but kept as safety net), stay locked to the personal
    //  hotspot while it's still active.
    // ═══════════════════════════════════════════════════════════════════
    if (dir.focusMode.active) {
      const lockedHs = active.find(
        (hs) => isPersonalType(hs) && hs.focusUnitId === dir.focusMode.focusUnitId,
      );
      if (lockedHs) {
        lastHotspotIdRef.current = lockedHs.id;
        dir.setActiveHotspotId(lockedHs.id);
        dir.setHotspotScore(Math.min(1, lockedHs.score / 200));
        return;
      }
      // Hotspot ended — clean exit before new selection
      dir.exitFocusMode();
      dir.restoreSpeed();
      if (followingUnitRef.current !== null) {
        pb.setFollowSelectedUnit(false);
        followingUnitRef.current = null;
      }
      lastHotspotIdRef.current = null;
      // Fall through to fresh selection ↓
    }

    // ═══════════════════════════════════════════════════════════════════
    //  Phase 4 — Select the "best" hotspot to track
    //
    //  Priority:
    //    1. Current hotspot still active & critical → stay (locked above)
    //    2. Current hotspot still active & non-critical → stay
    //    3. Any active critical hotspot → switch (always takes priority)
    //    4. Multiple non-critical → weighted random pick (adds variety)
    //
    //  "Critical" = personal (killstreak/long_range) OR bombardment
    // ═══════════════════════════════════════════════════════════════════
    const currentStillActive = lastHotspotIdRef.current !== null
      ? active.find((hs) => hs.id === lastHotspotIdRef.current)
      : null;

    const activeCritical = active.filter(isCriticalType);

    let best: HotspotEvent;
    if (currentStillActive) {
      if (activeCritical.length > 0 && !isCriticalType(currentStillActive)) {
        // A critical hotspot appeared while we're on a non-critical one → switch
        best = weightedRandomPick(activeCritical);
      } else if (activeCritical.length > 0 && isCriticalType(currentStillActive)) {
        // Already on a critical hotspot → stay
        best = currentStillActive;
      } else {
        best = currentStillActive;
      }
    } else if (activeCritical.length > 0) {
      best = weightedRandomPick(activeCritical);
    } else {
      best = weightedRandomPick(active);
    }

    // Update score display
    dir.setHotspotScore(Math.min(1, best.score / 200));
    dir.setActiveHotspotId(best.id);

    // Already tracking this exact hotspot — no switch needed
    if (best.id === lastHotspotIdRef.current) return;

    // Cooldown check — critical hotspots (personal + bombardment) BYPASS cooldown.
    const now = Date.now();
    const critical = isCriticalType(best);
    if (!critical && now - dir.lastSwitchTime < cooldownRef.current) return;

    // ═══════════════════════════════════════════════════════════════════
    //  Phase 5 — Execute the camera switch
    // ═══════════════════════════════════════════════════════════════════
    lastHotspotIdRef.current = best.id;
    preTrackingIdRef.current = null;
    cooldownRef.current = jitteredCooldown();

    const isPersonal = isPersonalType(best);
    const hsZoom = best.radius > 0
      ? radiusToZoom(best.radius, isPersonal || best.type === 'bombardment')
      : (isPersonal ? 19 : 17);

    // ── Personal hotspot (killstreak / long_range) — focus mode + game-time lock ──
    if (isPersonal) {
      const ph = parsedHotspots.find(p => p.hs.id === best.id);
      if (ph) {
        if (curMs > ph.startMs) {
          pb.seek(msToTs(ph.startMs));
        }
        lockUntilGameMsRef.current = ph.endMs;
        lockedHotspotIdRef.current = best.id;
        dir.setSwitchLocked(true);
      }

      dir.setFollowZoom(hsZoom);
      pb.setSelectedUnitId(best.focusUnitId!);
      pb.setFollowSelectedUnit(true);
      followingUnitRef.current = best.focusUnitId!;

      // Slowdown: configurable per type from user settings
      const { killstreakSlowDiv, longRangeSlowSpeed } = pb;
      const { slowdown } = dir;
      const baseSpeed = slowdown.active && slowdown.originalSpeed !== null
        ? slowdown.originalSpeed
        : pb.speed;
      let slowSpeed: number;
      if (best.type === 'long_range') {
        slowSpeed = longRangeSlowSpeed > 0 ? longRangeSlowSpeed : baseSpeed;
      } else {
        slowSpeed = killstreakSlowDiv > 0 ? Math.max(1, Math.round(baseSpeed / killstreakSlowDiv)) : baseSpeed;
      }
      if (slowSpeed < baseSpeed) {
        dir.activateSlowdown(slowSpeed);
      }

      // Activate focus mode
      const { mapStyle } = pb;
      const relatedIds = (best.units || []).filter((id) => id !== best.focusUnitId);
      dir.activateFocusMode(best.focusUnitId!, relatedIds, mapStyle);
      if (dir.focusDarkMap && mapStyle !== 'dark') {
        pb.setMapStyle('dark');
      }

      dir.recordSwitch();
      return;
    }

    // ── Bombardment — critical non-personal: seek-back + lock + fly to center ──
    if (best.type === 'bombardment') {
      const ph = parsedHotspots.find(p => p.hs.id === best.id);
      if (ph) {
        if (curMs > ph.startMs) {
          pb.seek(msToTs(ph.startMs));
        }
        lockUntilGameMsRef.current = ph.endMs;
        lockedHotspotIdRef.current = best.id;
        dir.setSwitchLocked(true);
      }

      // Clear follow state — bombardment is map-centered, not unit-focused
      dir.setFollowZoom(null);
      if (followingUnitRef.current !== null) {
        pb.setFollowSelectedUnit(false);
        followingUnitRef.current = null;
      }
      pb.setSelectedUnitId(null);
      dir.exitFocusMode();

      // Slowdown for bombardment: configurable divisor
      const { bombardSlowDiv } = pb;
      const { slowdown: bombSlowdown } = dir;
      const bombBaseSpeed = bombSlowdown.active && bombSlowdown.originalSpeed !== null
        ? bombSlowdown.originalSpeed
        : pb.speed;
      const bombSlowSpeed = bombardSlowDiv > 0 ? Math.max(1, Math.round(bombBaseSpeed / bombardSlowDiv)) : bombBaseSpeed;
      if (bombSlowSpeed < bombBaseSpeed) {
        dir.activateSlowdown(bombSlowSpeed);
      }

      if (best.centerLat !== 0 || best.centerLng !== 0) {
        if (coordMode === 'wgs84') {
          dir.setTargetCamera({ lat: best.centerLat, lng: best.centerLng, zoom: hsZoom });
        } else {
          dir.setTargetCamera({ x: best.centerLng, y: best.centerLat, zoom: 8 });
        }
      }

      dir.recordSwitch();
      return;
    }

    // ── Non-critical hotspot — fly to center ──
    dir.setFollowZoom(null);
    if (followingUnitRef.current !== null) {
      pb.setFollowSelectedUnit(false);
      followingUnitRef.current = null;
    }
    pb.setSelectedUnitId(null);
    dir.restoreSpeed();
    dir.exitFocusMode();

    if (best.centerLat === 0 && best.centerLng === 0) return;

    if (coordMode === 'wgs84') {
      dir.setTargetCamera({ lat: best.centerLat, lng: best.centerLng, zoom: hsZoom });
    } else {
      dir.setTargetCamera({ x: best.centerLng, y: best.centerLat, zoom: 8 });
    }
    dir.recordSwitch();
  }, [autoMode, playing, currentTs, parsedHotspots, coordMode, fullCleanup]);
}
