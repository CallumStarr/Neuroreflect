export function Section({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <section className="grid grid-cols-1 gap-6 border-t border-ink-800 py-8 lg:grid-cols-[260px_1fr]">
      <div>
        <h2 className="text-[15px] font-medium text-paper-50">{title}</h2>
        {description && <p className="mt-1 text-[12.5px] leading-5 text-paper-500">{description}</p>}
      </div>
      <div className="min-w-0">{children}</div>
    </section>
  );
}

// Width is left to the caller: fieldCls fills its column, inputCls plus a w-* class sizes it.
export const inputCls =
  'rounded-lg border border-ink-700 bg-ink-900 px-3 py-2 text-[14px] text-paper-50 placeholder:text-paper-500 focus:border-ember-400 focus:outline-none';
export const fieldCls = `${inputCls} w-full`;

export const quietButton = 'rounded-lg border border-ink-700 px-3 py-2 text-[13px] text-paper-100 hover:bg-ink-900 disabled:opacity-50';
export const primaryButton = 'rounded-lg bg-ember-400 px-3 py-2 text-[13px] font-medium text-ink-950 hover:bg-ember-300 disabled:opacity-50';
export const dangerButton = 'rounded-lg bg-rose-400 px-3 py-2 text-[13px] font-medium text-ink-950 hover:bg-rose-300 disabled:opacity-40';

export function Message({ value }: { value: { ok: boolean; text: string } | null }) {
  if (!value) return null;
  return (
    <p role="status" className={`text-[12.5px] ${value.ok ? 'text-sage-300' : 'text-rose-300'}`}>
      {value.text}
    </p>
  );
}
