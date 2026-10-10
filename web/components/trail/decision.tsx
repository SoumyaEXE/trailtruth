import type { SVGProps } from "react";
import { DECISION_LABEL, DECISION_LONG } from "@/lib/format";
import type { Decision } from "@/lib/types";
import { cx } from "@/utils/cx";

/**
 * Decision signals are always color + shape, so they survive grayscale print
 * and color-vision deficiency:
 *   go      → circle with check
 *   caution → triangle with exclamation
 *   no_go   → octagon with bar
 */

export const DECISION_STYLES: Record<
  Decision,
  { solid: string; surface: string; text: string; border: string; fill: string }
> = {
  go: {
    solid: "bg-go-solid",
    surface: "bg-go-surface",
    text: "text-go-text",
    border: "border-go-border",
    fill: "var(--tt-go-solid)",
  },
  caution: {
    solid: "bg-caution-solid",
    surface: "bg-caution-surface",
    text: "text-caution-text",
    border: "border-caution-border",
    fill: "var(--tt-caution-solid)",
  },
  no_go: {
    solid: "bg-nogo-solid",
    surface: "bg-nogo-surface",
    text: "text-nogo-text",
    border: "border-nogo-border",
    fill: "var(--tt-nogo-solid)",
  },
};

export function DecisionGlyph({
  decision,
  className,
  title,
  ...props
}: { decision: Decision; title?: string } & SVGProps<SVGSVGElement>) {
  const fill = DECISION_STYLES[decision].fill;
  return (
    <svg
      viewBox="0 0 24 24"
      className={cx("size-4 shrink-0", className)}
      role={title ? "img" : undefined}
      aria-hidden={title ? undefined : true}
      {...props}
    >
      {title ? <title>{title}</title> : null}
      {decision === "go" && (
        <>
          <circle cx="12" cy="12" r="10.5" fill={fill} data-print-fill />
          <path
            d="M7.4 12.4l3 3 6.2-6.6"
            fill="none"
            stroke="white"
            strokeWidth="2.4"
            strokeLinecap="round"
            strokeLinejoin="round"
            data-print-glyph
          />
        </>
      )}
      {decision === "caution" && (
        <>
          <path
            d="M10.27 2.9a2 2 0 0 1 3.46 0l8.86 15.6A2 2 0 0 1 20.86 21.5H3.14a2 2 0 0 1-1.73-3L10.27 2.9z"
            fill={fill}
            data-print-fill
          />
          <path d="M12 8.6v5.6" stroke="white" strokeWidth="2.4" strokeLinecap="round" data-print-glyph />
          <circle cx="12" cy="17.6" r="1.35" fill="white" data-print-glyph />
        </>
      )}
      {decision === "no_go" && (
        <>
          <path
            d="M7.86 1.5h8.28l5.86 5.86v9.28l-5.86 5.86H7.86L2 16.64V7.36z"
            fill={fill}
            data-print-fill
          />
          <path d="M7 12h10" stroke="white" strokeWidth="2.6" strokeLinecap="round" data-print-glyph />
        </>
      )}
    </svg>
  );
}

type BadgeSize = "sm" | "md" | "lg";

export function DecisionBadge({
  decision,
  size = "md",
  long = false,
  className,
}: {
  decision: Decision;
  size?: BadgeSize;
  long?: boolean;
  className?: string;
}) {
  const s = DECISION_STYLES[decision];
  return (
    <span
      className={cx(
        "inline-flex shrink-0 items-center whitespace-nowrap border",
        s.surface,
        s.text,
        s.border,
        size === "sm" && "h-6 gap-1 rounded-md ps-1 pe-1.5 text-caption-1-semibold",
        size === "md" && "h-7 gap-1.5 rounded-lg ps-1.5 pe-2 text-body-2-semibold",
        size === "lg" && "h-9 gap-2 rounded-2lg ps-2 pe-3 text-body-semibold",
        className,
      )}
    >
      <DecisionGlyph
        decision={decision}
        className={cx(size === "sm" && "size-3.5", size === "md" && "size-4", size === "lg" && "size-5")}
      />
      {long ? DECISION_LONG[decision] : DECISION_LABEL[decision]}
    </span>
  );
}
