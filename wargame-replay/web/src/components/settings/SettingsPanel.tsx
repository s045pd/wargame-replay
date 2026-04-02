import React, { useState, useEffect, useRef } from 'react';
import { useI18n } from '../../lib/i18n';
import { MapTab } from './tabs/MapTab';
import { ColorsTab } from './tabs/ColorsTab';
import { UnitsTab } from './tabs/UnitsTab';
import { EffectsTab } from './tabs/EffectsTab';
import { BallisticsTab } from './tabs/BallisticsTab';
import { PlaybackTab } from './tabs/PlaybackTab';
import { HotspotTab } from './tabs/HotspotTab';
import { GeneralTab } from './tabs/GeneralTab';

interface SettingsPanelProps {
  onClose: () => void;
}

const TABS = [
  { key: 'map',        icon: '\u{1F5FA}\uFE0F' },
  { key: 'colors',     icon: '\u{1F3A8}' },
  { key: 'units',      icon: '\u{1F464}' },
  { key: 'effects',    icon: '\u2728' },
  { key: 'ballistics', icon: '\u{1F52B}' },
  { key: 'playback',   icon: '\u23F1\uFE0F' },
  { key: 'hotspot',    icon: '\u{1F525}' },
  { key: 'general',    icon: '\u2699\uFE0F' },
] as const;

type TabKey = (typeof TABS)[number]['key'];

export function SettingsPanel({ onClose }: SettingsPanelProps) {
  const [activeTab, setActiveTab] = useState<TabKey>('map');
  const [slid, setSlid] = useState(false);
  const { t } = useI18n();
  const panelRef = useRef<HTMLDivElement>(null);

  // Trigger slide-in on mount
  useEffect(() => {
    requestAnimationFrame(() => setSlid(true));
  }, []);

  const TAB_CONTENT: Record<TabKey, React.ComponentType> = {
    map: MapTab,
    colors: ColorsTab,
    units: UnitsTab,
    effects: EffectsTab,
    ballistics: BallisticsTab,
    playback: PlaybackTab,
    hotspot: HotspotTab,
    general: GeneralTab,
  };

  const ActiveTab = TAB_CONTENT[activeTab];

  // Click outside the panel to close
  const handleBackdropClick = (e: React.MouseEvent) => {
    if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
      onClose();
    }
  };

  return (
    <div
      className="fixed inset-0 z-[60] pointer-events-none"
      onClick={handleBackdropClick}
      style={{ pointerEvents: 'auto' }}
    >
      {/* Semi-transparent backdrop — lets user still SEE the map */}
      <div className={`absolute inset-0 transition-colors duration-300 ${slid ? 'bg-black/20' : 'bg-transparent'}`} />

      {/* Right-side sliding drawer */}
      <div
        ref={panelRef}
        className={`absolute top-0 right-0 h-full bg-zinc-900/95 backdrop-blur-md border-l border-zinc-700 shadow-2xl flex flex-col transition-transform duration-300 ease-out ${
          slid ? 'translate-x-0' : 'translate-x-full'
        }`}
        style={{ width: 'min(420px, 85vw)' }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-700 shrink-0">
          <h2 className="text-sm font-bold text-zinc-100 tracking-wider">{t('settings')}</h2>
          <button onClick={onClose} className="text-zinc-400 hover:text-zinc-100 text-lg leading-none">×</button>
        </div>

        {/* Tab bar — horizontal scrollable strip */}
        <div className="flex border-b border-zinc-800 shrink-0 overflow-x-auto" style={{ scrollbarWidth: 'none' }}>
          {TABS.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`shrink-0 px-3 py-2 text-[11px] flex items-center gap-1.5 transition-colors border-b-2 ${
                activeTab === tab.key
                  ? 'text-zinc-100 border-emerald-500 bg-zinc-800/50'
                  : 'text-zinc-500 border-transparent hover:text-zinc-300 hover:bg-zinc-800/30'
              }`}
            >
              <span className="text-xs">{tab.icon}</span>
              {t(`settings_tab_${tab.key}`)}
            </button>
          ))}
        </div>

        {/* Content area — scrollable */}
        <div className="flex-1 overflow-y-auto p-4">
          <ActiveTab />
        </div>
      </div>
    </div>
  );
}
