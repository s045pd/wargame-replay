import type { StyleSpecification } from 'maplibre-gl';

// ── localStorage key for user-provided Mapbox token ──
const MAPBOX_TOKEN_KEY = 'mapbox-token';

/**
 * Get the effective Mapbox token.
 * Priority: localStorage (user override) → env var → ''
 * If user explicitly cleared the token (stored empty string), returns ''.
 */
export function getMapboxToken(): string {
  try {
    // If user has ever touched settings, respect their choice (even empty = "no token")
    const stored = localStorage.getItem(MAPBOX_TOKEN_KEY);
    if (stored !== null) return stored;
  } catch { /* ignore */ }
  // Fall back to env var for first-time users
  const envToken = import.meta.env.VITE_MAPBOX_TOKEN || '';
  if (envToken && envToken !== 'YOUR_MAPBOX_TOKEN_HERE') return envToken;
  return '';
}

/**
 * Save a Mapbox token to localStorage.
 * Pass empty string to explicitly disable Mapbox (use free tiles).
 */
export function setMapboxToken(token: string): void {
  try {
    localStorage.setItem(MAPBOX_TOKEN_KEY, token);
  } catch { /* ignore */ }
}

/**
 * Remove the localStorage override so the env var takes effect again.
 */
export function resetMapboxToken(): void {
  try {
    localStorage.removeItem(MAPBOX_TOKEN_KEY);
  } catch { /* ignore */ }
}

export function hasMapboxToken(): boolean {
  return getMapboxToken().length > 0;
}

/**
 * Whether the current token comes from the env var (not user-overridden).
 */
export function isEnvToken(): boolean {
  try {
    if (localStorage.getItem(MAPBOX_TOKEN_KEY) !== null) return false;
  } catch { /* ignore */ }
  const envToken = import.meta.env.VITE_MAPBOX_TOKEN || '';
  return !!(envToken && envToken !== 'YOUR_MAPBOX_TOKEN_HERE');
}

// ── Free tile styles (no API key) ──

/** CARTO Dark Matter — dark basemap, free, no key required */
const CARTO_DARK: StyleSpecification = {
  version: 8,
  sources: {
    'carto-dark': {
      type: 'raster',
      tiles: [
        'https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png',
        'https://b.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png',
        'https://c.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png',
      ],
      tileSize: 256,
      attribution: '&copy; <a href="https://carto.com/">CARTO</a> &copy; <a href="https://www.openstreetmap.org/copyright">OSM</a>',
    },
  },
  layers: [
    {
      id: 'carto-dark-layer',
      type: 'raster',
      source: 'carto-dark',
      minzoom: 0,
      maxzoom: 20,
    },
  ],
  glyphs: 'https://fonts.openmaptiles.org/{fontstack}/{range}.pbf',
};

/** CARTO Positron — clean light basemap, free, no key required */
const CARTO_POSITRON: StyleSpecification = {
  version: 8,
  sources: {
    'carto-positron': {
      type: 'raster',
      tiles: [
        'https://a.basemaps.cartocdn.com/light_all/{z}/{x}/{y}@2x.png',
        'https://b.basemaps.cartocdn.com/light_all/{z}/{x}/{y}@2x.png',
        'https://c.basemaps.cartocdn.com/light_all/{z}/{x}/{y}@2x.png',
      ],
      tileSize: 256,
      attribution: '&copy; <a href="https://carto.com/">CARTO</a> &copy; <a href="https://www.openstreetmap.org/copyright">OSM</a>',
    },
  },
  layers: [
    {
      id: 'carto-positron-layer',
      type: 'raster',
      source: 'carto-positron',
      minzoom: 0,
      maxzoom: 20,
    },
  ],
  glyphs: 'https://fonts.openmaptiles.org/{fontstack}/{range}.pbf',
};

/** CARTO Voyager — light/terrain-like basemap, free, no key required */
const CARTO_VOYAGER: StyleSpecification = {
  version: 8,
  sources: {
    'carto-voyager': {
      type: 'raster',
      tiles: [
        'https://a.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}@2x.png',
        'https://b.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}@2x.png',
        'https://c.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}@2x.png',
      ],
      tileSize: 256,
      attribution: '&copy; <a href="https://carto.com/">CARTO</a> &copy; <a href="https://www.openstreetmap.org/copyright">OSM</a>',
    },
  },
  layers: [
    {
      id: 'carto-voyager-layer',
      type: 'raster',
      source: 'carto-voyager',
      minzoom: 0,
      maxzoom: 20,
    },
  ],
  glyphs: 'https://fonts.openmaptiles.org/{fontstack}/{range}.pbf',
};

/** ESRI World Imagery — satellite tiles, free */
const ESRI_SATELLITE: StyleSpecification = {
  version: 8,
  sources: {
    'esri-satellite': {
      type: 'raster',
      tiles: [
        'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
      ],
      tileSize: 256,
      attribution: '&copy; Esri',
    },
  },
  layers: [
    {
      id: 'esri-satellite-layer',
      type: 'raster',
      source: 'esri-satellite',
      minzoom: 0,
      maxzoom: 19,
    },
  ],
  glyphs: 'https://fonts.openmaptiles.org/{fontstack}/{range}.pbf',
};

/** OpenStreetMap standard — the classic free map */
const OSM_STANDARD: StyleSpecification = {
  version: 8,
  sources: {
    'osm': {
      type: 'raster',
      tiles: [
        'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
      ],
      tileSize: 256,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    },
  },
  layers: [
    {
      id: 'osm-layer',
      type: 'raster',
      source: 'osm',
      minzoom: 0,
      maxzoom: 19,
    },
  ],
  glyphs: 'https://fonts.openmaptiles.org/{fontstack}/{range}.pbf',
};

/** OpenTopoMap — topographic map with elevation contours, free */
const OPEN_TOPO: StyleSpecification = {
  version: 8,
  sources: {
    'opentopomap': {
      type: 'raster',
      tiles: [
        'https://a.tile.opentopomap.org/{z}/{x}/{y}.png',
        'https://b.tile.opentopomap.org/{z}/{x}/{y}.png',
        'https://c.tile.opentopomap.org/{z}/{x}/{y}.png',
      ],
      tileSize: 256,
      attribution: '&copy; <a href="https://opentopomap.org">OpenTopoMap</a> &copy; <a href="https://www.openstreetmap.org/copyright">OSM</a>',
    },
  },
  layers: [
    {
      id: 'opentopomap-layer',
      type: 'raster',
      source: 'opentopomap',
      minzoom: 0,
      maxzoom: 17,
    },
  ],
  glyphs: 'https://fonts.openmaptiles.org/{fontstack}/{range}.pbf',
};

// ── Mapbox raster tile styles via Static Tiles API ──
// MapLibre cannot directly consume Mapbox vector tile styles (mapbox:// URIs,
// strict style validation). Instead we use the Mapbox Static Tiles API which
// renders the full Mapbox style as raster tiles — same visual quality, no
// protocol compatibility issues.

function mapboxRasterStyle(styleId: string, token: string): StyleSpecification {
  // Use tileSize=256 so MapLibre requests at the correct zoom level (not z-1).
  // The @2x suffix gives retina quality (512px actual pixels per 256-unit tile),
  // resulting in sharper imagery than free sources at every zoom level.
  return {
    version: 8,
    sources: {
      'mapbox-raster': {
        type: 'raster',
        tiles: [
          `https://api.mapbox.com/styles/v1/mapbox/${styleId}/tiles/256/{z}/{x}/{y}@2x?access_token=${token}`,
        ],
        tileSize: 256,
        maxzoom: 22,
        attribution: '&copy; <a href="https://www.mapbox.com/">Mapbox</a> &copy; <a href="https://www.openstreetmap.org/copyright">OSM</a>',
      },
    },
    layers: [
      {
        id: 'mapbox-raster-layer',
        type: 'raster',
        source: 'mapbox-raster',
        minzoom: 0,
        maxzoom: 22,
      },
    ],
    // Use Mapbox font glyphs so custom symbol layers (unit labels etc.) render correctly
    glyphs: `https://api.mapbox.com/fonts/v1/mapbox/{fontstack}/{range}.pbf?access_token=${token}`,
  };
}

// ── Style resolver ──

export type MapStyleKey =
  | 'dark'
  | 'satellite'
  | 'terrain'
  | 'light'
  | 'osm'
  | 'topo';

/** Style keys that have a Mapbox premium variant */
export type MapboxUpgradeable = 'dark' | 'satellite' | 'terrain';
/** Set of style keys that have Mapbox premium upgrades */
export const MAPBOX_UPGRADEABLE_KEYS: ReadonlySet<MapStyleKey> = new Set<MapStyleKey>(['dark', 'satellite', 'terrain']);
const MAPBOX_STYLE_IDS: Record<MapboxUpgradeable, string> = {
  dark: 'dark-v11',
  satellite: 'satellite-streets-v12',
  terrain: 'outdoors-v12',
};

/** All free tile styles — used when no Mapbox token, or for sources without a Mapbox variant */
const FREE_STYLES: Record<MapStyleKey, StyleSpecification> = {
  dark: CARTO_DARK,
  satellite: ESRI_SATELLITE,
  terrain: CARTO_VOYAGER,
  light: CARTO_POSITRON,
  osm: OSM_STANDARD,
  topo: OPEN_TOPO,
};

/** Free tile source names for display — indicates provider when Mapbox is not used */
export const FREE_SOURCE_NAMES: Record<MapStyleKey, string> = {
  dark: 'CARTO',
  satellite: 'ESRI',
  terrain: 'CARTO',
  light: 'CARTO',
  osm: 'OSM',
  topo: 'OpenTopo',
};

/** Ordered list of all style keys for the UI selector */
export const ALL_STYLE_KEYS: MapStyleKey[] = [
  'dark', 'satellite', 'terrain', 'light', 'osm', 'topo',
];

/**
 * Get the map style for a given key.
 * With Mapbox token: uses Mapbox Static Tiles API for dark/satellite/terrain.
 * Without token (or for other sources): uses free raster tiles.
 */
export function getMapStyle(key: MapStyleKey): StyleSpecification {
  const token = getMapboxToken();

  // Only dark/satellite/terrain have Mapbox premium variants
  if (token && key in MAPBOX_STYLE_IDS) {
    return mapboxRasterStyle(MAPBOX_STYLE_IDS[key as MapboxUpgradeable], token);
  }

  return FREE_STYLES[key];
}

export const DEFAULT_STYLE: MapStyleKey = 'satellite';

/**
 * Whether the given style key resolves to free (non-Mapbox) tiles.
 * True when no token is set, or the style has no Mapbox premium variant.
 */
export function isFreeTileStyle(styleKey: MapStyleKey): boolean {
  return !hasMapboxToken() || !MAPBOX_UPGRADEABLE_KEYS.has(styleKey);
}
