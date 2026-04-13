interface SettingToggleProps {
  label: string;
  value: boolean;
  onChange: (value: boolean) => void;
  disabled?: boolean;
  description?: string;
}

export function SettingToggle({ label, value, onChange, disabled, description }: SettingToggleProps) {
  return (
    <div className="flex items-center justify-between py-2">
      <div className="flex-1 min-w-0">
        <div className={`text-xs ${disabled ? 'text-zinc-600' : 'text-zinc-300'}`}>{label}</div>
        {description && <div className="text-[10px] text-zinc-500 mt-0.5">{description}</div>}
      </div>
      <button
        onClick={() => !disabled && onChange(!value)}
        disabled={disabled}
        className={`relative w-9 h-5 rounded-full transition-colors ${
          value ? 'bg-emerald-600' : 'bg-zinc-700'
        } ${disabled ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer'}`}
      >
        <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform ${
          value ? 'translate-x-4' : 'translate-x-0'
        }`} />
      </button>
    </div>
  );
}
