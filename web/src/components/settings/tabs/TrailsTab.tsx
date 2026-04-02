import { usePlayback } from '../../../store/playback';
import { useVisualConfig } from '../../../store/visualConfig';
import { useI18n } from '../../../lib/i18n';
import { SettingToggle } from '../controls/SettingToggle';
import { SettingSlider } from '../controls/SettingSlider';
import { SettingSelect } from '../controls/SettingSelect';
import { SettingGroup } from '../controls/SettingGroup';

export function TrailsTab() {
  const { t } = useI18n();
  const { trailEnabled, setTrailEnabled, killLineEnabled, setKillLineEnabled, hitLineEnabled, setHitLineEnabled } = usePlayback();
  const vc = useVisualConfig();

  return (
    <div>
      <SettingGroup title={t('fx_trail')}>
        <SettingToggle label={t('fx_trail')} value={trailEnabled} onChange={setTrailEnabled} />
        <SettingSlider label={t('settings_trail_width')} value={vc.trailWidth} onChange={(v) => vc.set('trailWidth', v)} min={1} max={6} step={0.5} unit="px" />
        <SettingSlider label={t('settings_trail_opacity')} value={vc.trailOpacity} onChange={(v) => vc.set('trailOpacity', v)} min={0.1} max={1} step={0.05} />
        <SettingSlider label={t('settings_trail_length')} value={vc.trailLength} onChange={(v) => vc.set('trailLength', v)} min={10} max={500} step={10} />
      </SettingGroup>

      <SettingGroup title={t('fx_kill_line')}>
        <SettingToggle label={t('fx_kill_line')} value={killLineEnabled} onChange={setKillLineEnabled} disabled={!trailEnabled} />
        <SettingSlider label={t('settings_kill_line_width')} value={vc.killLineWidth} onChange={(v) => vc.set('killLineWidth', v)} min={1} max={6} step={0.5} unit="px" />
        <SettingSlider label={t('settings_kill_line_duration')} value={vc.killLineDuration} onChange={(v) => vc.set('killLineDuration', v)} min={0.5} max={10} step={0.5} unit="s" />
        <SettingSelect
          label={t('settings_kill_line_style')}
          value={vc.killLineStyle}
          onChange={(v) => vc.set('killLineStyle', v as 'solid' | 'dashed' | 'pulse')}
          options={[
            { value: 'solid', label: t('settings_style_solid') },
            { value: 'dashed', label: t('settings_style_dashed') },
            { value: 'pulse', label: t('settings_style_pulse') },
          ]}
        />
      </SettingGroup>

      <SettingGroup title={t('fx_hit_line')}>
        <SettingToggle label={t('fx_hit_line')} value={hitLineEnabled} onChange={setHitLineEnabled} disabled={!trailEnabled} />
        <SettingSlider label={t('settings_hit_line_width')} value={vc.hitLineWidth} onChange={(v) => vc.set('hitLineWidth', v)} min={1} max={6} step={0.5} unit="px" />
        <SettingSlider label={t('settings_hit_line_duration')} value={vc.hitLineDuration} onChange={(v) => vc.set('hitLineDuration', v)} min={0.5} max={10} step={0.5} unit="s" />
      </SettingGroup>
    </div>
  );
}
