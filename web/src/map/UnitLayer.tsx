import { useEffect, useRef, useCallback } from 'react';
import * as mapboxgl from 'maplibre-gl';
import { UnitPosition, UnitClass, UNIT_CLASS_LABELS, GameEvent } from '../lib/api';
import { registerUnitIcons, iconName } from './unitIcons';
import { useI18n } from '../lib/i18n';
import { useDirector } from '../store/director';
import type { FocusMode } from '../store/director';
import { usePlayback } from '../store/playback';
import { useVisualConfig } from '../store/visualConfig';

/** Focus info passed to the GeoJSON builder (Set for O(1) lookup) */
interface FocusInfo {
  active: boolean;
  focusUnitId: number;
  relatedIds: Set<number>;
  /** True = dark map is on → heavily dim background; false = keep current map → lightly dim */
  darkMap: boolean;
}

interface UnitLayerProps {
  map: mapboxgl.Map;
  units: UnitPosition[];
  selectedUnitId?: number | null;
  speed?: number;
  focusMode?: FocusMode;
  events?: GameEvent[];
  onSelectUnit?: (id: number | null) => void;
}

const SOURCE_ID = 'units-source';
const GLOW_LAYER_ID = 'units-glow-layer';
const ALIVE_LAYER_ID = 'units-alive-layer';
const DEAD_LAYER_ID = 'units-dead-layer';
const SELECTED_LAYER_ID = 'units-selected-layer';
const LABEL_LAYER_ID = 'units-label-layer';

// --- Animation timing ---
const POS_LERP_MS = 900;   // position interpolation
const HP_LERP_MS = 600;    // HP decrease animation
const HIT_FLASH_MS = 400;  // bright glow flash on hit
const DEATH_FLASH_MS = 300; // initial bright flash on death
const DEATH_FADE_MS = 800;  // fade from alive to dead after flash
const DEATH_TOTAL_MS = DEATH_FLASH_MS + DEATH_FADE_MS;
const REVIVE_FLASH_MS = 500; // green glow pulse on revive
const REVIVE_GROW_MS = 600;  // icon grows back to full size
const REVIVE_TOTAL_MS = REVIVE_FLASH_MS + REVIVE_GROW_MS;

function teamColor(team: string): string {
  if (team === 'red') return '#ff4444';
  if (team === 'blue') return '#00ccff';
  return '#aaaaaa';
}

function teamHaloColor(team: string): string {
  if (team === 'red') return '#ff8800';
  if (team === 'blue') return '#0066ff';
  return '#666666';
}

/** Per-unit visual state for smooth animations */
interface UnitVisualState {
  // Position
  prevLng: number;
  prevLat: number;
  targetLng: number;
  targetLat: number;
  // HP
  displayHP: number;
  targetHP: number;
  hpChangeTime: number;
  prevHP: number;
  // Hit flash (glow pulse when damaged)
  lastHitTime: number;
  // Death transition
  dying: boolean;
  deathTime: number;
  deathDone: boolean; // fully transitioned to dead
  // Revive transition
  reviving: boolean;
  reviveTime: number;
  // Pending revive: unit was killed + revived between frames (high-speed skip)
  pendingRevive: boolean;
  pendingReviveHP: number;
  // Server state
  serverAlive: boolean;
}

/**
 * Build GeoJSON with visual state overlays.
 * Each feature carries animated properties for position, HP icon, glow, opacity.
 */
function buildAnimatedGeoJson(
  units: UnitPosition[],
  selectedUnitId: number | null | undefined,
  states: Map<number, UnitVisualState>,
  now: number,
  posLerpMs: number = POS_LERP_MS,
  focus?: FocusInfo,
): GeoJSON.FeatureCollection {
  const pbFx = usePlayback.getState();
  return {
    type: 'FeatureCollection',
    features: units
      .filter(u => u.lng !== undefined && u.lat !== undefined)
      .map(u => {
        const cls = (u.class || 'rifle') as UnitClass;
        const vs = states.get(u.id);

        // --- Position ---
        let lng = u.lng!;
        let lat = u.lat!;
        if (vs) {
          const posElapsed = now - (vs as { _posStart?: number })._posStart!;
          const posT = Math.min(posElapsed / posLerpMs, 1);
          const posEased = 1 - Math.pow(1 - posT, 3);
          lng = vs.prevLng + (vs.targetLng - vs.prevLng) * posEased;
          lat = vs.prevLat + (vs.targetLat - vs.prevLat) * posEased;
        }

        // --- HP ---
        let displayHP = u.hp;
        if (vs) {
          const hpElapsed = now - vs.hpChangeTime;
          if (hpElapsed < HP_LERP_MS && vs.prevHP !== vs.targetHP) {
            const hpT = Math.min(hpElapsed / HP_LERP_MS, 1);
            const hpEased = 1 - Math.pow(1 - hpT, 2); // ease-out quadratic
            displayHP = Math.round(vs.prevHP + (vs.targetHP - vs.prevHP) * hpEased);
          } else {
            displayHP = vs.targetHP;
          }
          vs.displayHP = displayHP;
        }

        // --- Hit flash (glow pulse) ---
        let glowRadius = 12;
        let glowOpacity = 0.25;
        let glowColor = teamHaloColor(u.team);
        if (pbFx.hitFeedbackEnabled && vs && vs.lastHitTime > 0) {
          const hitElapsed = now - vs.lastHitTime;
          if (hitElapsed < HIT_FLASH_MS) {
            const hitT = hitElapsed / HIT_FLASH_MS;
            // Quick bright pulse that fades
            const flashIntensity = 1 - hitT;
            glowRadius = 12 + 10 * flashIntensity;
            glowOpacity = 0.25 + 0.55 * flashIntensity;
            // Flash white-ish on hit
            glowColor = '#ffffff';
          }
        }

        // --- Death transition ---
        let visuallyDead = 0; // 0 = show in alive layers, 1 = show in dead layers
        let aliveIconOpacity = 0.95;
        let iconScale = 1.0;

        if (vs && vs.dying) {
          const deathElapsed = now - vs.deathTime;

          if (pbFx.deathEffectEnabled && deathElapsed < DEATH_FLASH_MS) {
            // Phase 1: bright red/white flash — unit is still "visible" as alive
            const flashT = deathElapsed / DEATH_FLASH_MS;
            const flashIntensity = 1 - flashT;
            glowRadius = 12 + 14 * flashIntensity;
            glowOpacity = 0.3 + 0.7 * flashIntensity;
            glowColor = u.team === 'red' ? '#ff4444' : '#00ccff';
            aliveIconOpacity = 0.95;
            visuallyDead = 0;
          } else if (pbFx.deathEffectEnabled && deathElapsed < DEATH_TOTAL_MS) {
            // Phase 2: fade out — icon shrinks and dims
            const fadeT = (deathElapsed - DEATH_FLASH_MS) / DEATH_FADE_MS;
            const fadeEased = fadeT * fadeT; // ease-in
            aliveIconOpacity = 0.95 * (1 - fadeEased);
            iconScale = 1.0 - 0.3 * fadeEased;
            glowOpacity = 0.25 * (1 - fadeEased);
            visuallyDead = 0; // still in alive layer during fade
          } else {
            // Phase 3: fully dead (or FX disabled — skip animation)
            visuallyDead = 1;
            vs.deathDone = true;
          }
        } else if (vs && vs.reviving) {
          // --- Revive transition: green glow pulse + icon grows back ---
          const reviveElapsed = now - vs.reviveTime;
          // Check if the visual effect should play (revive or heal toggle)
          const showReviveFx = pbFx.reviveEffectEnabled || pbFx.healEffectEnabled;

          if (showReviveFx && reviveElapsed < REVIVE_FLASH_MS) {
            // Phase 1: bright green flash
            const flashT = reviveElapsed / REVIVE_FLASH_MS;
            const flashIntensity = Math.sin(flashT * Math.PI); // pulse up then down
            glowRadius = 12 + 16 * flashIntensity;
            glowOpacity = 0.3 + 0.7 * flashIntensity;
            glowColor = '#22ff88'; // bright green
            iconScale = 0.5 + 0.5 * Math.min(reviveElapsed / REVIVE_FLASH_MS, 1);
            aliveIconOpacity = 0.5 + 0.45 * (reviveElapsed / REVIVE_FLASH_MS);
            visuallyDead = 0;
          } else if (showReviveFx && reviveElapsed < REVIVE_TOTAL_MS) {
            // Phase 2: settle to normal
            const settleT = (reviveElapsed - REVIVE_FLASH_MS) / REVIVE_GROW_MS;
            iconScale = 1.0;
            aliveIconOpacity = 0.95;
            // Gentle lingering green glow
            const glowFade = 1 - settleT;
            glowRadius = 12 + 4 * glowFade;
            glowOpacity = 0.25 + 0.15 * glowFade;
            glowColor = '#22ff88';
            visuallyDead = 0;
          } else {
            // Revive complete (or FX disabled — skip directly)
            vs.reviving = false;
            visuallyDead = 0;
          }
        } else if (vs && !vs.serverAlive && vs.deathDone) {
          visuallyDead = 1;
        }

        // --- Focus mode visual adjustments ---
        let showLabel = 0; // 1 = always show name label (even if not selected)
        let deadIconOpacity = 0.5; // default dead unit opacity
        let labelText = `${u.name || `#${u.id}`} (${UNIT_CLASS_LABELS[cls]})`;
        let labelSize = 11;          // default label font size
        let labelColor = '#ffffff';   // default label color
        let labelOpacity = 1.0;       // default label opacity
        if (focus?.active) {
          if (u.id === focus.focusUnitId) {
            // ★ Focus unit (the killer): gold glow, full brightness, name visible
            glowRadius = Math.max(glowRadius, 18);
            glowOpacity = Math.max(glowOpacity, 0.55);
            glowColor = '#ffaa00'; // gold
            iconScale = Math.max(iconScale, 1.15);
            showLabel = 1;
            labelText = u.name || `#${u.id}`; // name only, no class
            labelColor = '#ffffff';
            labelSize = 11;
          } else if (focus.relatedIds.has(u.id)) {
            // ● Related targets: smaller + dimmer name to reduce overlap
            aliveIconOpacity *= 0.75;
            deadIconOpacity = 0.3;
            showLabel = 1;
            labelText = u.name || `#${u.id}`; // name only, no class
            labelSize = 9;
            labelColor = '#a0a0a0'; // muted gray
            // When a related unit is dead, dim the label to match the icon
            if (visuallyDead === 1) {
              labelOpacity = 0.35;
            }
          } else if (focus.darkMap) {
            // ○ Background units on dark map: very dim, no label
            aliveIconOpacity *= 0.1;
            glowOpacity *= 0.1;
            deadIconOpacity = 0.06;
          } else {
            // ○ Background units on normal map: slightly dimmed, no label
            aliveIconOpacity *= 0.55;
            glowOpacity *= 0.4;
            deadIconOpacity = 0.25;
          }
        }

        return {
          type: 'Feature' as const,
          geometry: {
            type: 'Point' as const,
            coordinates: [lng, lat],
          },
          properties: {
            id: u.id,
            team: u.team,
            alive: visuallyDead === 0 ? 1 : 0,
            hp: displayHP,
            ammo: u.ammo ?? 0,
            supply: u.supply ?? 0,
            revivalTokens: u.revivalTokens ?? 0,
            name: u.name || `#${u.id}`,
            unitClass: cls,
            classLabel: UNIT_CLASS_LABELS[cls],
            color: teamColor(u.team),
            haloColor: glowColor,
            glowRadius,
            glowOpacity,
            aliveIconOpacity,
            iconScale,
            selected: u.id === selectedUnitId ? 1 : 0,
            showLabel,
            deadIconOpacity,
            labelText,
            labelSize,
            labelColor,
            labelOpacity,
            iconAlive: iconName(u.team, cls, false, displayHP),
            iconDead: iconName(u.team, cls, true, 0),
          },
        };
      }),
  };
}

/**
 * Compute adaptive position lerp duration based on playback speed.
 * At 1x we use the default 900ms; at high speeds (32x–128x) the server
 * delivers frames every ~62ms so we must lerp faster to keep up.
 */
function adaptiveLerpMs(speed: number): number {
  if (speed <= 1) return POS_LERP_MS;
  // Match server tick interval: min(1000/speed, 62ms) with 85% fill
  const maxFPS = 16;
  const tickMs = speed <= maxFPS ? 1000 / speed : 1000 / maxFPS;
  return Math.max(40, Math.min(POS_LERP_MS, tickMs * 0.85));
}

export function UnitLayer({ map, units, selectedUnitId, speed = 1, focusMode, events, onSelectUnit }: UnitLayerProps) {
  const popupRef = useRef<mapboxgl.Popup | null>(null);
  const onSelectUnitRef = useRef(onSelectUnit);
  onSelectUnitRef.current = onSelectUnit;
  const unitsRef = useRef(units);
  unitsRef.current = units;
  const selectedRef = useRef(selectedUnitId);
  selectedRef.current = selectedUnitId;
  const speedRef = useRef(speed);
  speedRef.current = speed;

  // Stable focus info ref — convert relatedUnitIds to Set once for O(1) lookup.
  // Only rebuild when the focus mode identity actually changes (avoids per-frame Set allocation).
  const focusInfoRef = useRef<FocusInfo>({ active: false, focusUnitId: -1, relatedIds: new Set(), darkMap: false });
  const prevFocusModeRef = useRef(focusMode);
  if (prevFocusModeRef.current !== focusMode) {
    prevFocusModeRef.current = focusMode;
    // Read focusDarkMap + current map style to determine if dark map is actually in effect
    const dirState = useDirector.getState();
    const pbMapStyle = usePlayback.getState().mapStyle;
    const isDarkActive = dirState.focusDarkMap && pbMapStyle === 'dark';
    if (focusMode?.active) {
      focusInfoRef.current = {
        active: true,
        focusUnitId: focusMode.focusUnitId,
        relatedIds: new Set(focusMode.relatedUnitIds),
        darkMap: isDarkActive,
      };
    } else {
      focusInfoRef.current = { active: false, focusUnitId: -1, relatedIds: new Set(), darkMap: false };
    }
  }

  // --- Per-unit visual states ---
  const visualStatesRef = useRef<Map<number, UnitVisualState & { _posStart?: number }>>(new Map());
  const rafRef = useRef<number>(0);
  const isAnimatingRef = useRef(false);
  /** Tracks whether ANY animation is still in progress */
  const hasActiveAnimation = useRef(false);
  /** Throttle setData to ~30fps: skip if last push was <30ms ago */
  const lastSetDataRef = useRef<number>(0);
  const SET_DATA_MIN_MS = 30;

  const addSourceAndLayers = useCallback(() => {
    if (map.getSource(SOURCE_ID)) return;

    registerUnitIcons(map);

    const now = performance.now();
    const geojson = buildAnimatedGeoJson(
      unitsRef.current, selectedRef.current, visualStatesRef.current, now,
      POS_LERP_MS, focusInfoRef.current,
    );

    map.addSource(SOURCE_ID, {
      type: 'geojson',
      data: geojson,
    });

    // Glow/halo ring — data-driven radius, opacity, color for hit/death flash
    map.addLayer({
      id: GLOW_LAYER_ID,
      type: 'circle',
      source: SOURCE_ID,
      filter: ['==', ['get', 'alive'], 1],
      paint: {
        'circle-radius': ['get', 'glowRadius'],
        'circle-color': ['get', 'haloColor'],
        'circle-opacity': ['get', 'glowOpacity'],
        'circle-stroke-width': 0,
      },
    });

    // Alive units — data-driven opacity and size for death fade
    map.addLayer({
      id: ALIVE_LAYER_ID,
      type: 'symbol',
      source: SOURCE_ID,
      filter: ['==', ['get', 'alive'], 1],
      layout: {
        'icon-image': ['get', 'iconAlive'],
        'icon-size': ['get', 'iconScale'],
        'icon-allow-overlap': true,
        'icon-ignore-placement': true,
      },
      paint: {
        'icon-opacity': ['get', 'aliveIconOpacity'],
      },
    });

    // Dead units — appear only after death animation completes
    map.addLayer({
      id: DEAD_LAYER_ID,
      type: 'symbol',
      source: SOURCE_ID,
      filter: ['==', ['get', 'alive'], 0],
      layout: {
        'icon-image': ['get', 'iconDead'],
        'icon-size': 0.7,
        'icon-allow-overlap': true,
        'icon-ignore-placement': true,
      },
      paint: {
        'icon-opacity': ['get', 'deadIconOpacity'],
      },
    });

    // Selection ring
    map.addLayer({
      id: SELECTED_LAYER_ID,
      type: 'circle',
      source: SOURCE_ID,
      filter: ['==', ['get', 'selected'], 1],
      paint: {
        'circle-radius': 14,
        'circle-color': 'transparent',
        'circle-opacity': 0,
        'circle-stroke-width': 2,
        'circle-stroke-color': '#ffffff',
        'circle-stroke-opacity': 0.9,
      },
    });

    // Callsign label for selected or focus-highlighted units
    map.addLayer({
      id: LABEL_LAYER_ID,
      type: 'symbol',
      source: SOURCE_ID,
      filter: ['any', ['==', ['get', 'selected'], 1], ['==', ['get', 'showLabel'], 1]],
      layout: {
        'text-field': ['get', 'labelText'],
        'text-font': ['DIN Offc Pro Medium', 'Arial Unicode MS Bold'],
        'text-size': ['get', 'labelSize'],
        'text-offset': [0, -2],
        'text-anchor': 'bottom',
        'text-allow-overlap': true,
      },
      paint: {
        'text-color': ['get', 'labelColor'],
        'text-opacity': ['get', 'labelOpacity'],
        'text-halo-color': '#000000',
        'text-halo-width': 1,
      },
    });
  }, [map]);

  // --- Setup layers + event handlers ---
  useEffect(() => {
    addSourceAndLayers();

    const popup = new mapboxgl.Popup({
      closeButton: false,
      closeOnClick: false,
      className: 'unit-popup',
    });
    popupRef.current = popup;

    const showPopup = (e: mapboxgl.MapLayerMouseEvent) => {
      map.getCanvas().style.cursor = 'pointer';
      const feature = e.features?.[0];
      if (!feature) return;

      // Remove existing popup first to prevent overlap during layer transitions
      popup.remove();

      const coords = (feature.geometry as GeoJSON.Point).coordinates as [number, number];
      const team = feature.properties?.team as string;
      const name = feature.properties?.name as string;
      const hp = feature.properties?.hp as number;
      const alive = Number(feature.properties?.alive);
      const unitClass = feature.properties?.unitClass as string;
      const ammo = feature.properties?.ammo as number;
      const supply = feature.properties?.supply as number;
      const revivalTokens = feature.properties?.revivalTokens as number;

      const t = useI18n.getState().t;
      const classLabel = t(unitClass || 'rifle');
      popup
        .setLngLat(coords)
        .setHTML(
          `<div style="font-family: monospace; font-size: 12px; background: #111; color: #eee; padding: 6px 10px; border-radius: 4px; border: 1px solid #333;">
            <div><strong>${name}</strong></div>
            <div><span style="color: ${teamColor(team)}">${team}</span> &middot; ${classLabel}</div>
            ${alive === 0 ? `<div style="color: #ff4444;">${t('kia')}</div>` : `<div>${t('hp')}: ${hp}/100 &middot; ${t('ammo')}: ${ammo} &middot; ${t('supply')}: ${supply} &middot; ${t('revival_tokens')}: ${revivalTokens}</div>`}
          </div>`
        )
        .addTo(map);
    };

    const hidePopup = () => {
      map.getCanvas().style.cursor = '';
      popup.remove();
    };

    const onClickUnit = (e: mapboxgl.MapLayerMouseEvent) => {
      const feature = e.features?.[0];
      if (feature) onSelectUnitRef.current?.(feature.properties?.id as number);
    };

    const onClickMap = (e: mapboxgl.MapMouseEvent) => {
      const features = map.queryRenderedFeatures(e.point, { layers: [ALIVE_LAYER_ID, DEAD_LAYER_ID] });
      if (features.length === 0) {
        onSelectUnitRef.current?.(null);
      }
    };

    map.on('mouseenter', ALIVE_LAYER_ID, showPopup);
    map.on('mouseenter', DEAD_LAYER_ID, showPopup);
    map.on('mouseleave', ALIVE_LAYER_ID, hidePopup);
    map.on('mouseleave', DEAD_LAYER_ID, hidePopup);
    map.on('click', ALIVE_LAYER_ID, onClickUnit);
    map.on('click', DEAD_LAYER_ID, onClickUnit);
    map.on('click', onClickMap);

    const onStyleLoad = () => addSourceAndLayers();
    map.on('style.load', onStyleLoad);

    return () => {
      // Remove ALL event handlers to prevent StrictMode double-bindings
      map.off('mouseenter', ALIVE_LAYER_ID, showPopup);
      map.off('mouseenter', DEAD_LAYER_ID, showPopup);
      map.off('mouseleave', ALIVE_LAYER_ID, hidePopup);
      map.off('mouseleave', DEAD_LAYER_ID, hidePopup);
      map.off('click', ALIVE_LAYER_ID, onClickUnit);
      map.off('click', DEAD_LAYER_ID, onClickUnit);
      map.off('click', onClickMap);
      map.off('style.load', onStyleLoad);
      cancelAnimationFrame(rafRef.current);
      isAnimatingRef.current = false;
      try {
        if (map.getLayer(LABEL_LAYER_ID)) map.removeLayer(LABEL_LAYER_ID);
        if (map.getLayer(SELECTED_LAYER_ID)) map.removeLayer(SELECTED_LAYER_ID);
        if (map.getLayer(DEAD_LAYER_ID)) map.removeLayer(DEAD_LAYER_ID);
        if (map.getLayer(ALIVE_LAYER_ID)) map.removeLayer(ALIVE_LAYER_ID);
        if (map.getLayer(GLOW_LAYER_ID)) map.removeLayer(GLOW_LAYER_ID);
        if (map.getSource(SOURCE_ID)) map.removeSource(SOURCE_ID);
      } catch {
        // Map may already be removed
      }
      popup.remove();
    };
   
  }, [map, addSourceAndLayers]);

  // --- Regenerate icons when visual config (colors / size) changes ---
  const unitIconSize = useVisualConfig(s => s.unitIconSize);
  const redTeamColor = useVisualConfig(s => s.redTeamColor);
  const blueTeamColor = useVisualConfig(s => s.blueTeamColor);
  const redDeadColor = useVisualConfig(s => s.redDeadColor);
  const blueDeadColor = useVisualConfig(s => s.blueDeadColor);

  useEffect(() => {
    // Re-register icons with updated config; update-or-add pattern in registerUnitIcons
    // handles both initial registration and subsequent updates.
    registerUnitIcons(map, {
      size: unitIconSize,
      redFill: redTeamColor,
      blueFill: blueTeamColor,
      redDeadFill: redDeadColor,
      blueDeadFill: blueDeadColor,
    });
    // Trigger a repaint so the map picks up the updated images
    map.triggerRepaint();
  }, [map, unitIconSize, redTeamColor, blueTeamColor, redDeadColor, blueDeadColor]);

  // --- Main animation: update visual states when new units arrive, run rAF ---
  useEffect(() => {
    const states = visualStatesRef.current;
    const now = performance.now();

    for (const u of units) {
      if (u.lng === undefined || u.lat === undefined) continue;

      const existing = states.get(u.id);

      if (existing) {
        // --- Position update (adaptive lerp for high-speed playback) ---
        const curLerp = adaptiveLerpMs(speedRef.current);
        existing.prevLng = existing.prevLng + (existing.targetLng - existing.prevLng) *
          Math.min((now - (existing._posStart || now)) / curLerp, 1);
        existing.prevLat = existing.prevLat + (existing.targetLat - existing.prevLat) *
          Math.min((now - (existing._posStart || now)) / curLerp, 1);
        existing.targetLng = u.lng;
        existing.targetLat = u.lat;
        existing._posStart = now;

        // --- HP change detection ---
        if (u.hp !== existing.targetHP) {
          const hpDecreased = u.hp < existing.targetHP;
          existing.prevHP = existing.displayHP; // start from current visual HP
          existing.targetHP = u.hp;
          existing.hpChangeTime = now;

          // Trigger hit flash on HP decrease
          if (hpDecreased) {
            existing.lastHitTime = now;
          }
        }

        // --- Death detection ---
        existing.serverAlive = u.alive;
        if (!u.alive && !existing.dying && !existing.deathDone) {
          // Unit just died — start death animation
          existing.dying = true;
          existing.deathTime = now;
          // Also trigger the HP drop to 0
          if (existing.targetHP > 0) {
            existing.prevHP = existing.displayHP;
            existing.targetHP = 0;
            existing.hpChangeTime = now;
          }
          // Flash on death
          existing.lastHitTime = now;
        }
        // Handle resurrection (unit comes back alive — revive or heal from 0)
        if (u.alive && (existing.dying || existing.deathDone)) {
          existing.dying = false;
          existing.deathDone = false;
          existing.reviving = true;
          existing.reviveTime = now;
          // Animate HP from 0 up to new HP
          existing.prevHP = 0;
          existing.displayHP = 0;
          existing.targetHP = u.hp;
          existing.hpChangeTime = now;
        }

        // Handle HP increase (medic heal) on an alive unit — green glow pulse
        if (u.alive && u.hp > existing.targetHP && !existing.reviving) {
          existing.prevHP = existing.displayHP;
          existing.targetHP = u.hp;
          existing.hpChangeTime = now;
          // Green heal flash (reuse revive glow but shorter)
          existing.reviving = true;
          existing.reviveTime = now;
        }
      } else {
        // First time seeing this unit
        states.set(u.id, {
          prevLng: u.lng,
          prevLat: u.lat,
          targetLng: u.lng,
          targetLat: u.lat,
          _posStart: now,
          displayHP: u.hp,
          targetHP: u.hp,
          prevHP: u.hp,
          hpChangeTime: 0,
          lastHitTime: 0,
          dying: !u.alive,
          deathTime: u.alive ? 0 : now - DEATH_TOTAL_MS - 1,
          deathDone: !u.alive,
          reviving: false,
          reviveTime: 0,
          pendingRevive: false,
          pendingReviveHP: 0,
          serverAlive: u.alive,
        });
      }
    }

    // --- Detect deaths skipped by frame gap (high-speed playback) ---
    // At high speeds, a unit may die and revive between consecutive frames.
    // The frame data shows the unit alive, so the normal death detection never fires.
    // Check kill events: if victim is currently alive with no death animation, trigger
    // a death→revival sequence so the user sees the kill flash + green revive pulse.
    if (events) {
      for (const ev of events) {
        if (ev.type !== 'kill' || ev.dst === undefined) continue;
        const vs = states.get(ev.dst);
        if (!vs) continue;
        // Only trigger for units that are ALIVE in current frame but have a kill event
        // (meaning they died and were revived between frames)
        if (vs.serverAlive && !vs.dying && !vs.deathDone && !vs.pendingRevive) {
          vs.dying = true;
          vs.deathTime = now;
          vs.lastHitTime = now;
          vs.pendingRevive = true;
          vs.pendingReviveHP = vs.targetHP; // remember the current HP to restore
          // Flash HP to 0 briefly
          vs.prevHP = vs.displayHP;
          vs.targetHP = 0;
          vs.hpChangeTime = now;
        }
      }
    }

    // --- Kick off / continue the rAF loop ---
    if (!isAnimatingRef.current) {
      isAnimatingRef.current = true;

      const animate = () => {
        if (!isAnimatingRef.current) return;

        const now = performance.now();
        const curLerp = adaptiveLerpMs(speedRef.current);

        // --- Transition pending revives: after death flash, start revive animation ---
        for (const [, vs] of states) {
          if (vs.dying && vs.pendingRevive && (now - vs.deathTime) >= DEATH_FLASH_MS) {
            vs.dying = false;
            vs.deathDone = false;
            vs.reviving = true;
            vs.reviveTime = now;
            vs.pendingRevive = false;
            // Animate HP from 0 up to stored HP
            vs.prevHP = 0;
            vs.displayHP = 0;
            vs.targetHP = vs.pendingReviveHP;
            vs.hpChangeTime = now;
          }
        }

        // Check if any animation is still in progress
        hasActiveAnimation.current = false;
        for (const [, vs] of states) {
          // Position still animating?
          if (now - (vs._posStart || 0) < curLerp) {
            hasActiveAnimation.current = true;
            break;
          }
          // HP still animating?
          if (vs.hpChangeTime > 0 && now - vs.hpChangeTime < HP_LERP_MS) {
            hasActiveAnimation.current = true;
            break;
          }
          // Hit flash still active?
          if (vs.lastHitTime > 0 && now - vs.lastHitTime < HIT_FLASH_MS) {
            hasActiveAnimation.current = true;
            break;
          }
          // Death animation still active?
          if (vs.dying && now - vs.deathTime < DEATH_TOTAL_MS) {
            hasActiveAnimation.current = true;
            break;
          }
          // Revive animation still active?
          if (vs.reviving && now - vs.reviveTime < REVIVE_TOTAL_MS) {
            hasActiveAnimation.current = true;
            break;
          }
          // Pending revive waiting for death flash to complete?
          if (vs.pendingRevive) {
            hasActiveAnimation.current = true;
            break;
          }
        }

        // Update GeoJSON — throttle to ~30fps to halve Mapbox re-index cost
        // while keeping interpolation calculations at full rAF rate
        const source = map.getSource(SOURCE_ID) as mapboxgl.GeoJSONSource | undefined;
        if (source && now - lastSetDataRef.current >= SET_DATA_MIN_MS) {
          lastSetDataRef.current = now;
          source.setData(
            buildAnimatedGeoJson(
              unitsRef.current, selectedRef.current, states, now, curLerp,
              focusInfoRef.current,
            ),
          );
        }

        if (hasActiveAnimation.current) {
          rafRef.current = requestAnimationFrame(animate);
        } else {
          isAnimatingRef.current = false;
        }
      };

      rafRef.current = requestAnimationFrame(animate);
    }
   
  }, [map, units, selectedUnitId, focusMode, events]);

  return null;
}
