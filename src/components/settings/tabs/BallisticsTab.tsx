import { usePlayback } from '../../../store/playback';
import { useVisualConfig } from '../../../store/visualConfig';
import { useI18n } from '../../../lib/i18n';
import { SettingToggle } from '../controls/SettingToggle';
import { SettingSlider } from '../controls/SettingSlider';
import { SettingSelect } from '../controls/SettingSelect';
import { SettingGroup } from '../controls/SettingGroup';

export function BallisticsTab() {
  const { t } = useI18n();
  const { trailEnabled, setTrailEnabled, killLineEnabled, setKillLineEnabled, hitLineEnabled, setHitLineEnabled } = usePlayback();
  const vc = useVisualConfig();

  return (
    <div>
      {/* Attack trace lines (kill / hit) */}
      <SettingGroup title={t('settings_attack_traces')}>
        <SettingToggle label={t('settings_attack_traces')} description={t('settings_desc_attack_traces')} value={trailEnabled} onChange={setTrailEnabled} />
        {trailEnabled && (
          <>
            {/* Kill traces */}
            <SettingToggle label={t('settings_kill_trace')} description={t('settings_desc_kill_trace')} value={killLineEnabled} onChange={setKillLineEnabled} />
            {killLineEnabled && (
              <>
                <SettingSlider label={t('settings_kill_line_width')} description={t('settings_desc_kill_line_width')} value={vc.killLineWidth} onChange={(v) => vc.set('killLineWidth', v)} min={0.5} max={6} step={0.5} unit="px" />
                <SettingSlider label={t('settings_kill_line_duration')} description={t('settings_desc_kill_line_duration')} value={vc.killLineDuration} onChange={(v) => vc.set('killLineDuration', v)} min={0.2} max={10} step={0.1} unit="s" />
                <SettingSelect
                  label={t('settings_kill_line_style')}
                  description={t('settings_desc_kill_line_style')}
                  value={vc.killLineStyle}
                  onChange={(v) => vc.set('killLineStyle', v as 'solid' | 'dashed' | 'pulse')}
                  options={[
                    { value: 'solid', label: t('settings_style_solid') },
                    { value: 'dashed', label: t('settings_style_dashed') },
                    { value: 'pulse', label: t('settings_style_pulse') },
                  ]}
                />
              </>
            )}

            {/* Hit traces */}
            <SettingToggle label={t('settings_hit_trace')} description={t('settings_desc_hit_trace')} value={hitLineEnabled} onChange={setHitLineEnabled} />
            {hitLineEnabled && (
              <>
                <SettingSlider label={t('settings_hit_line_width')} description={t('settings_desc_hit_line_width')} value={vc.hitLineWidth} onChange={(v) => vc.set('hitLineWidth', v)} min={0.5} max={6} step={0.5} unit="px" />
                <SettingSlider label={t('settings_hit_line_duration')} description={t('settings_desc_hit_line_duration')} value={vc.hitLineDuration} onChange={(v) => vc.set('hitLineDuration', v)} min={0.2} max={10} step={0.1} unit="s" />
              </>
            )}
          </>
        )}
      </SettingGroup>

      {/* Sniper tracer (cinematic long-range bullet flight) */}
      <SettingGroup title={t('settings_sniper_tracer_enabled')}>
        <SettingToggle label={t('settings_sniper_tracer_enabled')} description={t('settings_desc_sniper_tracer_enabled')} value={vc.sniperTracerEnabled} onChange={(v) => vc.set('sniperTracerEnabled', v)} />
        {vc.sniperTracerEnabled && (
          <>
            <SettingSlider label={t('settings_tracer_speed')} description={t('settings_desc_tracer_speed')} value={vc.tracerSpeed} onChange={(v) => vc.set('tracerSpeed', v)} min={0.1} max={5} step={0.1} unit="x" />
            <SettingSlider label={t('settings_tracer_width')} description={t('settings_desc_tracer_width')} value={vc.tracerWidth} onChange={(v) => vc.set('tracerWidth', v)} min={0.5} max={6} step={0.5} unit="px" />
            <SettingSlider label={t('settings_tracer_trail_length')} description={t('settings_desc_tracer_trail_length')} value={vc.tracerTrailLength} onChange={(v) => vc.set('tracerTrailLength', v)} min={5} max={200} step={5} unit="px" />
            <SettingSlider label={t('settings_tracer_glow')} description={t('settings_desc_tracer_glow')} value={vc.tracerGlow} onChange={(v) => vc.set('tracerGlow', v)} min={0} max={1} step={0.05} />
            <SettingSlider label={t('settings_tracer_duration')} description={t('settings_desc_tracer_duration')} value={vc.tracerDuration} onChange={(v) => vc.set('tracerDuration', v)} min={0.1} max={5} step={0.1} unit="s" />
          </>
        )}
      </SettingGroup>
    </div>
  );
}
