import { useState } from 'react';
import { usePlayback } from '../../../store/playback';
import { useVisualConfig } from '../../../store/visualConfig';
import { useI18n } from '../../../lib/i18n';
import { ALL_STYLE_KEYS, getMapboxToken, setMapboxToken, resetMapboxToken, hasMapboxToken, isEnvToken } from '../../../map/styles';
import type { MapStyleKey } from '../../../map/styles';
import { SettingToggle } from '../controls/SettingToggle';
import { SettingSlider } from '../controls/SettingSlider';
import { SettingSelect } from '../controls/SettingSelect';
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
        <SettingSelect
          label={t('map_source')}
          value={mapStyle}
          onChange={(v) => setMapStyle(v as MapStyleKey)}
          options={ALL_STYLE_KEYS.map((k) => ({ value: k, label: t(`style_${k}`) }))}
        />
        <SettingToggle label={t('tilt_mode')} value={tiltMode} onChange={() => toggleTiltMode()} />
        <SettingToggle label={t('settings_globe_projection')} value={vc.globeProjection} onChange={(v) => vc.set('globeProjection', v)} />
      </SettingGroup>

      <SettingGroup title={t('settings_intro_animation')}>
        <SettingToggle label={t('settings_intro_animation')} value={vc.introAnimation} onChange={(v) => vc.set('introAnimation', v)} />
        <SettingSlider label={t('settings_intro_duration')} value={vc.introDuration} onChange={(v) => vc.set('introDuration', v)} min={1} max={8} step={0.5} unit="s" />
        <SettingSlider label={t('settings_intro_pitch')} value={vc.introPitch} onChange={(v) => vc.set('introPitch', v)} min={0} max={60} unit="°" />
        <SettingSlider label={t('settings_intro_bearing')} value={vc.introBearing} onChange={(v) => vc.set('introBearing', v)} min={-180} max={180} unit="°" />
      </SettingGroup>

      <SettingGroup title={t('settings_max_zoom')}>
        <SettingSlider label={t('settings_max_zoom')} value={vc.maxZoom} onChange={(v) => vc.set('maxZoom', v)} min={10} max={22} />
        <SettingSlider label={t('settings_bounds_padding')} value={vc.boundsPadding} onChange={(v) => vc.set('boundsPadding', v)} min={5} max={30} unit="%" />
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
        <div className="flex items-center gap-2 mt-2 text-[10px]">
          <span className={`w-2 h-2 rounded-full ${hasMapboxToken() ? 'bg-emerald-500' : 'bg-amber-500'}`} />
          <span className="text-zinc-500">{t('tile_provider')}: {hasMapboxToken() ? 'Mapbox' : t('free_tiles')}</span>
        </div>
      </SettingGroup>
    </div>
  );
}
