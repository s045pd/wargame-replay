import { useEffect, useState } from 'react';
import { useClips, Bookmark } from '../store/clips';
import { usePlayback } from '../store/playback';

interface BookmarkListProps {
  onClose: () => void;
}

export function BookmarkList({ onClose }: BookmarkListProps) {
  const { gameId, seek } = usePlayback();
  const { bookmarks, loadBookmarks, deleteBookmark, loadSuggestions } = useClips();
  const [suggestions, setSuggestions] = useState<Bookmark[]>([]);
  const [tab, setTab] = useState<'bookmarks' | 'suggestions'>('bookmarks');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!gameId) return;
    setLoading(true);
    setError(null);
    loadBookmarks(gameId)
      .catch((e: unknown) => setError(String(e)))
      .finally(() => setLoading(false));
  }, [gameId, loadBookmarks]);

  const handleLoadSuggestions = async () => {
    if (!gameId) return;
    setLoading(true);
    setError(null);
    try {
      const s = await loadSuggestions(gameId);
      setSuggestions(s);
      setTab('suggestions');
    } catch (e: unknown) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (idx: number) => {
    if (!gameId) return;
    try {
      await deleteBookmark(gameId, idx);
    } catch (e: unknown) {
      setError(String(e));
    }
  };

  const handleSeek = (ts: string) => {
    seek(ts);
    onClose();
  };

  const displayList: Bookmark[] = tab === 'bookmarks' ? bookmarks : suggestions;

  return (
    <div className="fixed inset-y-0 right-0 w-80 bg-zinc-900 border-l border-zinc-700 flex flex-col z-50 shadow-2xl">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-700">
        <h2 className="text-sm font-bold text-zinc-100 tracking-wider">BOOKMARKS</h2>
        <button
          onClick={onClose}
          className="text-zinc-400 hover:text-zinc-100 text-lg leading-none transition-colors"
          title="Close"
        >
          ×
        </button>
      </div>

      {/* Tab bar */}
      <div className="flex border-b border-zinc-700">
        <button
          onClick={() => setTab('bookmarks')}
          className={`flex-1 py-2 text-xs font-medium transition-colors ${
            tab === 'bookmarks'
              ? 'text-blue-400 border-b-2 border-blue-400'
              : 'text-zinc-400 hover:text-zinc-200'
          }`}
        >
          My Bookmarks ({bookmarks.length})
        </button>
        <button
          onClick={handleLoadSuggestions}
          className={`flex-1 py-2 text-xs font-medium transition-colors ${
            tab === 'suggestions'
              ? 'text-amber-400 border-b-2 border-amber-400'
              : 'text-zinc-400 hover:text-zinc-200'
          }`}
        >
          Auto-Suggest
        </button>
      </div>

      {/* Error */}
      {error && (
        <div className="mx-4 mt-2 px-3 py-2 bg-red-900/50 border border-red-700 rounded text-xs text-red-300">
          {error}
        </div>
      )}

      {/* List */}
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center h-24 text-zinc-500 text-sm">
            Loading…
          </div>
        ) : displayList.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-24 text-zinc-500 text-xs">
            {tab === 'bookmarks' ? (
              <>
                <p>No bookmarks yet.</p>
                <p className="mt-1 text-zinc-600">Press B to add one.</p>
              </>
            ) : (
              <p>No hotspot suggestions found.</p>
            )}
          </div>
        ) : (
          <ul className="divide-y divide-zinc-800">
            {displayList.map((bm, idx) => (
              <li
                key={`${bm.ts}-${idx}`}
                className="group flex items-start gap-2 px-4 py-3 hover:bg-zinc-800 transition-colors"
              >
                {/* Seek button area (click on text) */}
                <button
                  onClick={() => handleSeek(bm.ts)}
                  className="flex-1 text-left min-w-0"
                  title={`Seek to ${bm.ts}`}
                >
                  <div className="text-xs font-mono text-blue-400 truncate">{bm.ts}</div>
                  <div className="text-sm text-zinc-200 mt-0.5 truncate">{bm.title}</div>
                  {bm.tags.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-1">
                      {bm.tags.map((tag) => (
                        <span
                          key={tag}
                          className="px-1.5 py-0.5 bg-zinc-700 text-zinc-400 text-xs rounded"
                        >
                          {tag}
                        </span>
                      ))}
                    </div>
                  )}
                </button>

                {/* Delete button — only for user bookmarks */}
                {tab === 'bookmarks' && (
                  <button
                    onClick={() => void handleDelete(idx)}
                    className="opacity-0 group-hover:opacity-100 text-zinc-500 hover:text-red-400 transition-all mt-0.5 flex-shrink-0"
                    title="Delete bookmark"
                  >
                    ×
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Footer */}
      <div className="px-4 py-3 border-t border-zinc-700 text-xs text-zinc-500">
        Press <kbd className="px-1 py-0.5 bg-zinc-800 rounded text-zinc-400">B</kbd> to bookmark current time
      </div>
    </div>
  );
}
