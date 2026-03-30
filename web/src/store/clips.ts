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

async function apiFetch(path: string, options?: RequestInit) {
  const res = await fetch(path, options);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`API error ${res.status}: ${text}`);
  }
  return res.json();
}

export const useClips = create<ClipsState>((set) => ({
  bookmarks: [],
  clips: [],
  selectedClipId: null,

  loadBookmarks: async (gameId) => {
    const bookmarks = await apiFetch(`/api/games/${gameId}/bookmarks`) as Bookmark[];
    set({ bookmarks });
  },

  addBookmark: async (gameId, bookmark) => {
    const created = await apiFetch(`/api/games/${gameId}/bookmarks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(bookmark),
    }) as Bookmark;
    set((state) => ({ bookmarks: [...state.bookmarks, created] }));
  },

  deleteBookmark: async (gameId, idx) => {
    await apiFetch(`/api/games/${gameId}/bookmarks/${idx}`, {
      method: 'DELETE',
    });
    set((state) => ({
      bookmarks: state.bookmarks.filter((_, i) => i !== idx),
    }));
  },

  loadSuggestions: async (gameId) => {
    const suggestions = await apiFetch(`/api/games/${gameId}/bookmarks/suggest`) as Bookmark[];
    return suggestions;
  },

  setSelectedClipId: (id) => set({ selectedClipId: id }),

  loadClips: async (gameId) => {
    const clips = await apiFetch(`/api/games/${gameId}/clips`) as Clip[];
    set({ clips });
  },

  addClip: async (gameId, clip) => {
    const created = await apiFetch(`/api/games/${gameId}/clips`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(clip),
    }) as Clip;
    set((state) => ({ clips: [...state.clips, created] }));
  },

  updateClip: async (gameId, idx, clip) => {
    const updated = await apiFetch(`/api/games/${gameId}/clips/${idx}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(clip),
    }) as Clip;
    set((state) => ({
      clips: state.clips.map((c, i) => (i === idx ? updated : c)),
    }));
  },

  deleteClip: async (gameId, idx) => {
    await apiFetch(`/api/games/${gameId}/clips/${idx}`, {
      method: 'DELETE',
    });
    set((state) => ({
      clips: state.clips.filter((_, i) => i !== idx),
    }));
  },

  exportClip: async (gameId, idx, full = false) => {
    const url = `/api/games/${gameId}/clips/${idx}/export${full ? '?full=true' : ''}`;
    return apiFetch(url) as Promise<ClipExport>;
  },
}));
