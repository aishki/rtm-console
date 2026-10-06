import type { ButtonHTMLAttributes } from "react";

type PurpleButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "solid" | "outline";
  /** 32px tall, for dense rows (trigger cards, tables, the nudge). Default is 38px. */
  compact?: boolean;
};

/** BITS PurpleButton: pill button in brand purple, solid or outline. */
export function PurpleButton({ variant = "solid", compact = false, className = "", type = "button", ...rest }: PurpleButtonProps) {
  const size = compact ? "h-8 px-3.5 py-1.5 text-sm" : "h-[38px] px-[15px] py-2.5 text-base";
  const skin = variant === "solid"
    ? "bg-purple text-white enabled:hover:bg-purple-hover enabled:active:bg-purple-900"
    : "bg-white text-purple enabled:hover:bg-tint enabled:active:bg-primary-300";
  return (
    <button
      type={type}
      className={`inline-flex items-center justify-center gap-2.5 whitespace-nowrap rounded-20 border-0 font-semibold leading-none shadow-[var(--ring-button)] transition-colors duration-200 ease-standard disabled:cursor-not-allowed disabled:opacity-40 ${size} ${skin} ${className}`}
      {...rest}
    />
  );
}

/** BITS TertiaryButton (purple tone): text button with a trailing arrow. */
export function TertiaryButton({ children, className = "", type = "button", ...rest }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type={type}
      className={`inline-flex items-center justify-center gap-2 rounded-8 border-0 bg-transparent py-1 font-ui text-base font-medium leading-[1.2] tracking-[-0.02em] text-purple transition-colors duration-200 ease-standard hover:text-purple-hover ${className}`}
      {...rest}
    >
      {children}
      <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
        <path d="M1.8 6h8.4M6.9 2.6 10.2 6l-3.3 3.4" stroke="currentColor" strokeWidth="1.286" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </button>
  );
}
