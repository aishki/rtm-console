/** BITS FilterChip: a 24×25 filter checkbox with a 15px label. `compact` is an 18px box with a 13px label, for rows short on width. */
export function FilterChip({ id, label, checked, onChange, compact = false }: { id: string; label: string; checked: boolean; onChange: (checked: boolean) => void; compact?: boolean }) {
  const radius = compact ? "rounded-[7px]" : "rounded-[10.14px]";
  return (
    <label htmlFor={id} className={`inline-flex items-center whitespace-nowrap leading-normal tracking-[-0.02em] text-black ${compact ? "h-9 gap-2 text-[13px]" : "h-[45px] gap-2.5 rounded-41 py-2.5 pr-[15px] text-[15px]"}`}>
      <span className="relative inline-flex">
        <span
          className={`inline-flex shrink-0 items-center justify-center transition-colors duration-[120ms] ease-standard ${radius} ${compact ? "h-[18px] w-[18px]" : "h-[25px] w-6"}`}
          style={{ background: checked ? "var(--control-selected)" : "var(--control-unselected)" }}
        >
          <svg width="8" height="7" viewBox="0 0 8 7" fill="none" aria-hidden="true">
            <path d="M1 3.6 3 5.9 7 1.1" stroke="#fff" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
        <input type="checkbox" id={id} checked={checked} onChange={e => onChange(e.target.checked)} className="peer absolute inset-0 m-0 cursor-pointer opacity-0" />
        <span className={`pointer-events-none absolute inset-0 peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-focus ${radius}`} />
      </span>
      {label}
    </label>
  );
}

/** Material Symbols "filter_alt_off" in brand purple. */
export function FilterClearIcon({ size = 24, active = false }: { size?: number; active?: boolean }) {
  return (
    <svg width={size} height={size} viewBox="0 -960 960 960" fill="var(--action-primary)" aria-hidden="true" className="shrink-0" style={{ opacity: active ? 1 : 0.55 }}>
      <path d="m791-56-91-91q-15 9-32 13.5t-35 4.5H480q-33 0-56.5-23.5T400-209v-238L56-791l56-57 736 736-57 56ZM537-361l-73-73v225h96v-55l-23-97ZM560-537l-84-84 189-239H218l160 202-57 57-224-283q-14-19-4-38t34-19h625q24 0 34 19t-4 38L560-537Z" />
    </svg>
  );
}
