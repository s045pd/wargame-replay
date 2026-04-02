import { useVisualConfig } from '../../../store/visualConfig';
import { useI18n } from '../../../lib/i18n';
import { SettingColor } from '../controls/SettingColor';
import { SettingGroup } from '../controls/SettingGroup';

export function ColorsTab() {
  const { t } = useI18n();
  const vc = useVisualConfig();

  return (
    <div>
      <SettingGroup title={t('settings_color_group_team')}>
        <SettingColor label={t('settings_red_team_color')} description={t('settings_desc_red_team_color')} value={vc.redTeamColor} onChange={(v) => vc.set('redTeamColor', v)} />
        <SettingColor label={t('settings_red_dead_color')} description={t('settings_desc_red_dead_color')} value={vc.redDeadColor} onChange={(v) => vc.set('redDeadColor', v)} />
        <SettingColor label={t('settings_blue_team_color')} description={t('settings_desc_blue_team_color')} value={vc.blueTeamColor} onChange={(v) => vc.set('blueTeamColor', v)} />
        <SettingColor label={t('settings_blue_dead_color')} description={t('settings_desc_blue_dead_color')} value={vc.blueDeadColor} onChange={(v) => vc.set('blueDeadColor', v)} />
      </SettingGroup>

      <SettingGroup title={t('settings_color_group_lines')}>
        <SettingColor label={t('settings_kill_line_color')} description={t('settings_desc_kill_line_color')} value={vc.killLineColor} onChange={(v) => vc.set('killLineColor', v)} />
        <SettingColor label={t('settings_hit_line_color')} description={t('settings_desc_hit_line_color')} value={vc.hitLineColor} onChange={(v) => vc.set('hitLineColor', v)} />
      </SettingGroup>

      <SettingGroup title={t('settings_color_group_fx')}>
        <SettingColor label={t('settings_sniper_tracer_color')} description={t('settings_desc_sniper_tracer_color')} value={vc.sniperTracerColor} onChange={(v) => vc.set('sniperTracerColor', v)} />
        <SettingColor label={t('settings_bombing_color')} description={t('settings_desc_bombing_color')} value={vc.bombingColor} onChange={(v) => vc.set('bombingColor', v)} />
        <SettingColor label={t('settings_hotspot_circle_color')} description={t('settings_desc_hotspot_circle_color')} value={vc.hotspotCircleColor} onChange={(v) => vc.set('hotspotCircleColor', v)} />
        <SettingColor label={t('settings_selection_color')} description={t('settings_desc_selection_color')} value={vc.selectionColor} onChange={(v) => vc.set('selectionColor', v)} />
      </SettingGroup>
    </div>
  );
}
