import { create } from 'zustand';

export type HotspotType = 'firefight' | 'killstreak' | 'mass_casualty' | 'engagement' | 'bombardment';

export const ALL_HOTSPOT_TYPES: HotspotType[] = [
  'firefight',
  'killstreak',
  'mass_casualty',
  'engagement',
  'bombardment',
];

interface HotspotFilterState {
  /** Show hotspot debug circles on the map */
  debugOverlay: boolean;
  /** Per-type visibility filters (true = visible) */
  typeFilters: Record<HotspotType, boolean>;

  toggleDebugOverlay: () => void;
  toggleTypeFilter: (type: HotspotType) => void;
  setTypeFilter: (type: HotspotType, enabled: boolean) => void;
}

export const useHotspotFilter = create<HotspotFilterState>((set) => ({
  debugOverlay: false,
  typeFilters: {
    firefight: true,
    killstreak: true,
    mass_casualty: true,
    engagement: true,
    bombardment: true,
  },

  toggleDebugOverlay: () => set((s) => ({ debugOverlay: !s.debugOverlay })),

  toggleTypeFilter: (type) =>
    set((s) => ({
      typeFilters: { ...s.typeFilters, [type]: !s.typeFilters[type] },
    })),

  setTypeFilter: (type, enabled) =>
    set((s) => ({
      typeFilters: { ...s.typeFilters, [type]: enabled },
    })),
}));
