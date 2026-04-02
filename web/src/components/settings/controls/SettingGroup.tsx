import type { ReactNode } from 'react';

interface SettingGroupProps {
  title: string;
  description?: string;
  children: ReactNode;
}

export function SettingGroup({ title, description, children }: SettingGroupProps) {
  return (
    <div className="mb-6">
      <h3 className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider mb-1">{title}</h3>
      {description && <p className="text-[10px] text-zinc-600 mb-2">{description}</p>}
      <div className="border-t border-zinc-800 pt-1">{children}</div>
    </div>
  );
}
