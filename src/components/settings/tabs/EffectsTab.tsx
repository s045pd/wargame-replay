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
        <SettingToggle label={t('fx_revive')} description={t('settings_desc_revive_effect')} value={pb.reviveEffectEnabled} onChange={pb.setReviveEffectEnabled} />
        {pb.reviveEffectEnabled && (
          <>
            <SettingSlider label={t('settings_revive_duration')} description={t('settings_desc_revive_duration')} value={vc.reviveDuration} onChange={(v) => vc.set('reviveDuration', v)} min={0.1} max={3} step={0.1} unit="s" />
            <SettingSlider label={t('settings_revive_intensity')} description={t('settings_desc_revive_intensity')} value={vc.reviveIntensity} onChange={(v) => vc.set('reviveIntensity', v)} min={0} max={1} step={0.05} />
            <SettingSlider label={t('settings_revive_ring_size')} description={t('settings_desc_revive_ring_size')} value={vc.reviveRingSize} onChange={(v) => vc.set('reviveRingSize', v)} min={0} max={40} step={1} unit="px" />
          </>
        )}
      </SettingGroup>

      <SettingGroup title={t('fx_heal')}>
        <SettingToggle label={t('fx_heal')} description={t('settings_desc_heal_effect')} value={pb.healEffectEnabled} onChange={pb.setHealEffectEnabled} />
        {pb.healEffectEnabled && (
          <>
            <SettingSlider label={t('settings_heal_duration')} description={t('settings_desc_heal_duration')} value={vc.healDuration} onChange={(v) => vc.set('healDuration', v)} min={0.1} max={3} step={0.1} unit="s" />
            <SettingSlider label={t('settings_heal_glow_size')} description={t('settings_desc_heal_glow_size')} value={vc.healGlowSize} onChange={(v) => vc.set('healGlowSize', v)} min={0.5} max={3} step={0.1} unit="x" />
          </>
        )}
      </SettingGroup>

      <SettingGroup title={t('fx_hit_feedback')}>
        <SettingToggle label={t('fx_hit_feedback')} description={t('settings_desc_hit_feedback')} value={pb.hitFeedbackEnabled} onChange={pb.setHitFeedbackEnabled} />
        {pb.hitFeedbackEnabled && (
          <>
            <SettingSlider label={t('settings_hit_flash_duration')} description={t('settings_desc_hit_flash_duration')} value={vc.hitFlashDuration} onChange={(v) => vc.set('hitFlashDuration', v)} min={0.05} max={1} step={0.05} unit="s" />
            <SettingSlider label={t('settings_hit_flash_intensity')} description={t('settings_desc_hit_flash_intensity')} value={vc.hitFlashIntensity} onChange={(v) => vc.set('hitFlashIntensity', v)} min={0} max={1} step={0.05} />
            <SettingSlider label={t('settings_hit_ring_size')} description={t('settings_desc_hit_ring_size')} value={vc.hitRingSize} onChange={(v) => vc.set('hitRingSize', v)} min={0} max={30} step={1} unit="px" />
          </>
        )}
      </SettingGroup>

      <SettingGroup title={t('fx_death')}>
        <SettingToggle label={t('fx_death')} description={t('settings_desc_death_effect')} value={pb.deathEffectEnabled} onChange={pb.setDeathEffectEnabled} />
        {pb.deathEffectEnabled && (
          <>
            <SettingSlider label={t('settings_death_duration')} description={t('settings_desc_death_duration')} value={vc.deathDuration} onChange={(v) => vc.set('deathDuration', v)} min={0.2} max={5} step={0.1} unit="s" />
            <SettingSlider label={t('settings_death_scale')} description={t('settings_desc_death_scale')} value={vc.deathScale} onChange={(v) => vc.set('deathScale', v)} min={0.2} max={3} step={0.1} unit="x" />
            <SettingSlider label={t('settings_death_ring_size')} description={t('settings_desc_death_ring_size')} value={vc.deathRingSize} onChange={(v) => vc.set('deathRingSize', v)} min={0} max={40} step={1} unit="px" />
          </>
        )}
      </SettingGroup>

      <SettingGroup title={t('settings_bombing_radius')}>
        <SettingToggle label={t('settings_bombing_radius')} description={t('settings_desc_bombing_radius')} value={vc.bombingRadius} onChange={(v) => vc.set('bombingRadius', v)} />
        {vc.bombingRadius && (
          <SettingSlider label={t('settings_bombing_duration')} description={t('settings_desc_bombing_duration')} value={vc.bombingDuration} onChange={(v) => vc.set('bombingDuration', v)} min={0.2} max={5} step={0.1} unit="s" />
        )}
      </SettingGroup>
    </div>
  );
}
