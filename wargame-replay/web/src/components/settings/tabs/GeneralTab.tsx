import { useState, useRef } from 'react';
import { useI18n } from '../../../lib/i18n';
import { useHotspotFilter } from '../../../store/hotspotFilter';
import { exportConfig, importConfig, resetToDefaults } from '../../../lib/settingsAPI';
import { SettingToggle } from '../controls/SettingToggle';
import { SettingSelect } from '../controls/SettingSelect';
import { SettingGroup } from '../controls/SettingGroup';
import { ConfirmDialog } from '../ConfirmDialog';
import type { Locale } from '../../../lib/i18n';

const HOTSPOT_TYPES = ['firefight', 'killstreak', 'mass_casualty', 'engagement', 'bombardment', 'long_range'];

export function GeneralTab() {
  const { t, locale, setLocale } = useI18n();
  const { debugOverlay, toggleDebugOverlay, typeFilters, setTypeFilter } = useHotspotFilter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [showReset, setShowReset] = useState(false);
  const [jsonText, setJsonText] = useState('');
  const [jsonOpen, setJsonOpen] = useState(false);
  const [toast, setToast] = useState('');

  const flash = (msg: string) => { setToast(msg); setTimeout(() => setToast(''), 3000); };

  const handleExport = () => {
    const config = exportConfig();
    const blob = new Blob([JSON.stringify(config, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'wargame-settings.json';
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const json = JSON.parse(text);
      const result = importConfig(json);
      flash(result.ok ? t('settings_import_success') : `${t('settings_import_error')}: ${result.errors.join(', ')}`);
    } catch {
      flash(t('settings_invalid_json'));
    }
    if (fileRef.current) fileRef.current.value = '';
  };

  const handleApplyJson = () => {
    try {
      const json = JSON.parse(jsonText);
      const result = importConfig(json);
      flash(result.ok ? t('settings_import_success') : `${t('settings_import_error')}: ${result.errors.join(', ')}`);
    } catch {
      flash(t('settings_invalid_json'));
    }
  };

  const handleReset = () => {
    resetToDefaults();
    setShowReset(false);
    flash(t('settings_import_success'));
  };

  return (
    <div>
      <SettingGroup title={t('settings_language')}>
        <SettingSelect
          label={t('settings_language')}
          value={locale}
          onChange={(v) => setLocale(v as Locale)}
          options={[{ value: 'en', label: 'English' }, { value: 'zh', label: '中文' }]}
        />
        <SettingToggle label={t('debug_overlay')} value={debugOverlay} onChange={() => toggleDebugOverlay()} />
      </SettingGroup>

      <SettingGroup title={t('hotspot_filter')}>
        {HOTSPOT_TYPES.map((type) => (
          <SettingToggle
            key={type}
            label={t(type)}
            value={typeFilters[type as keyof typeof typeFilters]}
            onChange={(v) => setTypeFilter(type as Parameters<typeof setTypeFilter>[0], v)}
          />
        ))}
      </SettingGroup>

      <SettingGroup title={t('settings_export')}>
        <div className="flex flex-wrap gap-2 py-2">
          <button onClick={handleExport} className="px-3 py-1.5 text-xs rounded bg-zinc-700 hover:bg-zinc-600 text-zinc-200">{t('settings_export')}</button>
          <button onClick={() => fileRef.current?.click()} className="px-3 py-1.5 text-xs rounded bg-zinc-700 hover:bg-zinc-600 text-zinc-200">{t('settings_import')}</button>
          <button onClick={() => setShowReset(true)} className="px-3 py-1.5 text-xs rounded bg-red-900/60 hover:bg-red-800 text-red-300">{t('settings_reset_all')}</button>
          <input ref={fileRef} type="file" accept=".json" className="hidden" onChange={handleImportFile} />
        </div>
        {toast && <div className="text-xs text-emerald-400 mt-1">{toast}</div>}
      </SettingGroup>

      <SettingGroup title={t('settings_edit_json')}>
        <button
          onClick={() => { setJsonOpen(!jsonOpen); if (!jsonOpen) setJsonText(JSON.stringify(exportConfig(), null, 2)); }}
          className="text-xs text-zinc-400 hover:text-zinc-200 mb-2"
        >
          {jsonOpen ? '▼' : '▶'} {t('settings_edit_json')}
        </button>
        {jsonOpen && (
          <div>
            <textarea
              value={jsonText}
              onChange={(e) => setJsonText(e.target.value)}
              className="w-full h-60 bg-zinc-950 border border-zinc-700 rounded text-[11px] font-mono text-zinc-300 p-2 resize-y focus:outline-none focus:ring-1 focus:ring-emerald-600"
              placeholder={t('settings_json_placeholder')}
            />
            <button onClick={handleApplyJson} className="mt-2 px-3 py-1 text-xs rounded bg-emerald-700 hover:bg-emerald-600 text-white">{t('settings_apply_json')}</button>
          </div>
        )}
      </SettingGroup>

      {showReset && (
        <ConfirmDialog
          title={t('settings_reset_confirm_title')}
          message={t('settings_reset_confirm_msg')}
          confirmLabel={t('settings_reset_all')}
          cancelLabel={t('close')}
          onConfirm={handleReset}
          onCancel={() => setShowReset(false)}
        />
      )}
    </div>
  );
}
