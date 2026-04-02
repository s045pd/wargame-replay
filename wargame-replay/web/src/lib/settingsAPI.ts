import { useVisualConfig, VISUAL_DEFAULTS } from '../store/visualConfig';
import type { VisualConfig } from '../store/visualConfig';
import { usePlayback } from '../store/playback';
import { useDirector } from '../store/director';
import { useHotspotFilter } from '../store/hotspotFilter';
import { useI18n } from './i18n';
import type { Locale } from './i18n';
import { getMapboxToken, setMapboxToken, resetMapboxToken, DEFAULT_STYLE } from '../map/styles';
import type { MapStyleKey } from '../map/styles';

// ── Full config shape (all stores combined) ──

export interface FullConfig extends VisualConfig {
  mapStyle: MapStyleKey;
  tiltMode: boolean;
  speed: number;
  trailEnabled: boolean;
  killLineEnabled: boolean;
  hitLineEnabled: boolean;
  reviveEffectEnabled: boolean;
  healEffectEnabled: boolean;
  hitFeedbackEnabled: boolean;
  deathEffectEnabled: boolean;
  killstreakSlowDiv: number;
  longRangeSlowSpeed: number;
  bombardSlowDiv: number;
  focusDarkMap: boolean;
  locale: Locale;
  debugOverlay: boolean;
  typeFilters: Record<string, boolean>;
  mapboxToken: string;
}

export const DEFAULTS: FullConfig = {
  ...VISUAL_DEFAULTS,
  mapStyle: DEFAULT_STYLE,
  tiltMode: false,
  speed: 64,
  trailEnabled: true,
  killLineEnabled: true,
  hitLineEnabled: true,
  reviveEffectEnabled: true,
  healEffectEnabled: true,
  hitFeedbackEnabled: true,
  deathEffectEnabled: true,
  killstreakSlowDiv: 4,
  longRangeSlowSpeed: 0,
  bombardSlowDiv: 4,
  focusDarkMap: true,
  locale: 'zh',
  debugOverlay: false,
  typeFilters: {
    firefight: true,
    killstreak: true,
    mass_casualty: true,
    engagement: true,
    bombardment: true,
    long_range: true,
  },
  mapboxToken: '',
};

// ── Validation ranges for numeric fields ──

const RANGES: Partial<Record<keyof FullConfig, [number, number]>> = {
  introDuration: [1, 15],
  introPitch: [0, 60],
  introBearing: [-180, 180],
  maxZoom: [10, 22],
  boundsPadding: [5, 30],
  unitIconSize: [16, 64],
  labelFontSize: [8, 16],
  deadOpacity: [0, 1],
  defaultFollowZoom: [14, 22],
  killLineWidth: [1, 6],
  killLineDuration: [0.5, 10],
  hitLineWidth: [1, 6],
  hitLineDuration: [0.5, 10],
  reviveDuration: [0.3, 3],
  reviveIntensity: [0.1, 1],
  healDuration: [0.3, 3],
  healGlowSize: [1, 3],
  hitFlashDuration: [0.1, 1],
  hitFlashIntensity: [0.1, 1],
  deathDuration: [0.5, 5],
  deathScale: [0.5, 3],
  bombingDuration: [0.5, 5],
  tracerSpeed: [0.5, 5],
  tracerWidth: [1, 6],
  tracerTrailLength: [10, 200],
  tracerGlow: [0, 1],
  tracerDuration: [0.5, 5],
  focusLockDuration: [2, 15],
  defaultSpeed: [1, 128],
  speed: [1, 128],
  killstreakSlowDiv: [0, 16],
  longRangeSlowSpeed: [0, 8],
  bombardSlowDiv: [0, 8],
  directorCooldown: [2, 15],
  directorJitter: [0, 0.5],
  directorPreTrack: [2, 15],
  directorScorePower: [0.5, 3],
  personalZoomPx: [100, 500],
  groupZoomPx: [150, 600],
  directorMinZoom: [10, 18],
  directorMaxZoom: [16, 22],
  freeMaxZoom: [12, 19],
  activityCircleMin: [20, 150],
  activityCircleMax: [100, 600],
};

const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;

// ── Export: aggregate all stores into one JSON ──

export function exportConfig(): FullConfig {
  const vc = useVisualConfig.getState();
  const pb = usePlayback.getState();
  const dir = useDirector.getState();
  const hf = useHotspotFilter.getState();
  const i18n = useI18n.getState();

  // Extract only VisualConfig fields (not store methods)
  const visualFields: Record<string, unknown> = {};
  for (const key of Object.keys(VISUAL_DEFAULTS)) {
    visualFields[key] = vc[key as keyof VisualConfig];
  }

  return {
    ...(visualFields as VisualConfig),
    mapStyle: pb.mapStyle,
    tiltMode: pb.tiltMode,
    speed: pb.speed,
    trailEnabled: pb.trailEnabled,
    killLineEnabled: pb.killLineEnabled,
    hitLineEnabled: pb.hitLineEnabled,
    reviveEffectEnabled: pb.reviveEffectEnabled,
    healEffectEnabled: pb.healEffectEnabled,
    hitFeedbackEnabled: pb.hitFeedbackEnabled,
    deathEffectEnabled: pb.deathEffectEnabled,
    killstreakSlowDiv: pb.killstreakSlowDiv,
    longRangeSlowSpeed: pb.longRangeSlowSpeed,
    bombardSlowDiv: pb.bombardSlowDiv,
    focusDarkMap: dir.focusDarkMap,
    locale: i18n.locale,
    debugOverlay: hf.debugOverlay,
    typeFilters: { ...hf.typeFilters },
    mapboxToken: getMapboxToken(),
  };
}

// ── Import: validate + distribute to stores ──

export function importConfig(json: unknown): { ok: boolean; errors: string[] } {
  if (typeof json !== 'object' || json === null || Array.isArray(json)) {
    return { ok: false, errors: ['Invalid config: expected a JSON object'] };
  }

  const obj = json as Record<string, unknown>;
  const errors: string[] = [];
  const visualPatch: Partial<VisualConfig> = {};

  // Validate and collect visual config fields
  for (const [key, defaultVal] of Object.entries(VISUAL_DEFAULTS)) {
    if (!(key in obj)) continue;
    const val = obj[key];
    const expectedType = typeof defaultVal;

    if (typeof val !== expectedType) {
      errors.push(`${key}: expected ${expectedType}, got ${typeof val}`);
      continue;
    }

    // Range check
    const range = RANGES[key as keyof FullConfig];
    if (range && typeof val === 'number') {
      if (val < range[0] || val > range[1]) {
        errors.push(`${key}: ${val} out of range [${range[0]}, ${range[1]}]`);
        continue;
      }
    }

    // Color check
    if (typeof val === 'string' && typeof defaultVal === 'string' && defaultVal.startsWith('#')) {
      if (!HEX_COLOR_RE.test(val)) {
        errors.push(`${key}: invalid hex color "${val}"`);
        continue;
      }
    }

    (visualPatch as Record<string, unknown>)[key] = val;
  }

  // Apply visual config
  if (Object.keys(visualPatch).length > 0) {
    useVisualConfig.getState().setBatch(visualPatch);
  }

  // Apply playback store fields
  const pb = usePlayback.getState();
  if (obj.mapStyle !== undefined && typeof obj.mapStyle === 'string') {
    pb.setMapStyle(obj.mapStyle as MapStyleKey);
  }
  if (typeof obj.tiltMode === 'boolean' && pb.tiltMode !== obj.tiltMode) pb.toggleTiltMode();
  if (typeof obj.speed === 'number') pb.setSpeed(obj.speed);
  if (typeof obj.trailEnabled === 'boolean') pb.setTrailEnabled(obj.trailEnabled);
  if (typeof obj.killLineEnabled === 'boolean') pb.setKillLineEnabled(obj.killLineEnabled);
  if (typeof obj.hitLineEnabled === 'boolean') pb.setHitLineEnabled(obj.hitLineEnabled);
  if (typeof obj.reviveEffectEnabled === 'boolean') pb.setReviveEffectEnabled(obj.reviveEffectEnabled);
  if (typeof obj.healEffectEnabled === 'boolean') pb.setHealEffectEnabled(obj.healEffectEnabled);
  if (typeof obj.hitFeedbackEnabled === 'boolean') pb.setHitFeedbackEnabled(obj.hitFeedbackEnabled);
  if (typeof obj.deathEffectEnabled === 'boolean') pb.setDeathEffectEnabled(obj.deathEffectEnabled);
  if (typeof obj.killstreakSlowDiv === 'number') pb.setKillstreakSlowDiv(obj.killstreakSlowDiv);
  if (typeof obj.longRangeSlowSpeed === 'number') pb.setLongRangeSlowSpeed(obj.longRangeSlowSpeed);
  if (typeof obj.bombardSlowDiv === 'number') pb.setBombardSlowDiv(obj.bombardSlowDiv);

  // Apply director
  if (typeof obj.focusDarkMap === 'boolean') {
    const dir = useDirector.getState();
    if (dir.focusDarkMap !== obj.focusDarkMap) dir.toggleFocusDarkMap();
  }

  // Apply locale
  if (obj.locale === 'en' || obj.locale === 'zh') {
    useI18n.getState().setLocale(obj.locale);
  }

  // Apply hotspot filter
  if (typeof obj.debugOverlay === 'boolean') {
    const hf = useHotspotFilter.getState();
    if (hf.debugOverlay !== obj.debugOverlay) hf.toggleDebugOverlay();
  }
  if (typeof obj.typeFilters === 'object' && obj.typeFilters !== null) {
    const hf = useHotspotFilter.getState();
    const tf = obj.typeFilters as Record<string, boolean>;
    for (const [k, v] of Object.entries(tf)) {
      if (typeof v === 'boolean' && k in hf.typeFilters) {
        hf.setTypeFilter(k as Parameters<typeof hf.setTypeFilter>[0], v);
      }
    }
  }

  // Apply mapbox token (with side-effect)
  if (typeof obj.mapboxToken === 'string') {
    setMapboxToken(obj.mapboxToken);
    usePlayback.getState().bumpStyleNonce();
  }

  return { ok: errors.length === 0, errors };
}

// ── Reset all stores to defaults ──

export function resetToDefaults(): void {
  // Visual config
  useVisualConfig.getState().reset();

  // Playback store
  const pb = usePlayback.getState();
  pb.setMapStyle(DEFAULTS.mapStyle);
  if (pb.tiltMode !== DEFAULTS.tiltMode) pb.toggleTiltMode();
  pb.setSpeed(DEFAULTS.speed);
  pb.setTrailEnabled(DEFAULTS.trailEnabled);
  pb.setKillLineEnabled(DEFAULTS.killLineEnabled);
  pb.setHitLineEnabled(DEFAULTS.hitLineEnabled);
  pb.setReviveEffectEnabled(DEFAULTS.reviveEffectEnabled);
  pb.setHealEffectEnabled(DEFAULTS.healEffectEnabled);
  pb.setHitFeedbackEnabled(DEFAULTS.hitFeedbackEnabled);
  pb.setDeathEffectEnabled(DEFAULTS.deathEffectEnabled);
  pb.setKillstreakSlowDiv(DEFAULTS.killstreakSlowDiv);
  pb.setLongRangeSlowSpeed(DEFAULTS.longRangeSlowSpeed);
  pb.setBombardSlowDiv(DEFAULTS.bombardSlowDiv);

  // Director
  const dir = useDirector.getState();
  if (dir.focusDarkMap !== DEFAULTS.focusDarkMap) dir.toggleFocusDarkMap();

  // Locale
  useI18n.getState().setLocale(DEFAULTS.locale);

  // Hotspot filter
  const hf = useHotspotFilter.getState();
  if (hf.debugOverlay !== DEFAULTS.debugOverlay) hf.toggleDebugOverlay();
  for (const [k, v] of Object.entries(DEFAULTS.typeFilters)) {
    hf.setTypeFilter(k as Parameters<typeof hf.setTypeFilter>[0], v);
  }

  // Mapbox token
  resetMapboxToken();
  pb.bumpStyleNonce();
}
