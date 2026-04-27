import { create } from 'zustand';

export type HotspotType = 'firefight' | 'killstreak' | 'mass_casualty' | 'engagement' | 'bombardment' | 'long_range';

export const ALL_HOTSPOT_TYPES: HotspotType[] = [
  'firefight',
  'killstreak',
  'mass_casualty',
  'engagement',
  'bombardment',
  'long_range',
];

export type PersonalEventType = 'p_kill' | 'p_hit' | 'p_killed' | 'p_hit_recv' | 'p_heal' | 'p_revive';

export const ALL_PERSONAL_EVENT_TYPES: PersonalEventType[] = [
  'p_kill',
  'p_hit',
  'p_killed',
  'p_hit_recv',
  'p_heal',
  'p_revive',
];

interface HotspotFilterState {
  /** Show hotspot debug circles on the map */
  debugOverlay: boolean;
  /** Master switch — when false, ALL hotspots are hidden regardless of
   *  per-type filters. Toggling it back on restores the previous per-type
   *  selection without resetting anything. */
  masterEnabled: boolean;
  /** Per-type visibility filters (true = visible) */
  typeFilters: Record<HotspotType, boolean>;
  /** Per-personal-event-type visibility filters (used when manually following a unit) */
  personalTypeFilters: Record<PersonalEventType, boolean>;

  toggleDebugOverlay: () => void;
  toggleMasterEnabled: () => void;
  toggleTypeFilter: (type: HotspotType) => void;
  setTypeFilter: (type: HotspotType, enabled: boolean) => void;
  togglePersonalTypeFilter: (type: PersonalEventType) => void;
}

export const useHotspotFilter = create<HotspotFilterState>((set) => ({
  debugOverlay: false,
  masterEnabled: true,
  typeFilters: {
    firefight: true,
    killstreak: true,
    mass_casualty: true,
    engagement: true,
    bombardment: true,
    long_range: true,
  },
  personalTypeFilters: {
    p_kill: true,
    p_hit: true,
    p_killed: true,
    p_hit_recv: true,
    p_heal: true,
    p_revive: true,
  },

  toggleDebugOverlay: () => set((s) => ({ debugOverlay: !s.debugOverlay })),

  toggleMasterEnabled: () => set((s) => ({ masterEnabled: !s.masterEnabled })),

  toggleTypeFilter: (type) =>
    set((s) => ({
      typeFilters: { ...s.typeFilters, [type]: !s.typeFilters[type] },
    })),

  setTypeFilter: (type, enabled) =>
    set((s) => ({
      typeFilters: { ...s.typeFilters, [type]: enabled },
    })),

  togglePersonalTypeFilter: (type) =>
    set((s) => ({
      personalTypeFilters: { ...s.personalTypeFilters, [type]: !s.personalTypeFilters[type] },
    })),
}));
