interface SettingSliderProps {
  label: string;
  value: number;
  onChange: (value: number) => void;
  min: number;
  max: number;
  step?: number;
  unit?: string;
  description?: string;
}

export function SettingSlider({ label, value, onChange, min, max, step = 1, unit, description }: SettingSliderProps) {
  return (
    <div className="py-2">
      <div className="flex items-center justify-between mb-1">
        <div className="text-xs text-zinc-300">{label}</div>
        <div className="text-xs text-zinc-400 font-mono">
          {step < 1 ? value.toFixed(1) : value}{unit && <span className="text-zinc-600 ml-0.5">{unit}</span>}
        </div>
      </div>
      {description && <div className="text-[10px] text-zinc-500 mb-1">{description}</div>}
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full h-1.5 bg-zinc-700 rounded-full appearance-none cursor-pointer accent-emerald-500"
      />
    </div>
  );
}
