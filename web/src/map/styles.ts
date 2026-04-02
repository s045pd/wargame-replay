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

// ── Free tile styles (no API key, accessible from China) ──

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

// ── Mapbox raster tile styles via Static Tiles API ──
// MapLibre cannot directly consume Mapbox vector tile styles (mapbox:// URIs,
// strict style validation). Instead we use the Mapbox Static Tiles API which
// renders the full Mapbox style as raster tiles — same visual quality, no
// protocol compatibility issues.

function mapboxRasterStyle(styleId: string, token: string): StyleSpecification {
  return {
    version: 8,
    sources: {
      'mapbox-raster': {
        type: 'raster',
        tiles: [
          `https://api.mapbox.com/styles/v1/mapbox/${styleId}/tiles/512/{z}/{x}/{y}@2x?access_token=${token}`,
        ],
        tileSize: 512,
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

export type MapStyleKey = 'dark' | 'satellite' | 'terrain';

/**
 * Get the map style for a given key.
 * With Mapbox token: uses Mapbox Static Tiles API (high quality rendered raster tiles).
 * Without token: uses free CARTO / ESRI raster tiles (no key, works in China).
 */
export function getMapStyle(key: MapStyleKey): StyleSpecification {
  const token = getMapboxToken();

  if (token) {
    const mapboxStyleIds: Record<MapStyleKey, string> = {
      dark: 'dark-v11',
      satellite: 'satellite-streets-v12',
      terrain: 'outdoors-v12',
    };
    return mapboxRasterStyle(mapboxStyleIds[key], token);
  }

  // Free raster tile fallbacks (no token required, works in China)
  const freeStyles: Record<MapStyleKey, StyleSpecification> = {
    dark: CARTO_DARK,
    satellite: ESRI_SATELLITE,
    terrain: CARTO_VOYAGER,
  };
  return freeStyles[key];
}

export const DEFAULT_STYLE: MapStyleKey = 'dark';
