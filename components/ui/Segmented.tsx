'use client';

export default function Segmented<T extends string>({
  label,
  options,
  value,
  onChange,
  size = 'md',
}: {
  label: string;
  options: { id: T; label: string; title?: string }[];
  value: T;
  onChange: (v: T) => void;
  size?: 'sm' | 'md';
}) {
  return (
    <div role="radiogroup" aria-label={label} className="flex rounded-lg border border-ink-800 p-0.5">
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          role="radio"
          aria-checked={value === o.id}
          title={o.title}
          onClick={() => onChange(o.id)}
          className={`whitespace-nowrap rounded-md ${size === 'sm' ? 'px-2.5 py-0.5 text-[12px]' : 'px-3 py-1 text-[12.5px]'} ${value === o.id ? 'bg-ink-850 text-paper-50 shadow-[inset_0_-2px_0_#e0aa4a]' : 'text-paper-500 hover:text-paper-100'}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
