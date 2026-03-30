import { create } from 'zustand';

export interface Bookmark {
  ts: string;
  title: string;
  tags: string[];
}

interface ClipsState {
  bookmarks: Bookmark[];
  selectedClipId: string | null;

  // Actions
  loadBookmarks: (gameId: string) => Promise<void>;
  addBookmark: (gameId: string, bookmark: Bookmark) => Promise<void>;
  deleteBookmark: (gameId: string, idx: number) => Promise<void>;
  loadSuggestions: (gameId: string) => Promise<Bookmark[]>;
  setSelectedClipId: (id: string | null) => void;
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
}));
