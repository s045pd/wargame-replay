import { useVisualConfig } from '../../../store/visualConfig';
import type { VisualConfig } from '../../../store/visualConfig';
import { useHotspotFilter } from '../../../store/hotspotFilter';
import { useI18n } from '../../../lib/i18n';
import { SettingToggle } from '../controls/SettingToggle';
import { SettingSlider } from '../controls/SettingSlider';
import { SettingGroup } from '../controls/SettingGroup';

const HOTSPOT_TYPES = ['firefight', 'killstreak', 'mass_casualty', 'engagement', 'bombardment', 'long_range'];

export function HotspotTab() {
  const { t } = useI18n();
  const vc = useVisualConfig();
  const { debugOverlay, toggleDebugOverlay, typeFilters, setTypeFilter } = useHotspotFilter();

  return (
    <div>
      {/* Hotspot visibility filters */}
      <SettingGroup title={t('hotspot_filter')}>
        <SettingToggle label={t('debug_overlay')} description={t('settings_desc_debug_overlay')} value={debugOverlay} onChange={() => toggleDebugOverlay()} />
        {HOTSPOT_TYPES.map((type) => (
          <SettingToggle
            key={type}
            label={t(type)}
            value={typeFilters[type as keyof typeof typeFilters]}
            onChange={(v) => setTypeFilter(type as Parameters<typeof setTypeFilter>[0], v)}
          />
        ))}
      </SettingGroup>

      {/* Director behavior */}
      <SettingGroup title={t('settings_hotspot_director_group')} description={t('settings_hotspot_director_group_tip')}>
        <SettingSlider label={t('settings_director_cooldown')} description={t('settings_desc_director_cooldown')} value={vc.directorCooldown} onChange={(v) => vc.set('directorCooldown', v as VisualConfig['directorCooldown'])} min={1} max={15} step={0.5} unit="s" />
        <SettingSlider label={t('settings_director_jitter')} description={t('settings_desc_director_jitter')} value={vc.directorJitter} onChange={(v) => vc.set('directorJitter', v as VisualConfig['directorJitter'])} min={0} max={0.5} step={0.05} />
        <SettingSlider label={t('settings_director_pre_track')} description={t('settings_desc_director_pre_track')} value={vc.directorPreTrack} onChange={(v) => vc.set('directorPreTrack', v as VisualConfig['directorPreTrack'])} min={1} max={15} step={0.5} unit="s" />
        <SettingSlider label={t('settings_director_score_power')} description={t('settings_desc_director_score_power')} value={vc.directorScorePower} onChange={(v) => vc.set('directorScorePower', v as VisualConfig['directorScorePower'])} min={0.1} max={3} step={0.1} />
      </SettingGroup>

      {/* Camera zoom */}
      <SettingGroup title={t('settings_hotspot_zoom_group')} description={t('settings_hotspot_zoom_group_tip')}>
        <SettingSlider label={t('settings_personal_zoom_px')} description={t('settings_desc_personal_zoom_px')} value={vc.personalZoomPx} onChange={(v) => vc.set('personalZoomPx', v as VisualConfig['personalZoomPx'])} min={50} max={500} step={10} unit="px" />
        <SettingSlider label={t('settings_group_zoom_px')} description={t('settings_desc_group_zoom_px')} value={vc.groupZoomPx} onChange={(v) => vc.set('groupZoomPx', v as VisualConfig['groupZoomPx'])} min={80} max={600} step={10} unit="px" />
        <SettingSlider label={t('settings_director_min_zoom')} description={t('settings_desc_director_min_zoom')} value={vc.directorMinZoom} onChange={(v) => vc.set('directorMinZoom', v as VisualConfig['directorMinZoom'])} min={6} max={18} step={0.5} />
        <SettingSlider label={t('settings_director_max_zoom')} description={t('settings_desc_director_max_zoom')} value={vc.directorMaxZoom} onChange={(v) => vc.set('directorMaxZoom', v as VisualConfig['directorMaxZoom'])} min={12} max={22} step={0.5} />
      </SettingGroup>

      {/* Activity circle (debug only) */}
      <SettingGroup title={t('settings_hotspot_circle_group')} description={t('settings_hotspot_circle_group_tip')}>
        <SettingSlider label={t('settings_activity_circle_min')} description={t('settings_desc_activity_circle_min')} value={vc.activityCircleMin} onChange={(v) => vc.set('activityCircleMin', v as VisualConfig['activityCircleMin'])} min={5} max={150} step={5} unit="m" />
        <SettingSlider label={t('settings_activity_circle_max')} description={t('settings_desc_activity_circle_max')} value={vc.activityCircleMax} onChange={(v) => vc.set('activityCircleMax', v as VisualConfig['activityCircleMax'])} min={50} max={600} step={10} unit="m" />
      </SettingGroup>
    </div>
  );
}
