import { useI18n } from '../lib/i18n';

interface ShortcutHelpProps {
  onClose: () => void;
}

interface ShortcutEntry {
  key: string;
  i18nKey: string;
}

const SECTIONS: { titleKey: string; items: ShortcutEntry[] }[] = [
  {
    titleKey: 'shortcut_playback',
    items: [
      { key: 'Space', i18nKey: 'sk_playpause' },
      { key: 'Tab', i18nKey: 'sk_tab' },
      { key: 'A', i18nKey: 'sk_auto' },
    ],
  },
  {
    titleKey: 'shortcut_panels',
    items: [
      { key: 'B', i18nKey: 'sk_bookmark_panel' },
      { key: 'Shift+B', i18nKey: 'sk_bookmark_add' },
      { key: 'C', i18nKey: 'sk_clips' },
      { key: '/', i18nKey: 'sk_search' },
    ],
  },
  {
    titleKey: 'shortcut_display',
    items: [
      { key: 'H', i18nKey: 'sk_immersive' },
      { key: 'T', i18nKey: 'sk_tilt' },
      { key: 'D', i18nKey: 'sk_debug' },
      { key: ',', i18nKey: 'sk_settings' },
      { key: '?', i18nKey: 'sk_shortcuts' },
    ],
  },
];

export function ShortcutHelp({ onClose }: ShortcutHelpProps) {
  const { t } = useI18n();

  return (
    <div
      className="fixed inset-0 bg-black/60 flex items-center justify-center z-[80] backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="bg-zinc-900 border border-zinc-700 rounded-lg shadow-2xl w-[360px] max-h-[80vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-700">
          <h2 className="text-sm font-bold text-zinc-100 tracking-wider">
            {t('shortcut_help')}
          </h2>
          <button
            onClick={onClose}
            className="text-zinc-400 hover:text-zinc-100 text-lg leading-none transition-colors"
            title={t('shortcut_close')}
          >
            ×
          </button>
        </div>

        {/* Sections */}
        <div className="p-5 space-y-5">
          {SECTIONS.map((section) => (
            <div key={section.titleKey}>
              <h3 className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider mb-2">
                {t(section.titleKey)}
              </h3>
              <div className="space-y-1.5">
                {section.items.map((item) => (
                  <div
                    key={item.key}
                    className="flex items-center justify-between gap-3"
                  >
                    <span className="text-xs text-zinc-300">
                      {t(item.i18nKey)}
                    </span>
                    <kbd className="shrink-0 px-2 py-0.5 text-[11px] font-mono bg-zinc-800 border border-zinc-600 rounded text-zinc-300 min-w-[2rem] text-center">
                      {item.key}
                    </kbd>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        {/* Footer hint */}
        <div className="px-5 py-3 border-t border-zinc-800 text-[10px] text-zinc-600 text-center">
          Press <kbd className="px-1 py-0.5 bg-zinc-800 rounded text-zinc-500">?</kbd> or <kbd className="px-1 py-0.5 bg-zinc-800 rounded text-zinc-500">Esc</kbd> to close
        </div>
      </div>
    </div>
  );
}
