export const MAP_STYLES = {
  dark: 'mapbox://styles/mapbox/dark-v11',
  satellite: 'mapbox://styles/mapbox/satellite-streets-v12',
  terrain: 'mapbox://styles/mapbox/outdoors-v12',
} as const;

export type MapStyleKey = keyof typeof MAP_STYLES;

export const DEFAULT_STYLE: MapStyleKey = 'dark';
