import { useVisualConfig } from '../../../store/visualConfig';
import { useI18n } from '../../../lib/i18n';
import { SettingToggle } from '../controls/SettingToggle';
import { SettingSlider } from '../controls/SettingSlider';
import { SettingGroup } from '../controls/SettingGroup';

export function BallisticsTab() {
  const { t } = useI18n();
  const vc = useVisualConfig();

  return (
    <div>
      <SettingGroup title={t('settings_sniper_tracer_enabled')}>
        <SettingToggle label={t('settings_sniper_tracer_enabled')} value={vc.sniperTracerEnabled} onChange={(v) => vc.set('sniperTracerEnabled', v)} />
        <SettingSlider label={t('settings_tracer_speed')} value={vc.tracerSpeed} onChange={(v) => vc.set('tracerSpeed', v)} min={0.5} max={5} step={0.1} unit="x" />
        <SettingSlider label={t('settings_tracer_width')} value={vc.tracerWidth} onChange={(v) => vc.set('tracerWidth', v)} min={1} max={6} step={0.5} unit="px" />
        <SettingSlider label={t('settings_tracer_trail_length')} value={vc.tracerTrailLength} onChange={(v) => vc.set('tracerTrailLength', v)} min={10} max={200} step={5} unit="px" />
        <SettingSlider label={t('settings_tracer_glow')} value={vc.tracerGlow} onChange={(v) => vc.set('tracerGlow', v)} min={0} max={1} step={0.05} />
        <SettingSlider label={t('settings_tracer_duration')} value={vc.tracerDuration} onChange={(v) => vc.set('tracerDuration', v)} min={0.5} max={5} step={0.1} unit="s" />
      </SettingGroup>
    </div>
  );
}
