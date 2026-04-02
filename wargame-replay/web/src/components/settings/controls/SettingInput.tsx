interface SettingInputProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  type?: string;
  description?: string;
}

export function SettingInput({ label, value, onChange, placeholder, type = 'text', description }: SettingInputProps) {
  return (
    <div className="py-2">
      <div className="text-xs text-zinc-300 mb-1">{label}</div>
      {description && <div className="text-[10px] text-zinc-500 mb-1">{description}</div>}
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full bg-zinc-800 border border-zinc-700 text-zinc-200 text-xs rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-emerald-600"
      />
    </div>
  );
}
