import { useVisualConfig } from '../../../store/visualConfig';
import { useI18n } from '../../../lib/i18n';
import { SettingToggle } from '../controls/SettingToggle';
import { SettingSlider } from '../controls/SettingSlider';
import { SettingSelect } from '../controls/SettingSelect';
import { SettingGroup } from '../controls/SettingGroup';

export function UnitsTab() {
  const { t } = useI18n();
  const vc = useVisualConfig();

  return (
    <div>
      <SettingGroup title={t('settings_tab_units')}>
        <SettingSlider label={t('settings_unit_icon_size')} description={t('settings_desc_unit_icon_size')} value={vc.unitIconSize} onChange={(v) => vc.set('unitIconSize', v)} min={16} max={64} unit="px" />
        <SettingToggle label={t('settings_show_unit_label')} description={t('settings_desc_show_unit_label')} value={vc.showUnitLabel} onChange={(v) => vc.set('showUnitLabel', v)} />
        {vc.showUnitLabel && (
          <SettingSlider label={t('settings_label_font_size')} description={t('settings_desc_label_font_size')} value={vc.labelFontSize} onChange={(v) => vc.set('labelFontSize', v)} min={8} max={16} unit="px" />
        )}
        <SettingToggle label={t('settings_selection_ring')} description={t('settings_desc_selection_ring')} value={vc.selectionRing} onChange={(v) => vc.set('selectionRing', v)} />
        <SettingSlider label={t('settings_follow_zoom')} description={t('settings_desc_follow_zoom')} value={vc.defaultFollowZoom} onChange={(v) => vc.set('defaultFollowZoom', v)} min={14} max={22} />
      </SettingGroup>

      <SettingGroup title={t('settings_dead_unit_display')}>
        <SettingSelect
          label={t('settings_dead_unit_display')}
          description={t('settings_desc_dead_unit_display')}
          value={vc.deadUnitDisplay}
          onChange={(v) => vc.set('deadUnitDisplay', v as 'fade' | 'hide' | 'marker')}
          options={[
            { value: 'fade', label: t('settings_dead_fade') },
            { value: 'hide', label: t('settings_dead_hide') },
            { value: 'marker', label: t('settings_dead_marker') },
          ]}
        />
        {vc.deadUnitDisplay === 'fade' && (
          <SettingSlider label={t('settings_dead_opacity')} description={t('settings_desc_dead_opacity')} value={vc.deadOpacity} onChange={(v) => vc.set('deadOpacity', v)} min={0} max={1} step={0.05} />
        )}
      </SettingGroup>
    </div>
  );
}
