interface SettingColorProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  description?: string;
}

export function SettingColor({ label, value, onChange, description }: SettingColorProps) {
  return (
    <div className="flex items-center justify-between py-2">
      <div className="flex-1 min-w-0">
        <div className="text-xs text-zinc-300">{label}</div>
        {description && <div className="text-[10px] text-zinc-500 mt-0.5">{description}</div>}
      </div>
      <div className="flex items-center gap-2">
        <span className="text-[10px] text-zinc-500 font-mono">{value}</span>
        <label className="relative w-7 h-7 rounded border border-zinc-600 cursor-pointer overflow-hidden" style={{ backgroundColor: value }}>
          <input
            type="color"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            className="absolute inset-0 opacity-0 cursor-pointer"
          />
        </label>
      </div>
    </div>
  );
}
