import { cx } from "@/utils/cx";

/** TrailTruth mark: a trail blaze — mountain ridge over a single path line. */
export function LogoMark({ className }: { className?: string }) {
  return (
    <span
      className={cx(
        "relative inline-flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-2lg bg-overbar text-overbar-text shadow-xs",
        className,
      )}
      aria-hidden
    >
      <svg viewBox="0 0 32 32" className="size-full">
        <path d="M3 24.5 11.5 12l4.5 6 3.5-4.5L29 24.5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinejoin="round" strokeLinecap="round" />
        <path d="M11.5 12 13.6 15" stroke="var(--tt-sandstone)" strokeWidth="2.2" strokeLinecap="round" />
        <circle cx="23.5" cy="8.5" r="2.4" fill="var(--tt-sandstone)" />
      </svg>
    </span>
  );
}

export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={cx("flex items-center gap-2.5", className)}>
      <LogoMark />
      <span className="flex flex-col leading-none">
        <span className="font-sign text-[17px] font-semibold tracking-[-0.01em] text-text-primary">TrailTruth</span>
        <span className="tt-eyebrow mt-1 text-[9.5px] tracking-[0.06em] whitespace-nowrap text-text-tertiary">Check once · go outside</span>
      </span>
    </span>
  );
}
