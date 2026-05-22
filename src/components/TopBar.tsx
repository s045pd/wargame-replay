import { useEffect, useMemo, useRef, useState } from 'react';
import { usePlayback } from '../store/playback';
import { useDirector } from '../store/director';
import { useI18n } from '../lib/i18n';
import { ALL_STYLE_KEYS, MapStyleKey } from '../map/styles';
import { PlayerSearch } from '../map/PlayerSearch';
import { TAG_COLORS } from '../map/unitIcons';
import { transformFilteredName } from '../lib/labelTransform';

interface TopBarProps {
  onShowShortcuts?: () => void;
  onShowSettings?: () => void;
  onToggleClips?: () => void;
  clipsOpen?: boolean;
}

export function TopBar({ onShowShortcuts, onShowSettings, onToggleClips, clipsOpen }: TopBarProps) {
  const {
    meta, coordMode, mapStyle, setMapStyle, tiltMode, toggleTiltMode,
    resetGame, setSelectedUnitId, setFollowSelectedUnit, setManualFollow,
    labelFilter, setLabelFilter,
    unitTags, setUnitTagsBatch, clearUnitTagsByColor, clearAllUnitTags,
  } = usePlayback();
  const { mode, setMode } = useDirector();
  const { locale, setLocale, t } = useI18n();

  const isGeoMode = coordMode === 'wgs84';

  // Quick label-filter input — opens next to PlayerSearch on toggle, clears
  // the filter when closed so the rest of the app reverts to default labels.
  const [filterOpen, setFilterOpen] = useState(false);
  const [palettePopover, setPalettePopover] = useState(false);
  const [tagsPopover, setTagsPopover] = useState(false);
  const filterInputRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    if (filterOpen) filterInputRef.current?.focus();
  }, [filterOpen]);
  const closeFilter = () => {
    setLabelFilter('');
    setFilterOpen(false);
    setPalettePopover(false);
  };

  // Players whose name matches the current filter — drives the palette CTA.
  const filterMatches = useMemo(() => {
    const f = labelFilter.trim().toLowerCase();
    if (!f || !meta) return [] as { id: number; name: string }[];
    return meta.players
      .filter(p => p.name.toLowerCase().includes(f))
      .map(p => ({ id: p.id, name: p.name }));
  }, [labelFilter, meta]);

  // Active tag colors with their unit counts — for the tags popover.
  const tagSummary = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const tag of Object.values(unitTags)) {
      counts[tag.color] = (counts[tag.color] ?? 0) + 1;
    }
    return TAG_COLORS
      .filter(c => counts[c.key] > 0)
      .map(c => ({ ...c, count: counts[c.key] }));
  }, [unitTags]);

  const applyTagToMatches = (colorKey: string) => {
    if (filterMatches.length === 0) return;
    const patch: Record<number, { color: string; name: string }> = {};
    const f = labelFilter.trim();
    for (const m of filterMatches) {
      patch[m.id] = { color: colorKey, name: transformFilteredName(m.name, f) || m.name };
    }
    setUnitTagsBatch(patch);
    setLabelFilter('');
    setPalettePopover(false);
  };

  return (
    <div className="h-12 bg-zinc-900 border-b border-zinc-800 flex items-center px-4 gap-4">
      <button
        onClick={resetGame}
        className="flex items-center gap-1.5 text-xs text-zinc-400 hover:text-zinc-100 transition-colors"
        title={t('games')}
      >
        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
        </svg>
        {t('games')}
      </button>
      <div className="h-4 w-px bg-zinc-700" />
      <div className="text-sm font-bold text-zinc-100 tracking-wider">
        {t('app_title')}
      </div>
      <div className="h-4 w-px bg-zinc-700" />
      {meta && (
        <div className="text-xs text-zinc-400">
          {meta.players.length} {t('players')} · {coordMode}
        </div>
      )}
      {meta && meta.players.length > 0 && (
        <>
          <div className="h-4 w-px bg-zinc-700" />
          {/* Quick label-filter: toggle reveals an input that filters which
              unit names render on the map in real time. */}
          <button
            onClick={() => (filterOpen ? closeFilter() : setFilterOpen(true))}
            className={`w-6 h-6 flex items-center justify-center rounded text-xs transition-colors border ${
              filterOpen || labelFilter
                ? 'bg-sky-700 text-sky-100 border-sky-600'
                : 'bg-zinc-800 hover:bg-zinc-700 text-zinc-400 border-zinc-700'
            }`}
            title={t('label_filter_toggle')}
            aria-pressed={filterOpen || !!labelFilter}
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707L14 14v6l-4-2v-4L3.293 7.293A1 1 0 013 6.586V4z" />
            </svg>
          </button>
          {filterOpen && (
            <input
              ref={filterInputRef}
              value={labelFilter}
              onChange={(e) => setLabelFilter(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Escape') closeFilter(); }}
              placeholder={t('label_filter_placeholder')}
              className="w-32 bg-zinc-800 border border-zinc-700 text-zinc-200 text-xs rounded px-2 py-0.5 focus:outline-none focus:ring-1 focus:ring-sky-600"
            />
          )}
          {/* Color palette dropdown — enabled when current filter has matches. */}
          {filterOpen && (
            <div className="relative">
              <button
                onClick={() => setPalettePopover((v) => !v)}
                disabled={filterMatches.length === 0}
                className={`px-1.5 h-6 flex items-center gap-1 rounded text-[11px] transition-colors border ${
                  filterMatches.length === 0
                    ? 'bg-zinc-800/50 text-zinc-600 border-zinc-800 cursor-not-allowed'
                    : palettePopover
                      ? 'bg-zinc-700 text-zinc-100 border-zinc-600'
                      : 'bg-zinc-800 hover:bg-zinc-700 text-zinc-300 border-zinc-700'
                }`}
                title={t('label_filter_tag_with')}
              >
                {t('label_filter_tag_with')}
                <span className="text-zinc-500">{filterMatches.length}</span>
              </button>
              {palettePopover && filterMatches.length > 0 && (
                <div className="absolute top-full left-0 mt-1 z-50 bg-zinc-900 border border-zinc-700 rounded shadow-lg p-2 flex gap-1.5">
                  {TAG_COLORS.map((c) => (
                    <button
                      key={c.key}
                      onClick={() => applyTagToMatches(c.key)}
                      className="w-5 h-5 rounded-full border border-zinc-800 hover:scale-110 transition-transform"
                      style={{ backgroundColor: c.hex }}
                      title={`${c.label} · ${filterMatches.length}`}
                    />
                  ))}
                </div>
              )}
            </div>
          )}
          {/* Tags summary popover — visible whenever any tag exists. */}
          {tagSummary.length > 0 && (
            <div className="relative">
              <button
                onClick={() => setTagsPopover((v) => !v)}
                className={`px-1.5 h-6 flex items-center gap-1 rounded text-[11px] transition-colors border ${
                  tagsPopover
                    ? 'bg-zinc-700 text-zinc-100 border-zinc-600'
                    : 'bg-zinc-800 hover:bg-zinc-700 text-zinc-300 border-zinc-700'
                }`}
                title={t('label_filter_tags_popover')}
              >
                {t('label_filter_tags_popover')}
                <span className="flex gap-0.5">
                  {tagSummary.map((t) => (
                    <span
                      key={t.key}
                      className="w-1.5 h-1.5 rounded-full"
                      style={{ backgroundColor: t.hex }}
                    />
                  ))}
                </span>
              </button>
              {tagsPopover && (
                <div className="absolute top-full left-0 mt-1 z-50 bg-zinc-900 border border-zinc-700 rounded shadow-lg p-2 min-w-[160px]">
                  {tagSummary.map((tag) => (
                    <div key={tag.key} className="flex items-center gap-2 py-0.5 text-xs">
                      <span
                        className="w-3 h-3 rounded-full shrink-0"
                        style={{ backgroundColor: tag.hex }}
                      />
                      <span className="flex-1 text-zinc-300">{tag.label}</span>
                      <span className="text-zinc-500 text-[10px]">{tag.count}</span>
                      <button
                        onClick={() => clearUnitTagsByColor(tag.key)}
                        className="text-zinc-500 hover:text-red-400 transition-colors px-1"
                        title={t('label_filter_clear_color')}
                      >
                        ×
                      </button>
                    </div>
                  ))}
                  <div className="border-t border-zinc-800 mt-1 pt-1">
                    <button
                      onClick={() => { clearAllUnitTags(); setTagsPopover(false); }}
                      className="w-full text-[11px] text-zinc-400 hover:text-red-400 transition-colors text-left"
                    >
                      {t('label_filter_clear_all')}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
          <PlayerSearch
            players={meta.players}
            onSelect={(id) => {
              setSelectedUnitId(id);
              setFollowSelectedUnit(true);
              setManualFollow(true);
            }}
          />
        </>
      )}
      <div className="flex-1" />

      {/* Settings button */}
      {onShowSettings && (
        <button
          onClick={onShowSettings}
          className="w-6 h-6 flex items-center justify-center rounded text-xs text-zinc-500 hover:text-zinc-200 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 transition-colors"
          title={`${t('settings')} (,)`}
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
        </button>
      )}

      {/* Shortcuts help button */}
      {onShowShortcuts && (
        <button
          onClick={onShowShortcuts}
          className="w-6 h-6 flex items-center justify-center rounded text-xs font-bold text-zinc-500 hover:text-zinc-200 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 transition-colors"
          title={`${t('shortcut_help')} (?)`}
        >
          ?
        </button>
      )}

      {/* Language toggle */}
      <div className="flex items-center gap-0.5">
        <button
          onClick={() => setLocale('en')}
          className={`px-1.5 py-0.5 text-[10px] rounded transition-colors ${
            locale === 'en'
              ? 'bg-zinc-600 text-white'
              : 'text-zinc-500 hover:text-zinc-300'
          }`}
        >
          EN
        </button>
        <button
          onClick={() => setLocale('zh')}
          className={`px-1.5 py-0.5 text-[10px] rounded transition-colors ${
            locale === 'zh'
              ? 'bg-zinc-600 text-white'
              : 'text-zinc-500 hover:text-zinc-300'
          }`}
        >
          CN
        </button>
      </div>
      <div className="h-4 w-px bg-zinc-700" />

      {/* Map style dropdown + tilt toggle — only for wgs84 geo mode */}
      {isGeoMode && (
        <>
          <select
            value={mapStyle}
            onChange={(e) => setMapStyle(e.target.value as MapStyleKey)}
            className="bg-zinc-800 border border-zinc-700 text-zinc-200 text-xs rounded px-2 py-1 cursor-pointer hover:bg-zinc-700 transition-colors focus:outline-none focus:ring-1 focus:ring-emerald-600"
            title={t('map_source')}
          >
            {ALL_STYLE_KEYS.map(key => (
              <option key={key} value={key}>{t(`style_${key}`)}</option>
            ))}
          </select>
          <button
            onClick={toggleTiltMode}
            className={`px-2 py-1 text-xs rounded transition-colors ${
              tiltMode
                ? 'bg-violet-600 text-white'
                : 'bg-zinc-800 hover:bg-zinc-700 text-zinc-300'
            }`}
            title={`${t('tilt_mode')} (T)`}
          >
            {t('tilt_mode')}
          </button>
          <div className="h-4 w-px bg-zinc-700" />
        </>
      )}

      <div className="flex items-center gap-1">
        <button
          onClick={() => setMode('replay')}
          className={`px-3 py-1 text-xs rounded transition-colors ${
            mode === 'replay'
              ? 'bg-blue-600 text-white'
              : 'bg-zinc-800 hover:bg-zinc-700 text-zinc-300'
          }`}
          title="Tab"
        >
          {t('replay')}
        </button>
        <button
          onClick={() => setMode('director')}
          className={`px-3 py-1 text-xs rounded transition-colors ${
            mode === 'director'
              ? 'bg-amber-600 text-white'
              : 'bg-zinc-800 hover:bg-zinc-700 text-zinc-300'
          }`}
          title="Tab"
        >
          {t('director')}
        </button>
        {onToggleClips && (
          <button
            onClick={onToggleClips}
            className={`px-3 py-1 text-xs rounded transition-colors ${
              clipsOpen
                ? 'bg-emerald-600 text-white'
                : 'bg-zinc-800 hover:bg-zinc-700 text-zinc-300'
            }`}
            title={t('clips_btn_title') || 'Toggle clips panel (C)'}
          >
            {t('clips_btn') || 'Clips'}
          </button>
        )}
      </div>
    </div>
  );
}
