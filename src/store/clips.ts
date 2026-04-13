// ── Clips/bookmarks store for lite mode (localStorage-backed) ──

import { create } from 'zustand';

export interface Bookmark {
  ts: string;
  title: string;
  tags: string[];
}

export interface Clip {
  startTs: string;
  endTs: string;
  title: string;
  speed: number;
  tags: string[];
}

export interface ClipExport {
  clip: Clip;
  timestamps: string[];
  frames?: unknown[];
}

interface ClipsState {
  bookmarks: Bookmark[];
  clips: Clip[];
  selectedClipId: string | null;

  // Bookmark actions
  loadBookmarks: (gameId: string) => Promise<void>;
  addBookmark: (gameId: string, bookmark: Bookmark) => Promise<void>;
  deleteBookmark: (gameId: string, idx: number) => Promise<void>;
  loadSuggestions: (gameId: string) => Promise<Bookmark[]>;
  setSelectedClipId: (id: string | null) => void;

  // Clip actions
  loadClips: (gameId: string) => Promise<void>;
  addClip: (gameId: string, clip: Clip) => Promise<void>;
  updateClip: (gameId: string, idx: number, clip: Clip) => Promise<void>;
  deleteClip: (gameId: string, idx: number) => Promise<void>;
  exportClip: (gameId: string, idx: number, full?: boolean) => Promise<ClipExport>;
}

function lsKey(gameId: string, kind: string): string {
  return `wargame-lite-${kind}-${gameId}`;
}

function readLS<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch { return fallback; }
}

function writeLS(key: string, data: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(data));
  } catch { /* quota exceeded — ignore */ }
}

export const useClips = create<ClipsState>((set, get) => ({
  bookmarks: [],
  clips: [],
  selectedClipId: null,

  loadBookmarks: async (gameId) => {
    const bookmarks = readLS<Bookmark[]>(lsKey(gameId, 'bookmarks'), []);
    set({ bookmarks });
  },

  addBookmark: async (gameId, bookmark) => {
    const updated = [...get().bookmarks, bookmark];
    writeLS(lsKey(gameId, 'bookmarks'), updated);
    set({ bookmarks: updated });
  },

  deleteBookmark: async (gameId, idx) => {
    const updated = get().bookmarks.filter((_, i) => i !== idx);
    writeLS(lsKey(gameId, 'bookmarks'), updated);
    set({ bookmarks: updated });
  },

  loadSuggestions: async () => {
    // No server-side suggestions in lite mode
    return [];
  },

  setSelectedClipId: (id) => set({ selectedClipId: id }),

  loadClips: async (gameId) => {
    const clips = readLS<Clip[]>(lsKey(gameId, 'clips'), []);
    set({ clips });
  },

  addClip: async (gameId, clip) => {
    const updated = [...get().clips, clip];
    writeLS(lsKey(gameId, 'clips'), updated);
    set({ clips: updated });
  },

  updateClip: async (gameId, idx, clip) => {
    const updated = get().clips.map((c, i) => (i === idx ? clip : c));
    writeLS(lsKey(gameId, 'clips'), updated);
    set({ clips: updated });
  },

  deleteClip: async (gameId, idx) => {
    const updated = get().clips.filter((_, i) => i !== idx);
    writeLS(lsKey(gameId, 'clips'), updated);
    set({ clips: updated });
  },

  exportClip: async (_gameId, idx) => {
    const clip = get().clips[idx];
    if (!clip) throw new Error(`Clip ${idx} not found`);
    return { clip, timestamps: [] };
  },
}));
