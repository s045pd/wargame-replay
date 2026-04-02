import { useState } from 'react';
import { useI18n } from '../../lib/i18n';

interface SettingsPanelProps {
  onClose: () => void;
}

const TABS = [
  { key: 'map',        icon: '\u{1F5FA}\uFE0F' },
  { key: 'colors',     icon: '\u{1F3A8}' },
  { key: 'units',      icon: '\u{1F464}' },
  { key: 'trails',     icon: '\u3030\uFE0F' },
  { key: 'effects',    icon: '\u2728' },
  { key: 'ballistics', icon: '\u{1F52B}' },
  { key: 'playback',   icon: '\u23F1\uFE0F' },
  { key: 'general',    icon: '\u2699\uFE0F' },
] as const;

type TabKey = (typeof TABS)[number]['key'];

export function SettingsPanel({ onClose }: SettingsPanelProps) {
  const [activeTab, setActiveTab] = useState<TabKey>('map');
  const { t } = useI18n();

  return (
    <div
      className="fixed inset-0 bg-black/60 flex items-center justify-center z-[60] backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-zinc-900 border border-zinc-700 rounded-lg shadow-2xl w-[720px] max-w-[90vw] h-[80vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-zinc-700 shrink-0">
          <h2 className="text-sm font-bold text-zinc-100 tracking-wider">{t('settings')}</h2>
          <button onClick={onClose} className="text-zinc-400 hover:text-zinc-100 text-lg leading-none">\u00D7</button>
        </div>

        {/* Body: sidebar + content */}
        <div className="flex flex-1 min-h-0">
          {/* Left sidebar tabs */}
          <div className="w-36 border-r border-zinc-800 py-2 shrink-0 overflow-y-auto">
            {TABS.map((tab) => (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={`w-full text-left px-4 py-2 text-xs flex items-center gap-2 transition-colors ${
                  activeTab === tab.key
                    ? 'bg-zinc-800 text-zinc-100 border-l-2 border-emerald-500'
                    : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/50 border-l-2 border-transparent'
                }`}
              >
                <span className="text-sm">{tab.icon}</span>
                {t(`settings_tab_${tab.key}`)}
              </button>
            ))}
          </div>

          {/* Content area */}
          <div className="flex-1 overflow-y-auto p-5">
            {/* Tab content rendered here — placeholder for now */}
            <div className="text-xs text-zinc-500">Tab: {activeTab}</div>
          </div>
        </div>
      </div>
    </div>
  );
}
