import { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { useI18n } from '../lib/i18n';

interface PlayerInfo {
  id: number;
  name: string;
  team: string;
}

interface PlayerSearchProps {
  players: PlayerInfo[];
  onSelect: (unitId: number) => void;
}

/**
 * Fuzzy-match a query against a target string.
 * Returns a score > 0 if matched, 0 if no match.
 */
function fuzzyScore(query: string, target: string): number {
  const q = query.toLowerCase();
  const t = target.toLowerCase();

  if (t === q) return 100;
  if (t.startsWith(q)) return 90;
  if (t.includes(q)) return 80;

  let qi = 0;
  let consecutive = 0;
  let score = 0;
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) {
      qi++;
      consecutive++;
      score += 10 + consecutive * 2;
    } else {
      consecutive = 0;
    }
  }
  return qi === q.length ? score : 0;
}

/**
 * Player search for TopBar — uses static player list from meta (no per-frame updates).
 * Toggle via button or `/` keyboard shortcut.
 * Selecting a result triggers follow mode.
 */
export function PlayerSearch({ players, onSelect }: PlayerSearchProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [selectedIdx, setSelectedIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const { t } = useI18n();

  const results = useMemo(() => {
    if (!query.trim()) return [];
    const q = query.trim();

    const scored: { player: PlayerInfo; score: number }[] = [];
    for (const p of players) {
      const name = p.name || `#${p.id}`;
      const nameScore = fuzzyScore(q, name);
      const idScore = String(p.id).includes(q) ? 70 : 0;
      const score = Math.max(nameScore, idScore);
      if (score > 0) {
        scored.push({ player: p, score });
      }
    }

    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, 15);
  }, [query, players]);

  useEffect(() => setSelectedIdx(0), [results]);

  const close = useCallback(() => {
    setOpen(false);
    setQuery('');
    setSelectedIdx(0);
  }, []);

  const selectPlayer = useCallback((id: number) => {
    onSelect(id);
    close();
  }, [onSelect, close]);

  // Keyboard shortcut: `/` to open, Escape to close
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === '/' && !open && !(e.target instanceof HTMLInputElement) && !(e.target instanceof HTMLTextAreaElement)) {
        e.preventDefault();
        setOpen(true);
      }
      if (e.key === 'Escape' && open) {
        close();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, close]);

  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  // Click outside to close
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        close();
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open, close]);

  const onKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIdx(i => Math.min(i + 1, results.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIdx(i => Math.max(i - 1, 0));
    } else if (e.key === 'Enter' && results.length > 0) {
      e.preventDefault();
      selectPlayer(results[selectedIdx].player.id);
    }
  }, [results, selectedIdx, selectPlayer]);

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-1 px-2 py-1 text-xs text-zinc-400 hover:text-zinc-200 bg-zinc-800 hover:bg-zinc-700 rounded transition-colors"
        title={`${t('search_players')} (/)`}
      >
        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>
        <span>{t('search')}</span>
        <kbd className="text-zinc-600 text-[10px] border border-zinc-700 rounded px-1 ml-0.5">/</kbd>
      </button>
    );
  }

  return (
    <div ref={containerRef} className="relative">
      <div className="flex items-center bg-zinc-800 border border-zinc-600 rounded px-2 py-1 gap-1.5">
        <svg className="w-3.5 h-3.5 text-zinc-500 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={t('search_placeholder')}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          data-form-type="other"
          data-lpignore="true"
          data-1p-ignore
          className="w-44 bg-transparent text-xs text-zinc-200 outline-none placeholder:text-zinc-600"
        />
        <kbd className="text-zinc-600 text-[10px] border border-zinc-700 rounded px-1 cursor-pointer hover:text-zinc-400" onClick={close}>Esc</kbd>
      </div>

      {(query.trim() || results.length > 0) && (
        <div className="absolute top-full left-0 mt-1 w-72 bg-zinc-900/95 border border-zinc-600 rounded-lg shadow-xl backdrop-blur-sm overflow-hidden z-50">
          {query.trim() && results.length === 0 && (
            <div className="px-3 py-3 text-xs text-zinc-600 text-center">{t('no_results')}</div>
          )}

          {results.length > 0 && (
            <div className="max-h-64 overflow-y-auto py-1">
              {results.map(({ player }, idx) => (
                <button
                  key={player.id}
                  onClick={() => selectPlayer(player.id)}
                  className={`w-full text-left px-3 py-1.5 transition-colors flex items-center gap-2 text-xs ${
                    idx === selectedIdx
                      ? 'bg-zinc-700/80 text-zinc-100'
                      : 'hover:bg-zinc-800 text-zinc-300'
                  }`}
                >
                  <span
                    className="w-2 h-2 rounded-full flex-shrink-0"
                    style={{
                      backgroundColor: player.team === 'red' ? '#ff4444' : player.team === 'blue' ? '#00ccff' : '#aaa',
                    }}
                  />
                  <span className="font-medium truncate">
                    {player.name || `#${player.id}`}
                  </span>
                  <span className="text-zinc-600 text-[10px] flex-shrink-0 ml-auto">
                    #{player.id}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
