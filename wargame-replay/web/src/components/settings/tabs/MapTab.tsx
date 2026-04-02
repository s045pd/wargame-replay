import { useState } from 'react';
import { usePlayback } from '../../../store/playback';
import { useVisualConfig } from '../../../store/visualConfig';
import { useI18n } from '../../../lib/i18n';
import { ALL_STYLE_KEYS, MAPBOX_UPGRADEABLE_KEYS, FREE_SOURCE_NAMES, getMapboxToken, setMapboxToken, resetMapboxToken, hasMapboxToken, isEnvToken } from '../../../map/styles';
import { SettingToggle } from '../controls/SettingToggle';
import { SettingSlider } from '../controls/SettingSlider';
import { SettingInput } from '../controls/SettingInput';
import { SettingGroup } from '../controls/SettingGroup';

export function MapTab() {
  const { t } = useI18n();
  const { mapStyle, setMapStyle, tiltMode, toggleTiltMode, bumpStyleNonce } = usePlayback();
  const vc = useVisualConfig();

  const [tokenDraft, setTokenDraft] = useState(getMapboxToken());
  const [savedMsg, setSavedMsg] = useState('');

  const saveToken = () => {
    setMapboxToken(tokenDraft);
    bumpStyleNonce();
    setSavedMsg(t('saved'));
    setTimeout(() => setSavedMsg(''), 2000);
  };

  const clearToken = () => {
    setMapboxToken('');
    setTokenDraft('');
    bumpStyleNonce();
  };

  const resetToken = () => {
    resetMapboxToken();
    setTokenDraft(getMapboxToken());
    bumpStyleNonce();
  };

  return (
    <div>
      <SettingGroup title={t('map_source')}>
        {/* Current provider banner */}
        <div className="flex items-center gap-2 mb-2 px-2 py-1.5 rounded bg-zinc-800/80 border border-zinc-700/50">
          <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${hasMapboxToken() ? 'bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.5)]' : 'bg-amber-400 shadow-[0_0_6px_rgba(251,191,36,0.4)]'}`} />
          <span className="text-[11px] font-medium text-zinc-300">
            {t('current_provider')}: {' '}
            <span className={hasMapboxToken() ? 'text-emerald-400' : 'text-amber-400'}>
              {hasMapboxToken() && MAPBOX_UPGRADEABLE_KEYS.has(mapStyle)
                ? 'Mapbox HD'
                : FREE_SOURCE_NAMES[mapStyle] + ' ' + t('free_tiles_short')}
            </span>
          </span>
        </div>

        {/* Style grid */}
        <div className="grid grid-cols-3 gap-1.5 mb-2">
          {ALL_STYLE_KEYS.map((k) => {
            const isActive = k === mapStyle;
            const isMapbox = MAPBOX_UPGRADEABLE_KEYS.has(k);
            const usingMapbox = isMapbox && hasMapboxToken();
            return (
              <button
                key={k}
                onClick={() => setMapStyle(k)}
                className={`relative flex flex-col items-center gap-0.5 px-2 py-2 rounded-md text-[11px] font-medium transition-all border ${
                  isActive
                    ? usingMapbox
                      ? 'bg-emerald-900/40 border-emerald-500/60 text-emerald-300 ring-1 ring-emerald-500/30'
                      : 'bg-blue-900/40 border-blue-500/60 text-blue-300 ring-1 ring-blue-500/30'
                    : 'bg-zinc-800/60 border-zinc-700/40 text-zinc-400 hover:bg-zinc-700/60 hover:text-zinc-200 hover:border-zinc-600/60'
                }`}
              >
                {/* Style name */}
                <span className="leading-tight">{t(`style_${k}`)}</span>
                {/* Provider badge */}
                <span className={`text-[9px] leading-tight px-1 py-0.5 rounded ${
                  isActive
                    ? usingMapbox
                      ? 'bg-emerald-500/20 text-emerald-400'
                      : 'bg-blue-500/20 text-blue-400'
                    : isMapbox && hasMapboxToken()
                      ? 'bg-emerald-500/10 text-emerald-500/70'
                      : 'bg-zinc-700/50 text-zinc-500'
                }`}>
                  {usingMapbox ? '★ Mapbox' : FREE_SOURCE_NAMES[k]}
                </span>
              </button>
            );
          })}
        </div>

        <div className="text-[10px] text-zinc-500 mb-2">{t('settings_desc_map_source')}</div>
        <SettingToggle label={t('tilt_mode')} description={t('settings_desc_tilt_mode')} value={tiltMode} onChange={() => toggleTiltMode()} />
      </SettingGroup>

      <SettingGroup title={t('settings_intro_animation')}>
        <SettingToggle label={t('settings_intro_animation')} description={t('settings_desc_intro_animation')} value={vc.introAnimation} onChange={(v) => vc.set('introAnimation', v)} />
        {vc.introAnimation && (
          <>
            <SettingToggle label={t('settings_globe_projection')} description={t('settings_desc_globe_projection')} value={vc.globeProjection} onChange={(v) => vc.set('globeProjection', v)} />
            <SettingSlider label={t('settings_intro_duration')} description={t('settings_desc_intro_duration')} value={vc.introDuration} onChange={(v) => vc.set('introDuration', v)} min={1} max={15} step={0.5} unit="s" />
            <SettingSlider label={t('settings_intro_pitch')} description={t('settings_desc_intro_pitch')} value={vc.introPitch} onChange={(v) => vc.set('introPitch', v)} min={0} max={60} unit="°" />
            <SettingSlider label={t('settings_intro_bearing')} description={t('settings_desc_intro_bearing')} value={vc.introBearing} onChange={(v) => vc.set('introBearing', v)} min={-180} max={180} unit="°" />
          </>
        )}
      </SettingGroup>

      <SettingGroup title={t('settings_max_zoom')}>
        <SettingSlider label={t('settings_max_zoom')} description={t('settings_desc_max_zoom')} value={vc.maxZoom} onChange={(v) => vc.set('maxZoom', v)} min={10} max={22} />
        <SettingSlider label={t('settings_bounds_padding')} description={t('settings_desc_bounds_padding')} value={vc.boundsPadding} onChange={(v) => vc.set('boundsPadding', v)} min={5} max={30} unit="%" />
      </SettingGroup>

      <SettingGroup title={t('mapbox_token')}>
        <SettingInput
          label={t('mapbox_token')}
          value={tokenDraft}
          onChange={setTokenDraft}
          placeholder="pk.eyJ1Ijo..."
          description={t('mapbox_token_hint')}
        />
        <div className="flex items-center gap-2 mt-2">
          <button onClick={saveToken} className="px-3 py-1 text-xs rounded bg-emerald-700 hover:bg-emerald-600 text-white">{t('save')}</button>
          <button onClick={clearToken} className="px-3 py-1 text-xs rounded bg-zinc-700 hover:bg-zinc-600 text-zinc-300">{t('clear')}</button>
          {isEnvToken() && <button onClick={resetToken} className="px-3 py-1 text-xs rounded bg-zinc-700 hover:bg-zinc-600 text-zinc-300">{t('reset')}</button>}
          {savedMsg && <span className="text-xs text-emerald-400">{savedMsg}</span>}
        </div>
      </SettingGroup>
    </div>
  );
}
