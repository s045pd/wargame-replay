import { usePlayback } from '../../../store/playback';
import { useDirector } from '../../../store/director';
import { useVisualConfig } from '../../../store/visualConfig';
import type { VisualConfig } from '../../../store/visualConfig';
import { useI18n } from '../../../lib/i18n';
import { SettingToggle } from '../controls/SettingToggle';
import { SettingSlider } from '../controls/SettingSlider';
import { SettingSelect } from '../controls/SettingSelect';
import { SettingGroup } from '../controls/SettingGroup';

const SPEEDS = [1, 2, 4, 8, 16, 32, 64, 128];
const SLOW_DIVS = [0, 2, 4, 8, 16];
const SLOW_SPEEDS = [0, 1, 2, 4, 8];
const BOMBARD_DIVS = [0, 2, 4, 8];

export function PlaybackTab() {
  const { t } = useI18n();
  const pb = usePlayback();
  const dir = useDirector();
  const vc = useVisualConfig();

  return (
    <div>
      <SettingGroup title={t('speed')}>
        <SettingSelect
          label={t('speed')}
          description={t('settings_desc_speed')}
          value={String(pb.speed)}
          onChange={(v) => pb.setSpeed(Number(v))}
          options={SPEEDS.map((s) => ({ value: String(s), label: `${s}x` }))}
        />
        <SettingSelect
          label={t('settings_default_speed')}
          description={t('settings_desc_default_speed')}
          value={String(vc.defaultSpeed)}
          onChange={(v) => vc.set('defaultSpeed', Number(v))}
          options={SPEEDS.map((s) => ({ value: String(s), label: `${s}x` }))}
        />
        <SettingToggle label={t('settings_auto_play')} description={t('settings_desc_auto_play')} value={vc.autoPlay} onChange={(v) => vc.set('autoPlay', v as VisualConfig['autoPlay'])} />
      </SettingGroup>

      <SettingGroup title={t('slow_group')} description={t('slow_group_tip')}>
        <SettingSelect
          label={t('slow_killstreak')}
          description={t('settings_desc_killstreak_slow')}
          value={String(pb.killstreakSlowDiv)}
          onChange={(v) => pb.setKillstreakSlowDiv(Number(v))}
          options={SLOW_DIVS.map((d) => ({ value: String(d), label: d === 0 ? t('slow_off') : `÷${d}` }))}
        />
        <SettingSelect
          label={t('slow_longrange')}
          description={t('settings_desc_longrange_slow')}
          value={String(pb.longRangeSlowSpeed)}
          onChange={(v) => pb.setLongRangeSlowSpeed(Number(v))}
          options={SLOW_SPEEDS.map((s) => ({ value: String(s), label: s === 0 ? t('slow_off') : `${s}x` }))}
        />
        <SettingSelect
          label={t('slow_bombard')}
          description={t('settings_desc_bombard_slow')}
          value={String(pb.bombardSlowDiv)}
          onChange={(v) => pb.setBombardSlowDiv(Number(v))}
          options={BOMBARD_DIVS.map((d) => ({ value: String(d), label: d === 0 ? t('slow_off') : `÷${d}` }))}
        />
      </SettingGroup>

      <SettingGroup title={t('director')}>
        <SettingToggle label={t('focus_dark_map')} description={t('settings_desc_focus_dark_map')} value={dir.focusDarkMap} onChange={() => dir.toggleFocusDarkMap()} />
        <SettingToggle label={t('settings_focus_lock_enabled')} description={t('settings_desc_focus_lock_enabled')} value={vc.focusLockEnabled} onChange={(v) => vc.set('focusLockEnabled', v as VisualConfig['focusLockEnabled'])} />
        {vc.focusLockEnabled && (
          <SettingSlider label={t('settings_focus_lock_duration')} description={t('settings_desc_focus_lock_duration')} value={vc.focusLockDuration} onChange={(v) => vc.set('focusLockDuration', v as VisualConfig['focusLockDuration'])} min={2} max={15} unit="s" />
        )}
      </SettingGroup>
    </div>
  );
}
