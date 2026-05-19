// ── Clips/bookmarks store for lite mode (localStorage-backed) ──

import { create } from 'zustand';
import { usePlayback } from './playback';
import type { GameEvent } from '../lib/api';

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

export interface Highlight {
  startTs: string;
  endTs: string;
  title: string;
  score: number;
  events: string[];
  tags: string[];
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

  // Auto-highlight generation (pure frontend — uses playback.allKills)
  loadHighlights: (gameId: string, unitId: number, types?: string[]) => Promise<Highlight[]>;
  importHighlightsAsClips: (gameId: string, highlights: Highlight[]) => Promise<void>;
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

// ── Outplayed-style highlight algorithm (pure frontend port of server/api/highlights.go) ──

interface UnitEvent { ts: string; role: 'kill' | 'hit' | 'killed' | 'hit_recv'; srcName?: string; dstName?: string }

const ROLE_WEIGHT: Record<UnitEvent['role'], number> = {
  kill: 10,
  hit: 2,
  killed: 5,
  hit_recv: 1,
};

const PRE_ROLL_SEC = 8;
const POST_ROLL_SEC = 5;
const MERGE_GAP_SEC = 15;

function parseTimestamp(ts: string): number {
  return new Date(ts.replace(' ', 'T')).getTime() / 1000;
}

function formatTimestamp(epochSec: number): string {
  const d = new Date(epochSec * 1000);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/** Tag each event with the unit's role (kill/hit/killed/hit_recv). */
function unitEventsFromKills(unitId: number, allKills: GameEvent[]): UnitEvent[] {
  const result: UnitEvent[] = [];
  for (const ev of allKills) {
    // Only kill and hit events are relevant for highlights
    if (ev.type !== 'kill' && ev.type !== 'hit') continue;

    let role: UnitEvent['role'] | null = null;
    if (ev.src === unitId) {
      role = ev.type === 'kill' ? 'kill' : 'hit';
    } else if (ev.dst === unitId) {
      role = ev.type === 'kill' ? 'killed' : 'hit_recv';
    }
    if (role !== null) {
      result.push({ ts: ev.ts, role, srcName: ev.srcName, dstName: ev.dstName });
    }
  }
  result.sort((a, b) => parseTimestamp(a.ts) - parseTimestamp(b.ts));
  return result;
}

function parseTypeFilter(types?: string[]): Set<UnitEvent['role']> {
  if (!types || types.length === 0) {
    return new Set(['kill', 'hit', 'killed', 'hit_recv'] as UnitEvent['role'][]);
  }
  const set = new Set<UnitEvent['role']>();
  for (const t of types) {
    // Accept both "p_kill" (frontend format) and "kill" (backend format)
    const cleaned = t.replace(/^p_/, '') as UnitEvent['role'];
    if (cleaned === 'kill' || cleaned === 'hit' || cleaned === 'killed' || cleaned === 'hit_recv') {
      set.add(cleaned);
    }
  }
  return set;
}

function buildTitle(events: UnitEvent[], kills: number): string {
  if (kills >= 4) return 'Quad Kill';
  if (kills >= 3) return 'Triple Kill';
  if (kills >= 2) return 'Double Kill';
  if (kills === 1) {
    for (const ev of events) {
      if (ev.role === 'kill') return `Kill: ${ev.dstName ?? '?'}`;
    }
  }
  for (const ev of events) {
    if (ev.role === 'killed') return `KIA by ${ev.srcName ?? '?'}`;
  }
  if (events.length > 0) return `Combat (${events.length} events)`;
  return 'Highlight';
}

/** Cluster events by temporal proximity, score them, and produce highlights. */
function buildHighlights(events: UnitEvent[]): Highlight[] {
  if (events.length === 0) return [];

  // Cluster events: gap > MERGE_GAP_SEC starts a new cluster
  const clusters: UnitEvent[][] = [];
  let cur: UnitEvent[] = [events[0]];
  for (let i = 1; i < events.length; i++) {
    const prevT = parseTimestamp(cur[cur.length - 1].ts);
    const curT = parseTimestamp(events[i].ts);
    if (curT - prevT > MERGE_GAP_SEC) {
      clusters.push(cur);
      cur = [events[i]];
    } else {
      cur.push(events[i]);
    }
  }
  clusters.push(cur);

  // Convert clusters to highlights
  const highlights: Highlight[] = [];
  for (const cl of clusters) {
    const first = cl[0];
    const last = cl[cl.length - 1];
    const startT = parseTimestamp(first.ts) - PRE_ROLL_SEC;
    const endT = parseTimestamp(last.ts) + POST_ROLL_SEC;

    let score = 0;
    let kills = 0;
    const summaries: string[] = [];
    const tagSet = new Set<string>();

    for (const ev of cl) {
      score += ROLE_WEIGHT[ev.role];
      tagSet.add(ev.role);
      if (ev.role === 'kill') kills++;

      const target = (ev.role === 'kill' || ev.role === 'hit') ? (ev.dstName ?? '?') : (ev.srcName ?? '?');
      summaries.push(`${ev.role}: ${target}`);
    }

    // Multi-kill bonus
    if (kills >= 4) score *= 3.0;
    else if (kills >= 3) score *= 2.0;
    else if (kills >= 2) score *= 1.5;

    highlights.push({
      startTs: formatTimestamp(startT),
      endTs: formatTimestamp(endT),
      title: buildTitle(cl, kills),
      score,
      events: summaries,
      tags: Array.from(tagSet).sort(),
    });
  }

  // Sort by score descending
  highlights.sort((a, b) => b.score - a.score);
  return highlights;
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

  loadHighlights: async (_gameId, unitId, types) => {
    const { allKills } = usePlayback.getState();
    const events = unitEventsFromKills(unitId, allKills);
    if (events.length === 0) return [];
    const typeFilter = parseTypeFilter(types);
    const filtered = events.filter((ev) => typeFilter.has(ev.role));
    if (filtered.length === 0) return [];
    return buildHighlights(filtered);
  },

  importHighlightsAsClips: async (gameId, highlights) => {
    const newClips: Clip[] = highlights.map((h) => ({
      startTs: h.startTs,
      endTs: h.endTs,
      title: h.title,
      speed: 1,
      tags: ['auto', ...h.tags],
    }));
    const updated = [...get().clips, ...newClips];
    writeLS(lsKey(gameId, 'clips'), updated);
    set({ clips: updated });
  },
}));
