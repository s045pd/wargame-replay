import { usePlayback } from '../../../store/playback';
import { useVisualConfig } from '../../../store/visualConfig';
import { useI18n } from '../../../lib/i18n';
import { SettingToggle } from '../controls/SettingToggle';
import { SettingSlider } from '../controls/SettingSlider';
import { SettingGroup } from '../controls/SettingGroup';

export function EffectsTab() {
  const { t } = useI18n();
  const pb = usePlayback();
  const vc = useVisualConfig();

  return (
    <div>
      <SettingGroup title={t('fx_revive')}>
        <SettingToggle label={t('fx_revive')} value={pb.reviveEffectEnabled} onChange={pb.setReviveEffectEnabled} />
        <SettingSlider label={t('settings_revive_duration')} value={vc.reviveDuration} onChange={(v) => vc.set('reviveDuration', v)} min={0.3} max={3} step={0.1} unit="s" />
        <SettingSlider label={t('settings_revive_intensity')} value={vc.reviveIntensity} onChange={(v) => vc.set('reviveIntensity', v)} min={0.1} max={1} step={0.05} />
      </SettingGroup>

      <SettingGroup title={t('fx_heal')}>
        <SettingToggle label={t('fx_heal')} value={pb.healEffectEnabled} onChange={pb.setHealEffectEnabled} />
        <SettingSlider label={t('settings_heal_duration')} value={vc.healDuration} onChange={(v) => vc.set('healDuration', v)} min={0.3} max={3} step={0.1} unit="s" />
        <SettingSlider label={t('settings_heal_glow_size')} value={vc.healGlowSize} onChange={(v) => vc.set('healGlowSize', v)} min={1} max={3} step={0.1} unit="x" />
      </SettingGroup>

      <SettingGroup title={t('fx_hit_feedback')}>
        <SettingToggle label={t('fx_hit_feedback')} value={pb.hitFeedbackEnabled} onChange={pb.setHitFeedbackEnabled} />
        <SettingSlider label={t('settings_hit_flash_duration')} value={vc.hitFlashDuration} onChange={(v) => vc.set('hitFlashDuration', v)} min={0.1} max={1} step={0.05} unit="s" />
        <SettingSlider label={t('settings_hit_flash_intensity')} value={vc.hitFlashIntensity} onChange={(v) => vc.set('hitFlashIntensity', v)} min={0.1} max={1} step={0.05} />
      </SettingGroup>

      <SettingGroup title={t('fx_death')}>
        <SettingToggle label={t('fx_death')} value={pb.deathEffectEnabled} onChange={pb.setDeathEffectEnabled} />
        <SettingSlider label={t('settings_death_duration')} value={vc.deathDuration} onChange={(v) => vc.set('deathDuration', v)} min={0.5} max={5} step={0.1} unit="s" />
        <SettingSlider label={t('settings_death_scale')} value={vc.deathScale} onChange={(v) => vc.set('deathScale', v)} min={0.5} max={3} step={0.1} unit="x" />
      </SettingGroup>

      <SettingGroup title={t('settings_bombing_radius')}>
        <SettingToggle label={t('settings_bombing_radius')} value={vc.bombingRadius} onChange={(v) => vc.set('bombingRadius', v)} />
        <SettingSlider label={t('settings_bombing_duration')} value={vc.bombingDuration} onChange={(v) => vc.set('bombingDuration', v)} min={0.5} max={5} step={0.1} unit="s" />
      </SettingGroup>
    </div>
  );
}
