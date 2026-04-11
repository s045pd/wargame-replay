import { create } from 'zustand';
import {
  fetchVideoStatus,
  fetchVideoCandidates,
  fetchVideoGroups,
  createVideoGroup,
  updateVideoGroup,
  deleteVideoGroup,
  rescanVideos,
  type VideoStatus,
  type VideoGroup,
  type CandidateGroup,
  type CreateVideoGroupPayload,
  type UpdateVideoGroupPayload,
} from '../lib/api';
import { usePlayback } from './playback';

const LS_KEY = 'wargame-video';

interface PerGamePrefs {
  activeGroupIds: string[];
  cardStates: Record<string, CardState>;
}

interface StoredPrefs {
  autoActivateOnSelect: boolean;
  byGame: Record<string, PerGamePrefs>;
}

const DEFAULT_CARD: CardState = {
  x: -1,
  y: -1,
  w: 360,
  h: 220,
  minimized: false,
  muted: true,
};

function loadPrefs(): StoredPrefs {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return { autoActivateOnSelect: true, byGame: {} };
    const parsed = JSON.parse(raw) as Partial<StoredPrefs>;
    return {
      autoActivateOnSelect: parsed.autoActivateOnSelect ?? true,
      byGame: parsed.byGame ?? {},
    };
  } catch {
    return { autoActivateOnSelect: true, byGame: {} };
  }
}

function savePrefs(prefs: StoredPrefs): void {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(prefs));
  } catch {
    /* ignore quota errors */
  }
}

const _prefs = loadPrefs();

export interface CardState {
  x: number;
  y: number;
  w: number;
  h: number;
  minimized: boolean;
  muted: boolean;
}

interface VideosState {
  // Server feature status
  serverEnabled: boolean;
  rootDir: string;
  segmentCount: number;
  scanning: boolean;
  statusError: string | null;

  // Per-game data
  gameId: string | null;
  candidates: CandidateGroup[];
  candidatesLoading: boolean;
  candidatesError: string | null;
  groups: VideoGroup[];
  groupsLoading: boolean;
  groupsError: string | null;

  // Per-game UI state
  activeGroupIds: string[];
  cardStates: Record<string, CardState>;

  // Global prefs
  autoActivateOnSelect: boolean;

  // Actions
  loadStatus: () => Promise<void>;
  rescan: () => Promise<void>;
  loadForGame: (gameId: string) => Promise<void>;
  clearGame: () => void;

  createGroup: (payload: CreateVideoGroupPayload) => Promise<VideoGroup | null>;
  updateGroup: (groupId: string, patch: UpdateVideoGroupPayload) => Promise<void>;
  deleteGroup: (groupId: string) => Promise<void>;

  setActive: (groupId: string, active: boolean) => void;
  setActiveGroupIds: (ids: string[]) => void;
  updateCardState: (groupId: string, patch: Partial<CardState>) => void;

  setAutoActivate: (value: boolean) => void;
}

function persistForGame(gameId: string, activeGroupIds: string[], cardStates: Record<string, CardState>): void {
  const current = loadPrefs();
  current.byGame[gameId] = { activeGroupIds, cardStates };
  savePrefs(current);
}

export const useVideos = create<VideosState>((set, get) => ({
  serverEnabled: false,
  rootDir: '',
  segmentCount: 0,
  scanning: false,
  statusError: null,

  gameId: null,
  candidates: [],
  candidatesLoading: false,
  candidatesError: null,
  groups: [],
  groupsLoading: false,
  groupsError: null,

  activeGroupIds: [],
  cardStates: {},

  autoActivateOnSelect: _prefs.autoActivateOnSelect,

  async loadStatus() {
    try {
      const status: VideoStatus = await fetchVideoStatus();
      set({
        serverEnabled: status.enabled,
        rootDir: status.rootDir,
        segmentCount: status.segmentCount,
        scanning: status.scanning,
        statusError: null,
      });
    } catch (err: unknown) {
      set({
        serverEnabled: false,
        statusError: err instanceof Error ? err.message : String(err),
      });
    }
  },

  async rescan() {
    const current = get();
    if (!current.serverEnabled) return;
    set({ scanning: true });
    try {
      const status = await rescanVideos();
      set({
        serverEnabled: status.enabled,
        rootDir: status.rootDir,
        segmentCount: status.segmentCount,
        scanning: status.scanning,
        statusError: null,
      });
      const g = get().gameId;
      if (g) await get().loadForGame(g);
    } catch (err: unknown) {
      set({
        scanning: false,
        statusError: err instanceof Error ? err.message : String(err),
      });
    }
  },

  async loadForGame(gameId: string) {
    // Hydrate persistent UI state for this game.
    const prefs = loadPrefs();
    const perGame = prefs.byGame[gameId] ?? { activeGroupIds: [], cardStates: {} };

    set({
      gameId,
      candidates: [],
      candidatesLoading: true,
      candidatesError: null,
      groups: [],
      groupsLoading: true,
      groupsError: null,
      activeGroupIds: perGame.activeGroupIds,
      cardStates: perGame.cardStates,
    });

    const [candResult, groupsResult] = await Promise.allSettled([
      fetchVideoCandidates(gameId),
      fetchVideoGroups(gameId),
    ]);

    if (candResult.status === 'fulfilled') {
      set({ candidates: candResult.value, candidatesLoading: false });
    } else {
      set({
        candidates: [],
        candidatesLoading: false,
        candidatesError:
          candResult.reason instanceof Error ? candResult.reason.message : String(candResult.reason),
      });
    }

    if (groupsResult.status === 'fulfilled') {
      // Drop stale active ids that no longer correspond to a group.
      const validIds = new Set(groupsResult.value.map((g) => g.id));
      const filteredActive = get().activeGroupIds.filter((id) => validIds.has(id));
      set({
        groups: groupsResult.value,
        groupsLoading: false,
        activeGroupIds: filteredActive,
      });
      if (filteredActive.length !== get().activeGroupIds.length + 0) {
        persistForGame(gameId, filteredActive, get().cardStates);
      }
    } else {
      set({
        groups: [],
        groupsLoading: false,
        groupsError:
          groupsResult.reason instanceof Error ? groupsResult.reason.message : String(groupsResult.reason),
      });
    }
  },

  clearGame() {
    set({
      gameId: null,
      candidates: [],
      groups: [],
      activeGroupIds: [],
      cardStates: {},
    });
  },

  async createGroup(payload) {
    const gameId = get().gameId;
    if (!gameId) return null;
    try {
      const g = await createVideoGroup(gameId, payload);
      set((state) => ({ groups: [...state.groups, g] }));
      return g;
    } catch (err: unknown) {
      set({ groupsError: err instanceof Error ? err.message : String(err) });
      return null;
    }
  },

  async updateGroup(groupId, patch) {
    const gameId = get().gameId;
    if (!gameId) return;
    try {
      const updated = await updateVideoGroup(gameId, groupId, patch);
      set((state) => ({
        groups: state.groups.map((g) => (g.id === groupId ? updated : g)),
      }));
    } catch (err: unknown) {
      set({ groupsError: err instanceof Error ? err.message : String(err) });
    }
  },

  async deleteGroup(groupId) {
    const gameId = get().gameId;
    if (!gameId) return;
    try {
      await deleteVideoGroup(gameId, groupId);
      set((state) => {
        const activeGroupIds = state.activeGroupIds.filter((id) => id !== groupId);
        const cardStates = { ...state.cardStates };
        delete cardStates[groupId];
        persistForGame(gameId, activeGroupIds, cardStates);
        return {
          groups: state.groups.filter((g) => g.id !== groupId),
          activeGroupIds,
          cardStates,
        };
      });
    } catch (err: unknown) {
      set({ groupsError: err instanceof Error ? err.message : String(err) });
    }
  },

  setActive(groupId, active) {
    const state = get();
    if (!state.gameId) return;
    const isActive = state.activeGroupIds.includes(groupId);
    if (active && !isActive) {
      const activeGroupIds = [...state.activeGroupIds, groupId];
      set({ activeGroupIds });
      persistForGame(state.gameId, activeGroupIds, state.cardStates);
    } else if (!active && isActive) {
      const activeGroupIds = state.activeGroupIds.filter((id) => id !== groupId);
      set({ activeGroupIds });
      persistForGame(state.gameId, activeGroupIds, state.cardStates);
    }
  },

  setActiveGroupIds(ids) {
    const state = get();
    if (!state.gameId) return;
    set({ activeGroupIds: ids });
    persistForGame(state.gameId, ids, state.cardStates);
  },

  updateCardState(groupId, patch) {
    const state = get();
    if (!state.gameId) return;
    const existing = state.cardStates[groupId] ?? { ...DEFAULT_CARD };
    const next = { ...existing, ...patch };
    const cardStates = { ...state.cardStates, [groupId]: next };
    set({ cardStates });
    persistForGame(state.gameId, state.activeGroupIds, cardStates);
  },

  setAutoActivate(value) {
    set({ autoActivateOnSelect: value });
    const prefs = loadPrefs();
    prefs.autoActivateOnSelect = value;
    savePrefs(prefs);
  },
}));

/** Default card state used when the user first activates a group. */
export function defaultCardState(index: number): CardState {
  return {
    ...DEFAULT_CARD,
    x: -1,
    y: -1,
    w: DEFAULT_CARD.w,
    h: DEFAULT_CARD.h + index * 0,
  };
}

/** Helper to read a group's card state with sensible defaults. */
export function getCardState(groupId: string): CardState {
  const s = useVideos.getState();
  return s.cardStates[groupId] ?? { ...DEFAULT_CARD };
}

/**
 * Subscribe to selectedUnitId changes so that picking a unit in the map
 * auto-activates any video groups recorded from that unit.
 *
 * Returns an unsubscribe function. Call this once from a top-level
 * component's useEffect with an empty dep array.
 */
export function subscribeAutoActivate(): () => void {
  return usePlayback.subscribe((state, prev) => {
    const vs = useVideos.getState();
    if (!vs.autoActivateOnSelect) return;
    if (!vs.serverEnabled || !vs.gameId) return;
    const id = state.selectedUnitId;
    if (id == null) return;
    if (id === prev.selectedUnitId) return;
    const matching = vs.groups.filter((g) => g.unitId === id);
    if (matching.length === 0) return;
    const matchingIds = matching.map((g) => g.id);
    // Only reset if the active set isn't already exactly these groups.
    const current = new Set(vs.activeGroupIds);
    let needsUpdate = matchingIds.length !== current.size;
    if (!needsUpdate) {
      for (const m of matchingIds) {
        if (!current.has(m)) {
          needsUpdate = true;
          break;
        }
      }
    }
    if (needsUpdate) {
      vs.setActiveGroupIds(matchingIds);
    }
  });
}
