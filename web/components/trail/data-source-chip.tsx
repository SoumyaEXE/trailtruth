"use client";

import { useSyncExternalStore } from "react";
import { Focusable } from "react-aria-components";
import { Tooltip, TooltipTrigger } from "@/components/base/tooltip/tooltip";
import { API_URL, dataSourceStore } from "@/lib/api";
import { cx } from "@/utils/cx";

const COPY = {
  live: { label: "Live API", tip: `Connected to ${API_URL}` },
  fixture: { label: "Demo data", tip: "API unreachable — showing recorded fixtures (real NPS alerts, cached)." },
  mock: { label: "Demo data", tip: "API and fixtures unreachable — showing bundled sample data." },
} as const;

export function DataSourceChip({ className }: { className?: string }) {
  const source = useSyncExternalStore(dataSourceStore.subscribe, dataSourceStore.get, () => null);
  if (!source) {
    return (
      <span className={cx("tt-source-chip inline-flex h-6 items-center gap-1.5 rounded-full px-2 text-caption-1-medium text-text-tertiary", className)}>
        <span className="size-1.5 rounded-full bg-foreground-icon-quaternary" aria-hidden />
        Connecting…
      </span>
    );
  }
  const live = source === "live";
  const copy = COPY[source];
  return (
    <TooltipTrigger delay={150}>
      <Focusable>
        <span
          tabIndex={0}
          role="status"
          className={cx(
            "tt-source-chip inline-flex h-6 cursor-default items-center gap-1.5 rounded-full border px-2 text-caption-1-medium whitespace-nowrap outline-none focus-visible:ring-2 focus-visible:ring-border-focus-ring",
            live ? "border-go-border bg-go-surface text-go-text" : "border-border-button-default bg-background-secondary-default text-text-secondary",
            className,
          )}
        >
          <span className={cx("relative size-1.5 rounded-full", live ? "tt-pulse bg-go-solid text-go-solid" : "bg-sandstone")} aria-hidden />
          {copy.label}
        </span>
      </Focusable>
      <Tooltip size="md" placement="bottom">
        {copy.tip}
      </Tooltip>
    </TooltipTrigger>
  );
}
