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
    unitTags, setUnitTagsBatch, clearUnitTagsByGroup, clearAllUnitTags,
    customTagColors, recolorTagGroup, registerCustomTagColor,
  } = usePlayback();
  const { mode, setMode } = useDirector();
  const { locale, setLocale, t } = useI18n();

  const isGeoMode = coordMode === 'wgs84';

  // Quick label-filter input — opens next to PlayerSearch on toggle, clears
  // the filter when closed so the rest of the app reverts to default labels.
  const [filterOpen, setFilterOpen] = useState(false);
  const [palettePopover, setPalettePopover] = useState(false);
  const [tagsPopover, setTagsPopover] = useState(false);
  // null = closed; otherwise the (color, filter) group being recolored.
  const [recolorTarget, setRecolorTarget] = useState<{ color: string; filter: string } | null>(null);
  // Pending custom-color editor — non-null = picker is open. `hex` updates as
  // the user adjusts the OS color input but isn't applied until they hit
  // confirm; avoids spamming icon registration + re-renders while picking.
  const [customPicker, setCustomPicker] = useState<
    | { kind: 'apply'; hex: string }
    | { kind: 'recolor'; oldColor: string; filter: string; hex: string }
    | null
  >(null);
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

  // Active tag groups — one row per (color, filter) combination so the user
  // can see which filter word produced each batch and clear them individually.
  const tagGroups = useMemo(() => {
    const groups = new Map<string, { color: string; filter: string; count: number }>();
    for (const tag of Object.values(unitTags)) {
      const key = `${tag.color}|${tag.filter}`;
      const existing = groups.get(key);
      if (existing) existing.count++;
      else groups.set(key, { color: tag.color, filter: tag.filter, count: 1 });
    }
    return Array.from(groups.values()).sort((a, b) => {
      const ai = TAG_COLORS.findIndex(c => c.key === a.color);
      const bi = TAG_COLORS.findIndex(c => c.key === b.color);
      return ai - bi || a.filter.localeCompare(b.filter);
    });
  }, [unitTags]);

  const applyTagToMatches = (colorKey: string) => {
    if (filterMatches.length === 0) return;
    const patch: Record<number, { color: string; name: string; filter: string }> = {};
    const f = labelFilter.trim();
    for (const m of filterMatches) {
      patch[m.id] = {
        color: colorKey,
        name: transformFilteredName(m.name, f) || m.name,
        filter: f,
      };
    }
    setUnitTagsBatch(patch);
    setLabelFilter('');
    setPalettePopover(false);
  };

  /** Open the inline custom-color editor for either a new tag or recoloring a group. */
  const openCustomPicker = (
    target: { kind: 'apply' } | { kind: 'recolor'; oldColor: string; filter: string },
  ) => {
    if (target.kind === 'apply') {
      setCustomPicker({ kind: 'apply', hex: '#a855f7' });
    } else {
      setCustomPicker({
        kind: 'recolor',
        oldColor: target.oldColor,
        filter: target.filter,
        hex: customTagColors[target.oldColor] ?? TAG_COLORS.find(c => c.key === target.oldColor)?.hex ?? '#a855f7',
      });
    }
  };

  /** Confirm button — registers the picked color and applies/recolors once. */
  const confirmCustomColor = () => {
    if (!customPicker) return;
    const hex = customPicker.hex;
    if (!/^#[0-9a-fA-F]{6}$/.test(hex)) { setCustomPicker(null); return; }
    const key = `custom-${hex.slice(1).toLowerCase()}`;
    registerCustomTagColor(key, hex);
    if (customPicker.kind === 'apply') {
      applyTagToMatches(key);
    } else {
      recolorTagGroup(customPicker.oldColor, customPicker.filter, key);
      setRecolorTarget(null);
    }
    setCustomPicker(null);
  };

  /** Resolve a tag color key to its display hex (preset or custom). */
  const resolveTagHex = (key: string): string => {
    return TAG_COLORS.find(c => c.key === key)?.hex ?? customTagColors[key] ?? '#888';
  };

  /** Render a preset+custom palette popover. `onPick` receives a registered color key. */
  const renderPalettePopover = (
    onPick: (colorKey: string) => void,
    onPickCustom: () => void,
    customMode: { hex: string; setHex: (h: string) => void } | null,
  ) => (
    <div className="absolute top-full left-0 mt-1 z-50 bg-zinc-900 border border-zinc-700 rounded shadow-lg p-2 flex gap-1.5 items-center">
      {!customMode && TAG_COLORS.map((c) => (
        <button
          key={c.key}
          onClick={() => onPick(c.key)}
          className="w-5 h-5 rounded-full border border-zinc-800 hover:scale-110 transition-transform"
          style={{ backgroundColor: c.hex }}
          title={c.label}
        />
      ))}
      {!customMode && <div className="w-px h-4 bg-zinc-700" />}
      {!customMode && (
        <button
          onClick={onPickCustom}
          className="w-5 h-5 rounded-full border border-zinc-700 bg-gradient-to-br from-pink-500 via-yellow-400 to-cyan-400 hover:scale-110 transition-transform flex items-center justify-center text-[10px] text-zinc-900 font-bold"
          title={t('label_filter_custom_color')}
        >
          +
        </button>
      )}
      {customMode && (
        <>
          <input
            type="color"
            value={customMode.hex}
            onChange={(e) => customMode.setHex(e.target.value)}
            className="w-7 h-6 bg-transparent border border-zinc-700 rounded cursor-pointer"
          />
          <span
            className="w-5 h-5 rounded-full border border-zinc-800"
            style={{ backgroundColor: customMode.hex }}
            title={customMode.hex}
          />
          <button
            onClick={confirmCustomColor}
            className="px-2 h-6 rounded text-[11px] bg-emerald-700 hover:bg-emerald-600 text-white"
            title={t('label_filter_confirm')}
          >
            ✓
          </button>
          <button
            onClick={() => setCustomPicker(null)}
            className="px-2 h-6 rounded text-[11px] bg-zinc-800 hover:bg-zinc-700 text-zinc-400"
            title={t('label_filter_cancel')}
          >
            ×
          </button>
        </>
      )}
    </div>
  );

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
              {palettePopover && filterMatches.length > 0 && renderPalettePopover(
                (key) => applyTagToMatches(key),
                () => openCustomPicker({ kind: 'apply' }),
                customPicker?.kind === 'apply'
                  ? { hex: customPicker.hex, setHex: (h) => setCustomPicker({ kind: 'apply', hex: h }) }
                  : null,
              )}
            </div>
          )}
          {/* Tags summary popover — visible whenever any tag exists. */}
          {tagGroups.length > 0 && (
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
                  {tagGroups.map((g) => (
                    <span
                      key={`${g.color}|${g.filter}`}
                      className="w-1.5 h-1.5 rounded-full"
                      style={{ backgroundColor: resolveTagHex(g.color) }}
                    />
                  ))}
                </span>
              </button>
              {tagsPopover && (
                <div className="absolute top-full left-0 mt-1 z-50 bg-zinc-900 border border-zinc-700 rounded shadow-lg p-2 min-w-[220px]">
                  {tagGroups.map((g) => {
                    const isRecoloring = recolorTarget && recolorTarget.color === g.color && recolorTarget.filter === g.filter;
                    return (
                      <div key={`${g.color}|${g.filter}`} className="relative">
                        <div className="flex items-center gap-2 py-0.5 text-xs">
                          <button
                            onClick={() => setRecolorTarget(isRecoloring ? null : { color: g.color, filter: g.filter })}
                            className="w-3 h-3 rounded-full shrink-0 ring-offset-1 ring-offset-zinc-900 hover:ring-1 hover:ring-zinc-400 transition-shadow"
                            style={{ backgroundColor: resolveTagHex(g.color) }}
                            title={t('label_filter_recolor')}
                          />
                          <span className="font-mono text-zinc-300 truncate flex-1" title={g.filter || '(empty filter)'}>
                            {g.filter || '—'}
                          </span>
                          <span className="text-zinc-500 text-[10px]">{g.count}</span>
                          <button
                            onClick={() => clearUnitTagsByGroup(g.color, g.filter)}
                            className="text-zinc-500 hover:text-red-400 transition-colors px-1"
                            title={t('label_filter_clear_color')}
                          >
                            ×
                          </button>
                        </div>
                        {isRecoloring && renderPalettePopover(
                          (key) => { recolorTagGroup(g.color, g.filter, key); setRecolorTarget(null); },
                          () => openCustomPicker({ kind: 'recolor', oldColor: g.color, filter: g.filter }),
                          customPicker?.kind === 'recolor'
                            && customPicker.oldColor === g.color
                            && customPicker.filter === g.filter
                            ? {
                                hex: customPicker.hex,
                                setHex: (h) => setCustomPicker({ kind: 'recolor', oldColor: g.color, filter: g.filter, hex: h }),
                              }
                            : null,
                        )}
                      </div>
                    );
                  })}
                  <div className="border-t border-zinc-800 mt-1 pt-1">
                    <button
                      onClick={() => { clearAllUnitTags(); setTagsPopover(false); setRecolorTarget(null); }}
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
