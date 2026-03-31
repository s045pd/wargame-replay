import { useEffect, useRef } from 'react';
import { usePlayback } from '../store/playback';
import { useDirector } from '../store/director';
import { useHotspotFilter } from '../store/hotspotFilter';
import type { MapStyleKey } from '../map/styles';
import type { HotspotEvent } from '../lib/api';

/** Minimum real-time milliseconds between camera switches */
const SWITCH_COOLDOWN_MS = 6000;

/** Seconds before a hotspot starts to begin pre-tracking the focus unit */
const PRE_TRACK_SECONDS = 8;

/** Killstreak slowdown divisor: speed becomes speed/8 (min 1x) */
const KILLSTREAK_DIVISOR = 8;

function parseTs(ts: string): number {
  return new Date(ts.replace(' ', 'T')).getTime();
}

/**
 * Convert a radius in metres to an appropriate Mapbox zoom level.
 * At zoom 20 ≈ 0.075m/px. Each zoom level halves the metres/pixel.
 * We want the radius to fit in ~1/3 of the viewport (~300px on a 900px map).
 *
 * For killstreak (personal), we add extra zoom (+1) so the camera is closer.
 */
function radiusToZoom(radiusM: number, personal: boolean): number {
  // metres per pixel at zoom 20 ≈ 0.075 at mid-latitudes
  // At zoom z: mpp = 0.075 * 2^(20 - z)
  // We want radius to span ~300 pixels: radius = 300 * mpp
  // → 300 * 0.075 * 2^(20-z) = radius
  // → 2^(20-z) = radius / 22.5
  // → z = 20 - log2(radius / 22.5)
  const targetPx = personal ? 200 : 350; // personal = tighter frame
  const z = 20 - Math.log2(Math.max(radiusM, 20) / (targetPx * 0.075));
  return Math.max(14, Math.min(20, z));
}

/**
 * Hook that automatically flies the camera to the highest-scoring active
 * hotspot event.  Works in both replay and director modes.
 *
 * Features:
 * - Computes dynamic bounding box from alive involved units for zoom-to-fit
 * - For killstreak events: frames killer + alive victims (activity circle camera)
 *   with continuous per-frame tracking of the centroid
 * - For non-personal events: clears unit selection, flies to hotspot center/bounds
 * - Pre-tracks the focus unit several seconds before killstreak starts
 * - Slows down playback speed during killstreak events for better viewing
 * - Respects hotspot type filters from the filter store
 * - Shows activity circle overlay for tracked hotspot
 *
 * Activated when `autoMode` is true in the director store.
 */
export function useHotspotDirector() {
  const {
    allHotspots: hotspots,
    currentTs,
    playing,
    coordMode,
    speed,
    units,
    setSelectedUnitId,
    setFollowSelectedUnit,
    setSpeed,
  } = usePlayback();
  const {
    autoMode,
    lastSwitchTime,
    setTargetCamera,
    setHotspotScore,
    recordSwitch,
    setActiveHotspotId,
    activateFocusMode,
    deactivateFocusMode,
  } = useDirector();
  const { typeFilters } = useHotspotFilter();

  /** Exit focus mode and restore the previous map style */
  const exitFocusMode = () => {
    const fm = useDirector.getState().focusMode;
    if (!fm.active) return;
    deactivateFocusMode();
    if (fm.previousMapStyle) {
      usePlayback.getState().setMapStyle(fm.previousMapStyle as MapStyleKey);
    }
  };

  const lastHotspotIdRef = useRef<number | null>(null);
  const preTrackingIdRef = useRef<number | null>(null); // hotspot ID we're pre-tracking for
  const followingUnitRef = useRef<number | null>(null); // unit ID we set follow on
  const originalSpeedRef = useRef<number | null>(null); // speed before killstreak slowdown
  const slowdownActiveRef = useRef(false); // whether we currently have a slowdown active
  const prevSpeedRef = useRef<number>(speed);

  // --- Speed change detection: reset tracking so hotspots are re-evaluated ---
  // Exception: don't reset during killstreak auto-follow (slowdownActive means
  // the speed change was initiated by our own killstreak slowdown, not the user).
  useEffect(() => {
    if (prevSpeedRef.current !== speed) {
      prevSpeedRef.current = speed;
      // If the slowdown is active, this speed change was caused by our own
      // killstreak logic (or restoring from it) — don't reset.
      if (slowdownActiveRef.current) return;
      // If we're following a unit for a killstreak, don't reset either.
      if (followingUnitRef.current !== null) return;
      // User-initiated speed change → reset tracking so the director re-evaluates
      lastHotspotIdRef.current = null;
      preTrackingIdRef.current = null;
    }
  }, [speed]);

  useEffect(() => {
    if (!autoMode || !playing || !currentTs) {
      // Reset tracking when not active
      if (!autoMode) {
        lastHotspotIdRef.current = null;
        preTrackingIdRef.current = null;
        setActiveHotspotId(null);
        // Stop following if we started it
        if (followingUnitRef.current !== null) {
          setFollowSelectedUnit(false);
          followingUnitRef.current = null;
        }
        // Restore speed if we slowed it down
        if (slowdownActiveRef.current && originalSpeedRef.current !== null) {
          setSpeed(originalSpeedRef.current);
          originalSpeedRef.current = null;
          slowdownActiveRef.current = false;
        }
        // Exit focus mode
        exitFocusMode();
        setHotspotScore(0);
      }
      return;
    }

    const curMs = parseTs(currentTs);

    // Filter hotspots by enabled types
    const filtered = hotspots.filter((hs) => typeFilters[hs.type as keyof typeof typeFilters]);

    // --- Phase 1: Check for pre-tracking opportunities ---
    // Look for upcoming killstreak events with focusUnitId that start within PRE_TRACK_SECONDS
    let preTrackTarget: HotspotEvent | null = null;
    for (const hs of filtered) {
      if (hs.type !== 'killstreak' || !hs.focusUnitId) continue;
      const hsStart = parseTs(hs.startTs);
      const preTrackStart = hsStart - PRE_TRACK_SECONDS * 1000;
      // Within the pre-track window but before the hotspot actually starts
      if (curMs >= preTrackStart && curMs < hsStart) {
        if (!preTrackTarget || hs.score > preTrackTarget.score) {
          preTrackTarget = hs;
        }
      }
    }

    // Start pre-tracking if we found a target and haven't already started
    if (preTrackTarget && preTrackTarget.id !== preTrackingIdRef.current) {
      const now = Date.now();
      if (now - lastSwitchTime >= SWITCH_COOLDOWN_MS) {
        preTrackingIdRef.current = preTrackTarget.id;
        followingUnitRef.current = preTrackTarget.focusUnitId!;
        setSelectedUnitId(preTrackTarget.focusUnitId!);
        setFollowSelectedUnit(true);
        recordSwitch();
      }
    }

    // --- Phase 2: Find active hotspots at current timestamp ---
    const active: HotspotEvent[] = [];
    for (const hs of filtered) {
      const hsStart = parseTs(hs.startTs);
      const hsEnd = parseTs(hs.endTs);
      if (curMs >= hsStart && curMs <= hsEnd) {
        active.push(hs);
      }
    }

    if (active.length === 0) {
      // If we were pre-tracking, keep following
      if (preTrackingIdRef.current !== null) return;

      lastHotspotIdRef.current = null;
      setActiveHotspotId(null);
      // Stop unit follow if we started it (and no pre-tracking)
      if (followingUnitRef.current !== null) {
        setFollowSelectedUnit(false);
        followingUnitRef.current = null;
      }
      // Clear unit selection when no active hotspot
      setSelectedUnitId(null);
      // Restore speed after leaving hotspot
      if (slowdownActiveRef.current && originalSpeedRef.current !== null) {
        setSpeed(originalSpeedRef.current);
        originalSpeedRef.current = null;
        slowdownActiveRef.current = false;
      }
      // Exit focus mode
      exitFocusMode();
      setHotspotScore(0);
      return;
    }

    // If we're currently tracking a hotspot that's still active, lock onto it
    // (don't let a higher-scoring newcomer steal the camera mid-event)
    const currentStillActive = lastHotspotIdRef.current !== null
      ? active.find((hs) => hs.id === lastHotspotIdRef.current)
      : null;

    const best = currentStillActive
      ? currentStillActive
      : active.sort((a, b) => b.score - a.score)[0];

    // Update score display (normalize to 0-1, cap at 200)
    setHotspotScore(Math.min(1, best.score / 200));

    // Update active hotspot ID for circle overlay
    setActiveHotspotId(best.id);

    // Already tracking this hotspot — keep following, no camera override
    if (best.id === lastHotspotIdRef.current) {
      return;
    }

    // Cooldown check
    const now = Date.now();
    if (now - lastSwitchTime < SWITCH_COOLDOWN_MS) return;

    // Switch camera to the hotspot
    lastHotspotIdRef.current = best.id;
    preTrackingIdRef.current = null; // Clear pre-track since we're now in the hotspot

    // Compute zoom from the hotspot's real spatial radius
    const isPersonal = best.type === 'killstreak';
    const hsZoom = best.radius > 0
      ? radiusToZoom(best.radius, isPersonal)
      : (isPersonal ? 19 : 17);

    // --- Killstreak with focusUnitId: follow the killer ---
    if (isPersonal && best.focusUnitId) {
      setSelectedUnitId(best.focusUnitId);
      setFollowSelectedUnit(true);
      followingUnitRef.current = best.focusUnitId;

      // Also set a target camera with the computed zoom so the initial
      // flyTo uses the hotspot-appropriate zoom level
      if (coordMode === 'wgs84') {
        setTargetCamera({ lat: best.centerLat, lng: best.centerLng, zoom: hsZoom });
      }

      // Slow down playback for killstreak
      if (!slowdownActiveRef.current) {
        const slowSpeed = Math.max(1, Math.round(speed / KILLSTREAK_DIVISOR));
        if (slowSpeed < speed) {
          originalSpeedRef.current = speed;
          slowdownActiveRef.current = true;
          setSpeed(slowSpeed);
        }
      }

      // --- Activate focus mode: dark map + highlight killer & targets ---
      const { mapStyle } = usePlayback.getState();
      const relatedIds = (best.units || []).filter(id => id !== best.focusUnitId);
      activateFocusMode(best.focusUnitId, relatedIds, mapStyle);
      if (mapStyle !== 'dark') {
        usePlayback.getState().setMapStyle('dark');
      }

      recordSwitch();
      return;
    }

    // --- Other event types: fly to hotspot center with radius-based zoom ---
    if (followingUnitRef.current !== null) {
      setFollowSelectedUnit(false);
      followingUnitRef.current = null;
    }
    setSelectedUnitId(null);

    // Restore speed if we were in slowdown
    if (slowdownActiveRef.current && originalSpeedRef.current !== null) {
      setSpeed(originalSpeedRef.current);
      originalSpeedRef.current = null;
      slowdownActiveRef.current = false;
    }
    // Exit focus mode when switching to non-personal hotspot
    exitFocusMode();

    if (best.centerLat === 0 && best.centerLng === 0) return;

    if (coordMode === 'wgs84') {
      setTargetCamera({ lat: best.centerLat, lng: best.centerLng, zoom: hsZoom });
    } else {
      setTargetCamera({ x: best.centerLng, y: best.centerLat, zoom: 8 });
    }
    recordSwitch();
  }, [
    autoMode, playing, currentTs, hotspots, coordMode, speed, units,
    lastSwitchTime, typeFilters,
    setTargetCamera, setHotspotScore, recordSwitch,
    setSelectedUnitId, setFollowSelectedUnit, setSpeed, setActiveHotspotId,
    activateFocusMode, deactivateFocusMode,
  ]);
}
