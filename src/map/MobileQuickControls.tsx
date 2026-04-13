/**
 * MobileQuickControls — vertical floating button strip for mobile map view.
 *
 * Adds three quick-access controls that are otherwise missing on mobile because
 * the TopBar (search) and director-mode-only HotspotControlPanel are hidden:
 *
 *   1. 🔍 Search players   — opens a full-width search sheet
 *   2. 👤 Toggle labels    — instantly flips showUnitLabel
 *   3. 🔥 Hotspot filter   — opens the existing HotspotControlPanel repositioned for mobile
 *
 * Placement: right edge, below the team scoreboard, above the bottom bar.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { usePlayback } from '../store/playback';
import { useVisualConfig } from '../store/visualConfig';
import { useI18n } from '../lib/i18n';
import { HotspotControlPanel } from './HotspotControlPanel';
import { fuzzyScore } from './PlayerSearch';
import type { PlayerInfo } from '../engine/types';

type OpenPanel = 'search' | 'hotspot' | null;

interface MobileSearchSheetProps {
  players: PlayerInfo[];
  onSelect: (unitId: number) => void;
  onClose: () => void;
}

/** Full-width search sheet anchored under the top bar — mobile friendly. */
function MobileSearchSheet({ players, onSelect, onClose }: MobileSearchSheetProps) {
  const [query, setQuery] = useState('');
  const [selectedIdx, setSelectedIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const { t } = useI18n();

  // Autofocus input on open
  useEffect(() => {
    const id = setTimeout(() => inputRef.current?.focus(), 50);
    return () => clearTimeout(id);
  }, []);

  // Escape closes the sheet
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  const results = useMemo(() => {
    if (!query.trim()) return [];
    const q = query.trim();
    const scored: { player: PlayerInfo; score: number }[] = [];
    for (const p of players) {
      const name = p.name || `#${p.id}`;
      const nameScore = fuzzyScore(q, name);
      const idScore = String(p.id).includes(q) ? 70 : 0;
      const score = Math.max(nameScore, idScore);
      if (score > 0) scored.push({ player: p, score });
    }
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, 30);
  }, [query, players]);

  useEffect(() => setSelectedIdx(0), [results]);

  return (
    <>
      {/* Full-screen backdrop — tap to close */}
      <div
        className="absolute inset-0 z-30 bg-black/40 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Sheet — anchored near the top, full width with safe insets */}
      <div
        className="absolute z-40 left-2 right-2 top-2 bg-zinc-900/95 border border-zinc-700 rounded-lg shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Search input */}
        <div className="flex items-center gap-2 px-3 py-2.5 border-b border-zinc-800">
          <svg className="w-4 h-4 text-zinc-500 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('search_placeholder')}
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
            data-form-type="other"
            data-lpignore="true"
            data-1p-ignore
            className="flex-1 min-w-0 bg-transparent text-sm text-zinc-200 outline-none placeholder:text-zinc-600"
          />
          <button
            onClick={onClose}
            className="text-zinc-500 active:text-zinc-200 text-xs px-2 py-1 border border-zinc-700 rounded shrink-0"
          >
            {t('close')}
          </button>
        </div>

        {/* Results list */}
        {query.trim() && results.length === 0 && (
          <div className="px-3 py-6 text-xs text-zinc-600 text-center">{t('no_results')}</div>
        )}
        {results.length > 0 && (
          <div className="max-h-[60vh] overflow-y-auto py-1">
            {results.map(({ player }, idx) => (
              <button
                key={player.id}
                onClick={() => onSelect(player.id)}
                className={`w-full text-left px-3 py-2.5 transition-colors flex items-center gap-2 text-sm ${
                  idx === selectedIdx ? 'bg-zinc-700/60 text-zinc-100' : 'text-zinc-300 active:bg-zinc-800'
                }`}
              >
                <span
                  className="w-2.5 h-2.5 rounded-full shrink-0"
                  style={{
                    backgroundColor:
                      player.team === 'red' ? '#ff4444' : player.team === 'blue' ? '#00ccff' : '#aaa',
                  }}
                />
                <span className="font-medium truncate">{player.name || `#${player.id}`}</span>
                <span className="text-zinc-600 text-[11px] ml-auto shrink-0">#{player.id}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </>
  );
}

/**
 * Vertical floating control strip + popover panels for mobile map view.
 */
export function MobileQuickControls() {
  const {
    meta,
    setSelectedUnitId,
    setFollowSelectedUnit,
    setManualFollow,
  } = usePlayback();
  const showUnitLabel = useVisualConfig((s) => s.showUnitLabel);
  const setVc = useVisualConfig((s) => s.set);
  const { t } = useI18n();
  const [open, setOpen] = useState<OpenPanel>(null);

  const hasPlayers = !!(meta?.players && meta.players.length > 0);

  const togglePanel = (panel: Exclude<OpenPanel, null>) => {
    setOpen((cur) => (cur === panel ? null : panel));
  };

  const handlePlayerSelect = (id: number) => {
    setSelectedUnitId(id);
    setFollowSelectedUnit(true);
    setManualFollow(true);
    setOpen(null);
  };

  return (
    <>
      {/* Vertical button strip — right edge, below team scoreboard */}
      <div className="absolute top-[72px] right-2 z-20 flex flex-col gap-1.5 pointer-events-auto">
        {hasPlayers && (
          <button
            onClick={() => togglePanel('search')}
            className={`w-9 h-9 flex items-center justify-center rounded-md border backdrop-blur-sm transition-colors ${
              open === 'search'
                ? 'bg-cyan-700/80 border-cyan-500 text-white'
                : 'bg-zinc-900/90 border-zinc-700 text-zinc-300 active:bg-zinc-800'
            }`}
            title={t('search_players')}
            aria-label={t('search_players')}
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
          </button>
        )}

        <button
          onClick={() => setVc('showUnitLabel', !showUnitLabel)}
          className={`w-9 h-9 flex items-center justify-center rounded-md border backdrop-blur-sm transition-colors ${
            showUnitLabel
              ? 'bg-emerald-700/80 border-emerald-500 text-white'
              : 'bg-zinc-900/90 border-zinc-700 text-zinc-300 active:bg-zinc-800'
          }`}
          title={t('settings_show_unit_label')}
          aria-label={t('settings_show_unit_label')}
          aria-pressed={showUnitLabel}
        >
          {/* "Aa" label icon — suggests text/name display */}
          <span className="text-[11px] font-bold leading-none tracking-tight">Aa</span>
        </button>

        <button
          onClick={() => togglePanel('hotspot')}
          className={`w-9 h-9 flex items-center justify-center rounded-md border backdrop-blur-sm transition-colors ${
            open === 'hotspot'
              ? 'bg-amber-700/80 border-amber-500 text-white'
              : 'bg-zinc-900/90 border-zinc-700 text-zinc-300 active:bg-zinc-800'
          }`}
          title={t('hotspot_filter')}
          aria-label={t('hotspot_filter')}
        >
          {/* Flame icon */}
          <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
            <path d="M12 2s-4.5 5-4.5 9a4.5 4.5 0 009 0c0-1.5-.8-3.2-2-4.5.2 1.3-.4 2.3-1.3 2.3-.8 0-1.2-.7-1.2-1.6 0-1.8 1.2-3 1.2-5.2 0-.6-.2-.8-1.2 0z" />
          </svg>
        </button>
      </div>

      {/* Hotspot control panel — repositioned for mobile */}
      {open === 'hotspot' && (
        <>
          {/* Tap outside to close */}
          <div
            className="absolute inset-0 z-10"
            onClick={() => setOpen(null)}
          />
          <HotspotControlPanel
            className="absolute top-[72px] right-14 z-20 bg-zinc-900/95 border border-zinc-700 rounded-md px-2.5 py-2 text-xs font-mono backdrop-blur-sm min-w-[170px] max-w-[calc(100vw-5rem)] shadow-xl"
          />
        </>
      )}

      {/* Player search sheet */}
      {open === 'search' && hasPlayers && meta && (
        <MobileSearchSheet
          players={meta.players}
          onSelect={handlePlayerSelect}
          onClose={() => setOpen(null)}
        />
      )}
    </>
  );
}
