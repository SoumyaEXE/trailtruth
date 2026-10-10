"use client";

import Link from "next/link";
import { useMemo } from "react";
import {
  RiAddLine,
  RiArrowRightLine,
  RiArrowRightUpLine,
  RiCloseLine,
  RiPrinterLine,
  RiRefreshLine,
  RiSparkling2Line,
  RiTicket2Line,
} from "@remixicon/react";
import { Focusable } from "react-aria-components";
import { AgentThinking } from "@/components/application/agent-thinking/agent-thinking";
import { Button } from "@/components/base/buttons/button";
import { IconButton } from "@/components/base/buttons/icon-button";
import { Select, SelectItem } from "@/components/base/select/select";
import { Tooltip, TooltipTrigger } from "@/components/base/tooltip/tooltip";
import { Page, Panel } from "@/components/trail/app-shell";
import { NavButton } from "@/components/trail/nav-button";
import { DECISION_STYLES, DecisionBadge, DecisionGlyph } from "@/components/trail/decision";
import { StepTimeline } from "@/components/trail/step-timeline";
import { Topo } from "@/components/trail/topo";
import { getAlerts, getLatestCard, getParks } from "@/lib/api";
import { DECISION_RANK } from "@/lib/compose";
import { DECISION_LABEL, DECISION_LONG, formatDate, shortParkName, stepLabel } from "@/lib/format";
import { useWatchlist } from "@/lib/store";
import type { Decision, Park, ProcessedAlert } from "@/lib/types";
import { useCardGeneration } from "@/lib/use-generate";
import { useLoad } from "@/lib/use-load";
import { cx } from "@/utils/cx";

function nextSaturday(): string {
  const d = new Date();
  const add = (6 - d.getDay() + 7) % 7;
  d.setDate(d.getDate() + add);
  return d.toISOString().slice(0, 10);
}

function CountTile({ decision, count, total }: { decision: Decision; count: number; total: number }) {
  const s = DECISION_STYLES[decision];
  return (
    <div className={cx("flex min-w-0 flex-col gap-2 rounded-2xl border p-3 sm:p-4", s.border, s.surface)}>
      <div className="flex items-center justify-between gap-2">
        <span className={cx("inline-flex items-center gap-1.5 text-body-2-semibold whitespace-nowrap", s.text)}>
          <DecisionGlyph decision={decision} className="size-4" />
          {DECISION_LABEL[decision]}
        </span>
        <span className="hidden font-mono text-caption-1-regular text-text-tertiary tt-num sm:inline">{total ? Math.round((count / total) * 100) : 0}%</span>
      </div>
      <span className="tt-figure text-[34px] leading-10 text-text-primary tt-num">{count}</span>
    </div>
  );
}

function ParkRow({
  park,
  alerts,
  decision,
  headline,
  onRemove,
}: {
  park: Park;
  alerts: ProcessedAlert[];
  decision: Decision;
  headline?: string;
  onRemove: () => void;
}) {
  const sorted = [...alerts].sort(
    (a, b) => DECISION_RANK[b.verdict.decision] - DECISION_RANK[a.verdict.decision] || b.verdict.severity - a.verdict.severity,
  );
  const top = sorted[0];
  const closures = alerts.filter((a) => a.verdict.is_closed).length;
  return (
    <li className="group relative flex items-start gap-3 rounded-2xl border border-border-button-default bg-background-primary-default p-3.5 transition-colors hover:border-border-button-hover sm:p-4">
      <DecisionGlyph decision={decision} className="mt-0.5 size-7" title={DECISION_LABEL[decision]} />
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 pe-8">
          <h3 className="truncate text-headline-semibold text-text-primary">{shortParkName(park.park_name)}</h3>
          <span className="font-mono text-caption-1-medium text-text-tertiary uppercase">
            {park.park_code} · {park.states.replace(/,/g, ", ")}
          </span>
        </div>
        <p className="line-clamp-2 text-body-2-regular text-text-secondary">
          {headline ?? (top ? top.verdict.reason || top.title : "No active alerts — nothing between you and the trail.")}
        </p>
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <DecisionBadge decision={decision} size="sm" />
          <span className="rounded-md bg-background-secondary-default px-1.5 py-0.5 text-caption-1-medium text-text-secondary tt-num">
            {park.alert_count} alert{park.alert_count === 1 ? "" : "s"}
          </span>
          {closures > 0 && (
            <span className="rounded-md bg-nogo-surface px-1.5 py-0.5 text-caption-1-medium text-nogo-text tt-num">
              {closures} closure{closures === 1 ? "" : "s"}
            </span>
          )}
          <Link
            href={`/alerts?park=${park.park_code}`}
            className="ms-auto inline-flex items-center gap-0.5 rounded-md text-caption-1-semibold text-accent-600 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-border-focus-ring dark:text-accent-300"
          >
            Alerts <RiArrowRightUpLine className="size-3.5" aria-hidden />
          </Link>
        </div>
      </div>
      <TooltipTrigger delay={300}>
        <Focusable>
          <IconButton
            icon={RiCloseLine}
            size="small"
            aria-label={`Remove ${park.park_name} from watchlist`}
            onClick={onRemove}
            className="absolute end-3 top-3 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 sm:focus-visible:opacity-100"
          />
        </Focusable>
        <Tooltip>Remove</Tooltip>
      </TooltipTrigger>
    </li>
  );
}

function GenerationPanel({ gen, parkCount }: { gen: ReturnType<typeof useCardGeneration>; parkCount: number }) {
  const steps = gen.status?.steps ?? [];
  const done = steps.filter((s) => s.status === "completed").length;
  const total = steps.length || parkCount + 3;
  const current = steps.find((s) => s.status === "running" || s.status === "retrying");
  const retrying = steps.some((s) => s.status === "retrying");
  const label = current
    ? `${stepLabel(current.name).label}${stepLabel(current.name).target ? ` · ${stepLabel(current.name).target!.toUpperCase()}` : ""}${retrying ? " — NPS returned 503, retrying" : ""}`
    : "Starting Temporal workflow";
  const card = gen.status?.card;

  return (
    <Panel
      className="tt-rise"
      title={gen.phase === "done" ? "This week's card is ready" : "Generating this week's card"}
      description={
        <span className="font-mono text-caption-1-regular break-all text-text-tertiary">{gen.workflowId ?? "starting…"}</span>
      }
      actions={
        gen.phase === "done" ? (
          <>
            <Button variant="secondary" size="small" leadingIcon={RiRefreshLine} onClick={gen.reset}>
              Dismiss
            </Button>
            <NavButton href="/card" size="small" trailingIcon={RiArrowRightLine}>
              Open card
            </NavButton>
          </>
        ) : undefined
      }
    >
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_280px]">
        <div className="flex min-w-0 flex-col gap-4">
          {gen.phase !== "done" && gen.phase !== "error" && (
            <AgentThinking variant="wave" tone="primary" label={label} className="min-w-0 [&>span:nth-child(2)]:truncate" />
          )}
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-background-tertiary-default" role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={done} aria-label="Workflow progress">
            <div
              className={cx("h-full rounded-full transition-[width] duration-500 ease-out", gen.phase === "done" ? "bg-go-solid" : "bg-accent-500")}
              style={{ width: `${Math.max(4, (done / total) * 100)}%` }}
            />
          </div>
          {steps.length > 0 ? (
            <StepTimeline steps={steps} dense />
          ) : (
            <div className="flex flex-col gap-3">
              {Array.from({ length: 4 }, (_, i) => (
                <div key={i} className="h-6 animate-pulse rounded-lg bg-background-secondary-default" />
              ))}
            </div>
          )}
          {gen.error && <p className="text-body-2-medium text-nogo-text">{gen.error}</p>}
        </div>
        <aside className="flex flex-col gap-3 self-start rounded-2xl bg-background-secondary-default p-4">
          <p className="tt-eyebrow text-text-tertiary">Durable by design</p>
          <p className="text-body-2-regular text-text-secondary">
            Each step is a Temporal activity. If the NPS API flakes or a worker dies, the workflow retries or resumes from history. It never starts over and never double-classifies.
          </p>
          {card && (
            <div className="mt-1 flex flex-col gap-2 border-t border-separator-border pt-3">
              <p className="tt-eyebrow text-text-tertiary">Result</p>
              <DecisionBadge decision={card.overall} size="lg" long />
              <ul className="flex flex-col gap-1.5">
                {card.parks.map((p) => (
                  <li key={p.park_code} className="flex items-center gap-2 text-body-2-medium text-text-primary">
                    <DecisionGlyph decision={p.decision} className="size-3.5" />
                    <span className="truncate">{shortParkName(p.park_name)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </aside>
      </div>
    </Panel>
  );
}

export function OverviewView() {
  const parks = useLoad(getParks, "parks");
  const alerts = useLoad(() => getAlerts(), "alerts");
  const { list, add, remove } = useWatchlist();
  const gen = useCardGeneration();
  const latest = useLoad(getLatestCard, gen.phase === "done" ? `latest-${gen.workflowId}` : "latest");
  // The card's per-park call (which weighs closures against what's still open) wins over the raw worst alert.
  const cardPark = (code: string) => (gen.status?.card ?? latest.data?.card)?.parks.find((p) => p.park_code === code);
  const decisionFor = (p: Park): Decision => cardPark(p.park_code)?.decision ?? p.worst_decision ?? "go";

  const parkByCode = useMemo(() => new Map((parks.data ?? []).map((p) => [p.park_code, p])), [parks.data]);
  const watched = list.map((c) => parkByCode.get(c)).filter((p): p is Park => !!p);
  const options = useMemo(
    () =>
      (parks.data ?? [])
        .filter((p) => !list.includes(p.park_code) && p.park_name)
        .sort((a, b) => a.park_name.localeCompare(b.park_name)),
    [parks.data, list],
  );
  const alertsByPark = useMemo(() => {
    const m = new Map<string, ProcessedAlert[]>();
    for (const a of alerts.data ?? []) {
      if (!m.has(a.park_code)) m.set(a.park_code, []);
      m.get(a.park_code)!.push(a);
    }
    return m;
  }, [alerts.data]);

  const counts = { go: 0, caution: 0, no_go: 0 } as Record<Decision, number>;
  watched.forEach((p) => (counts[decisionFor(p)] += 1));
  const overall: Decision = watched.reduce<Decision>((w, p) => (DECISION_RANK[decisionFor(p)] > DECISION_RANK[w] ? decisionFor(p) : w), "go");
  const totalAlerts = watched.reduce((n, p) => n + p.alert_count, 0);
  const running = gen.phase === "starting" || gen.phase === "running";
  const loading = parks.loading;

  return (
    <Page>
      {/* Hero */}
      <section className="relative mb-6 overflow-hidden rounded-3xl border border-border-button-default bg-background-primary-default shadow-card">
        <Topo variant="hero" opacity={0.1} />
        <div className="relative grid gap-8 p-5 sm:p-8 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] lg:gap-10 lg:p-10">
          <div className="flex min-w-0 flex-col gap-5">
            <p className="tt-eyebrow flex flex-wrap items-center gap-x-2 text-text-tertiary">
              <span>Week of {formatDate(nextSaturday(), { month: "short", day: "numeric" })}</span>
              <span aria-hidden>·</span>
              <span>{watched.length} park{watched.length === 1 ? "" : "s"} watched</span>
            </p>
            <h1 className="font-sign text-[40px] leading-[44px] font-semibold tracking-[-0.02em] text-text-primary sm:text-[56px] sm:leading-[60px]">
              Check once.
              <br />
              <span className="text-pine">Then go outside.</span>
            </h1>
            <p className="max-w-[520px] text-body-regular text-text-secondary sm:text-[15px] sm:leading-6">
              TrailTruth reads every National Park Service alert for the parks you care about, distills them with a small open model, and gives you
              one printable go / no-go card. Then it gets out of your way.
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                leadingIcon={RiSparkling2Line}
                onClick={() => gen.start(list)}
                disabled={running || list.length === 0}
                aria-describedby={list.length === 0 ? "gen-hint" : undefined}
              >
                {running ? "Generating…" : "Generate this week's card"}
              </Button>
              <NavButton href="/card" variant="secondary" leadingIcon={RiTicket2Line}>
                View last card
              </NavButton>
            </div>
            {list.length === 0 && (
              <p id="gen-hint" className="text-body-2-regular text-text-tertiary">
                Add at least one park below to generate a card.
              </p>
            )}
          </div>

          <div className="flex min-w-0 flex-col justify-end gap-3">
            <div className="flex items-center justify-between gap-3 rounded-2xl border border-border-button-default bg-background-primary-default/80 p-3 backdrop-blur-sm sm:p-4">
              <div className="flex min-w-0 flex-col gap-0.5">
                <span className="tt-eyebrow text-text-tertiary">This week, overall</span>
                <span className="font-sign text-[26px] leading-8 font-semibold text-text-primary">
                  {loading ? "…" : watched.length ? DECISION_LONG[overall] : "Add a park"}
                </span>
                <span className="text-body-2-regular text-text-secondary tt-num">
                  {totalAlerts} NPS alerts across your parks → 1 card
                </span>
              </div>
              {watched.length > 0 && <DecisionGlyph decision={overall} className="size-12 shrink-0" />}
            </div>
            <div className="grid grid-cols-3 gap-2 sm:gap-3">
              {(["go", "caution", "no_go"] as Decision[]).map((d) => (
                <CountTile key={d} decision={d} count={counts[d]} total={watched.length} />
              ))}
            </div>
          </div>
        </div>
      </section>

      {gen.phase !== "idle" && (
        <div className="mb-6">
          <GenerationPanel gen={gen} parkCount={list.length} />
        </div>
      )}

      {/* Watchlist */}
      <Panel
        title="Your parks"
        description="Saved on this device only. We never send where you're going anywhere but the NPS API."
        actions={
          <Select
            aria-label="Add a park to your watchlist"
            placeholder="Add a park…"
            selectedKey={null}
            onSelectionChange={(k) => k && add(String(k))}
            className="w-full sm:w-[280px]"
            popoverClassName="w-[var(--trigger-width)] min-w-[280px]"
            renderValue={() => (
              <span className="flex items-center gap-1.5 text-text-secondary">
                <RiAddLine className="size-4" aria-hidden /> Add a park…
              </span>
            )}
          >
            {options.map((p) => (
              <SelectItem key={p.park_code} id={p.park_code} textValue={p.park_name}>
                <DecisionGlyph decision={p.worst_decision ?? "go"} className="size-3.5" />
                <span className="min-w-0 flex-1 truncate">{shortParkName(p.park_name)}</span>
                <span className="font-mono text-caption-1-regular text-text-tertiary uppercase">{p.park_code}</span>
              </SelectItem>
            ))}
          </Select>
        }
      >
        {loading ? (
          <ul className="grid gap-3 md:grid-cols-2">
            {Array.from({ length: 4 }, (_, i) => (
              <li key={i} className="h-[118px] animate-pulse rounded-2xl bg-background-secondary-default" />
            ))}
          </ul>
        ) : watched.length ? (
          <ul className="grid gap-3 md:grid-cols-2">
            {watched.map((p) => (
              <ParkRow
                key={p.park_code}
                park={p}
                alerts={alertsByPark.get(p.park_code) ?? []}
                decision={decisionFor(p)}
                headline={cardPark(p.park_code)?.headline}
                onRemove={() => remove(p.park_code)}
              />
            ))}
          </ul>
        ) : (
          <div className="relative flex flex-col items-center gap-3 overflow-hidden rounded-2xl border border-dashed border-border-button-hover px-6 py-14 text-center">
            <Topo variant="empty" opacity={0.12} />
            <p className="relative font-sign text-[22px] leading-7 font-semibold text-text-primary">No parks yet</p>
            <p className="relative max-w-[380px] text-body-2-regular text-text-secondary">
              Pick the parks you actually visit. TrailTruth only reads their alerts, and only once a week.
            </p>
          </div>
        )}
      </Panel>

      <div className="mt-6 grid gap-3 sm:grid-cols-3">
        {[
          { href: "/card", icon: RiPrinterLine, title: "Print it", body: "One sheet, black on white. Fits in a pack lid." },
          { href: "/alerts", icon: RiArrowRightUpLine, title: "Audit the model", body: "Every verdict next to the original NPS text." },
          { href: "/lab", icon: RiSparkling2Line, title: "See the distillation", body: "A small LoRA student vs. its big teacher, on held-out alerts." },
        ].map((x) => (
          <Link
            key={x.href}
            href={x.href}
            className="group flex items-start gap-3 rounded-2xl border border-border-button-default bg-background-primary-default p-4 outline-none transition-colors hover:border-border-button-hover focus-visible:ring-2 focus-visible:ring-border-focus-ring"
          >
            <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-accent-50 text-accent-700 dark:bg-accent-950 dark:text-accent-300">
              <x.icon className="size-4" aria-hidden />
            </span>
            <span className="flex min-w-0 flex-col gap-0.5">
              <span className="text-body-semibold text-text-primary">{x.title}</span>
              <span className="text-body-2-regular text-text-secondary">{x.body}</span>
            </span>
          </Link>
        ))}
      </div>
    </Page>
  );
}
