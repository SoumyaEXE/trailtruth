import type { Ref } from "react";
import { DECISION_LABEL, DECISION_LONG, formatDate, shortParkName } from "@/lib/format";
import type { CardPark, Decision, TrailCard } from "@/lib/types";
import { cx } from "@/utils/cx";
import { DECISION_STYLES, DecisionGlyph } from "./decision";
import { LogoMark } from "./logo";
import { QR } from "./qr";
import { Topo } from "./topo";

export type CardLayout = "sheet" | "phone";

export function conditionsUrl(code: string) {
  return `https://www.nps.gov/${code}/planyourvisit/conditions.htm`;
}

const OVERALL_LINE: Record<Decision, string> = {
  go: "Every park on your list is clear. Go.",
  caution: "Good week to go — with a few detours.",
  no_go: "At least one park is a no-go this week.",
};

function Legend({ compact }: { compact?: boolean }) {
  return (
    <div className={cx("flex items-center text-ink-3", compact ? "gap-2.5" : "gap-3.5")}>
      {(["go", "caution", "no_go"] as Decision[]).map((d) => (
        <span key={d} className="inline-flex items-center gap-1 text-[11px] leading-4 font-medium">
          <DecisionGlyph decision={d} className="size-3" />
          {DECISION_LABEL[d]}
        </span>
      ))}
    </div>
  );
}

function ParkRowSheet({ park, states }: { park: CardPark; states?: string }) {
  const s = DECISION_STYLES[park.decision];
  return (
    <article className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-3 py-5 sm:grid-cols-[auto_minmax(0,1fr)_auto] sm:gap-x-5">
      {/* Decision column */}
      <div className="flex w-14 flex-col items-center gap-1.5 pt-0.5 sm:w-16">
        <DecisionGlyph decision={park.decision} className="size-10 sm:size-11" title={DECISION_LABEL[park.decision]} />
        <span className={cx("text-center text-[11px] leading-3.5 font-bold tracking-[0.06em] uppercase", s.text)}>
          {DECISION_LABEL[park.decision]}
        </span>
      </div>

      {/* Main */}
      <div className="flex min-w-0 flex-col gap-3">
        <div className="flex min-w-0 flex-col gap-0.5">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <h3 className="font-sign text-[22px] leading-7 font-semibold tracking-[-0.01em] text-ink sm:text-[24px] sm:leading-8">
              {shortParkName(park.park_name)}
            </h3>
            <span className="font-mono text-[11px] leading-4 tracking-[0.06em] text-ink-3 uppercase">
              {park.park_code}
              {states ? ` · ${states.replace(/,/g, ", ")}` : ""}
            </span>
          </div>
          <p className="text-[15px] leading-[22px] font-semibold text-ink-2">{park.headline}</p>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-5">
          <div className="min-w-0">
            <p className="mb-1.5 text-[10.5px] leading-4 font-bold tracking-[0.1em] text-ink-3 uppercase">Closed</p>
            {park.closed_trails.length ? (
              <ul className="flex flex-col gap-1">
                {park.closed_trails.slice(0, 5).map((t) => (
                  <li key={t} className="flex items-start gap-2 text-[13.5px] leading-5 text-ink">
                    <svg viewBox="0 0 12 12" className="mt-1 size-3 shrink-0" aria-hidden>
                      <path d="M2.5 2.5l7 7M9.5 2.5l-7 7" stroke="var(--tt-nogo-solid)" strokeWidth="2" strokeLinecap="round" data-print-stroke />
                    </svg>
                    <span className="min-w-0 break-words">{t}</span>
                  </li>
                ))}
                {park.closed_trails.length > 5 && (
                  <li className="ps-5 text-[12.5px] leading-5 text-ink-3">+{park.closed_trails.length - 5} more</li>
                )}
              </ul>
            ) : (
              <p className="flex items-center gap-2 text-[13.5px] leading-5 text-ink-2">
                <DecisionGlyph decision="go" className="size-3" /> No trail closures
              </p>
            )}
          </div>
          <div className="min-w-0">
            <p className="mb-1.5 text-[10.5px] leading-4 font-bold tracking-[0.1em] text-ink-3 uppercase">Watch for</p>
            {park.watch_for.length ? (
              <ul className="flex flex-col gap-1">
                {park.watch_for.slice(0, 4).map((w) => (
                  <li key={w} className="flex items-start gap-2 text-[13.5px] leading-5 text-ink">
                    <span className="mt-[7px] size-1.5 shrink-0 rotate-45 bg-ink-3" aria-hidden />
                    <span className="min-w-0 break-words">{w}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-[13.5px] leading-5 text-ink-2">Nothing flagged</p>
            )}
          </div>
        </div>
      </div>

      {/* QR */}
      <div className="col-start-2 flex items-center gap-2.5 sm:col-start-3 sm:row-start-1 sm:flex-col sm:items-end sm:gap-1">
        <QR value={conditionsUrl(park.park_code)} className="size-14 rounded-sm sm:size-[68px]" label={`Live conditions for ${park.park_name}`} />
        <span className="text-[10px] leading-3.5 font-medium tracking-[0.04em] text-ink-3 uppercase sm:text-end">
          Live
          <br className="hidden sm:block" /> conditions
        </span>
      </div>
    </article>
  );
}

function ParkRowPhone({ park }: { park: CardPark }) {
  const s = DECISION_STYLES[park.decision];
  return (
    <article className="flex gap-3 py-3.5">
      <DecisionGlyph decision={park.decision} className="mt-0.5 size-8" title={DECISION_LABEL[park.decision]} />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex items-baseline justify-between gap-2">
          <h3 className="truncate font-sign text-[19px] leading-6 font-semibold text-ink">{shortParkName(park.park_name)}</h3>
          <span className={cx("shrink-0 text-[10.5px] leading-4 font-bold tracking-[0.08em] uppercase", s.text)}>
            {DECISION_LABEL[park.decision]}
          </span>
        </div>
        <p className="line-clamp-2 text-[13px] leading-[18px] font-semibold text-ink-2">{park.headline}</p>
        {park.closed_trails.length > 0 && (
          <p className="line-clamp-2 text-[12px] leading-[17px] text-ink-2">
            <span className="font-bold text-nogo-text">Closed: </span>
            {park.closed_trails.slice(0, 3).join(" · ")}
            {park.closed_trails.length > 3 ? ` +${park.closed_trails.length - 3}` : ""}
          </p>
        )}
        {park.watch_for.length > 0 && (
          <p className="line-clamp-2 text-[12px] leading-[17px] text-ink-3">
            <span className="font-bold text-ink-2">Watch: </span>
            {park.watch_for.slice(0, 2).join(" · ")}
          </p>
        )}
      </div>
    </article>
  );
}

export function TrailCardView({
  card,
  layout = "sheet",
  parkStates = {},
  alertCount,
  ref,
  className,
}: {
  card: TrailCard;
  layout?: CardLayout;
  parkStates?: Record<string, string>;
  alertCount?: number;
  ref?: Ref<HTMLDivElement>;
  className?: string;
}) {
  const digested = alertCount ?? card.parks.reduce((n, p) => n + p.alert_ids.length, 0);
  const overall = DECISION_STYLES[card.overall];

  if (layout === "phone") {
    return (
      <div
        ref={ref}
        className={cx(
          "tt-paper-scope relative flex aspect-[9/19.5] w-[360px] flex-col overflow-hidden rounded-[36px] bg-paper shadow-xl ring-1 ring-black/5",
          className,
        )}
      >
        {/* Clock-safe zone */}
        <div className="relative h-[30%] shrink-0 overflow-hidden bg-overbar text-overbar-text">
          <Topo variant="card" opacity={0.22} className="text-sandstone" />
          <div className="absolute inset-x-0 bottom-0 flex flex-col gap-2 p-5">
            <div className="flex items-center gap-2">
              <LogoMark className="size-6 rounded-md bg-white/10 shadow-none" />
              <span className="text-[10.5px] leading-4 font-bold tracking-[0.14em] uppercase opacity-80">
                Week of {formatDate(card.week_of, { month: "short", day: "numeric" })}
              </span>
            </div>
            <div className="flex items-center gap-2.5">
              <span className="rounded-full bg-white p-1">
                <DecisionGlyph decision={card.overall} className="size-7" />
              </span>
              <span className="font-sign text-[30px] leading-9 font-semibold">{DECISION_LONG[card.overall]}</span>
            </div>
          </div>
        </div>
        <div className="flex min-h-0 flex-1 flex-col px-5">
          <div className="min-h-0 flex-1 divide-y divide-rule overflow-hidden">
            {card.parks.slice(0, card.parks.length > 4 ? 3 : 4).map((p) => (
              <ParkRowPhone key={p.park_code} park={p} />
            ))}
          </div>
          <div className="flex items-center justify-between border-t border-rule py-3.5">
            <Legend compact />
            <span className="font-mono text-[10px] leading-4 text-ink-3">{digested} alerts → 1 card</span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={ref}
      className={cx(
        "tt-paper-scope tt-print-card relative w-full max-w-[820px] overflow-hidden rounded-[20px] bg-paper shadow-xl ring-1 ring-black/5",
        className,
      )}
    >
      {/* Overbar — the ranger-sign header */}
      <header className="tt-print-invert relative overflow-hidden bg-overbar px-5 py-5 text-overbar-text sm:px-8 sm:py-6">
        <Topo variant="card" opacity={0.2} className="text-sandstone" />
        <div className="relative flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-2.5">
              <LogoMark className="size-7 rounded-lg bg-white/10 shadow-none" />
              <span className="text-[11px] leading-4 font-bold tracking-[0.16em] uppercase opacity-85">TrailTruth · Trail card</span>
            </div>
            <p className="font-sign text-[30px] leading-9 font-semibold tracking-[-0.01em] sm:text-[36px] sm:leading-[42px]">
              Week of {formatDate(card.week_of, { month: "long", day: "numeric" })}
            </p>
            <p className="text-[14px] leading-5 opacity-80">{OVERALL_LINE[card.overall]}</p>
          </div>
          <div className="flex items-center gap-3 self-start rounded-2xl bg-white/95 py-2 ps-2.5 pe-4 text-ink shadow-sm sm:self-auto tt-print-pill">
            <DecisionGlyph decision={card.overall} className="size-9" />
            <div className="flex flex-col">
              <span className="text-[10px] leading-3.5 font-bold tracking-[0.12em] text-ink-3 uppercase">Overall</span>
              <span className={cx("font-sign text-[22px] leading-7 font-semibold", overall.text)}>{DECISION_LONG[card.overall]}</span>
            </div>
          </div>
        </div>
      </header>

      {/* Parks */}
      <div className="relative px-5 sm:px-8">
        <div className="divide-y divide-rule">
          {card.parks.map((p) => (
            <ParkRowSheet key={p.park_code} park={p} states={parkStates[p.park_code]} />
          ))}
          {card.parks.length === 0 && (
            <p className="py-10 text-center text-[14px] text-ink-3">No parks on this card.</p>
          )}
        </div>
      </div>

      {/* Footer */}
      <footer className="flex flex-col gap-3 border-t border-rule bg-black/[0.025] px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-8 tt-print-plain">
        <div className="flex flex-col gap-0.5">
          <p className="text-[12px] leading-4 font-semibold text-ink-2">
            {digested} NPS alerts distilled into one card · Verify on nps.gov before you go.
          </p>
          <p className="font-mono text-[10.5px] leading-4 break-all text-ink-3">
            {formatDate(card.generated_at, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })} · {card.model} · {card.workflow_id}
          </p>
        </div>
        <Legend />
      </footer>
    </div>
  );
}
