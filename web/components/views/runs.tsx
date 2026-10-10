"use client";

import { useMemo, useState } from "react";
import { RiRefreshLine, RiRestartLine, RiTicket2Line } from "@remixicon/react";
import { Button } from "@/components/base/buttons/button";
import { Chip } from "@/components/base/badges/chip";
import { Page, PageHeader, Panel } from "@/components/trail/app-shell";
import { NavButton } from "@/components/trail/nav-button";
import { StepTimeline } from "@/components/trail/step-timeline";
import { Topo } from "@/components/trail/topo";
import { getRuns, isSimulated } from "@/lib/api";
import { durationMs, formatDate, formatDuration, relativeTime, stepFlag, stepLabel } from "@/lib/format";
import { setLastWorkflow } from "@/lib/store";
import type { WorkflowRun } from "@/lib/types";
import { useLoad } from "@/lib/use-load";
import { cx } from "@/utils/cx";

function runFlags(run: WorkflowRun) {
  const flags = run.steps.map(stepFlag);
  return {
    retries: run.retries ?? run.steps.filter((s) => s.attempt > 1).length,
    resumed: !!run.resumed_after_crash || flags.includes("resumed"),
  };
}

function StatusDot({ status }: { status: string }) {
  const tone =
    status === "completed" ? "bg-go-solid" : status === "failed" ? "bg-nogo-solid" : status === "running" ? "bg-accent-500 tt-pulse text-accent-500" : "bg-foreground-icon-quaternary";
  return <span className={cx("relative size-2 shrink-0 rounded-full", tone)} aria-hidden />;
}

function Waterfall({ run }: { run: WorkflowRun }) {
  const starts = run.steps.map((s) => (s.started_at ? new Date(s.started_at).getTime() : NaN)).filter(Number.isFinite);
  const ends = run.steps.map((s) => (s.ended_at ? new Date(s.ended_at).getTime() : NaN)).filter(Number.isFinite);
  if (!starts.length) return null;
  const t0 = Math.min(...starts);
  const t1 = Math.max(...ends, ...starts) + 1;
  const span = Math.max(t1 - t0, 1);
  return (
    <div className="flex flex-col gap-1.5" aria-label="Step waterfall" role="img">
      {run.steps.map((s, i) => {
        const a = s.started_at ? new Date(s.started_at).getTime() : t0;
        const b = s.ended_at ? new Date(s.ended_at).getTime() : a;
        const left = ((a - t0) / span) * 100;
        const width = Math.max(1.2, ((b - a) / span) * 100);
        const flag = stepFlag(s);
        const { label, target } = stepLabel(s.name);
        return (
          <div key={i} className="grid grid-cols-[120px_minmax(0,1fr)] items-center gap-3 sm:grid-cols-[150px_minmax(0,1fr)]">
            <span className="truncate text-caption-1-medium text-text-secondary">
              {label}
              {target ? <span className="font-mono text-text-tertiary uppercase"> · {target}</span> : null}
            </span>
            <span className="relative h-4 rounded bg-background-secondary-default">
              <span
                className={cx(
                  "absolute inset-y-0 rounded",
                  s.status === "failed" ? "bg-nogo-solid" : flag === "retried" ? "bg-caution-solid" : flag === "resumed" ? "bg-sky" : s.status === "completed" ? "bg-go-solid" : "bg-accent-400",
                )}
                style={{ left: `${left}%`, width: `${Math.min(width, 100 - left)}%` }}
                title={`${s.name}: ${formatDuration(durationMs(s.started_at, s.ended_at))}`}
              />
            </span>
          </div>
        );
      })}
      <div className="grid grid-cols-[120px_minmax(0,1fr)] gap-3 sm:grid-cols-[150px_minmax(0,1fr)]">
        <span />
        <span className="flex justify-between font-mono text-caption-2-regular text-text-tertiary tt-num">
          <span>0s</span>
          <span>{formatDuration(span)}</span>
        </span>
      </div>
    </div>
  );
}

export function RunsView() {
  const { data, loading, reload, source } = useLoad(getRuns, "runs");
  const runs = useMemo(
    () => [...(data ?? [])].sort((a, b) => (b.started_at ?? "").localeCompare(a.started_at ?? "")),
    [data],
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = runs.find((r) => r.workflow_id === selectedId) ?? runs[0];

  const totals = useMemo(() => {
    const t = { runs: runs.length, completed: 0, retries: 0, resumed: 0 };
    runs.forEach((r) => {
      const f = runFlags(r);
      if (r.status === "completed") t.completed++;
      t.retries += f.retries;
      if (f.resumed) t.resumed++;
    });
    return t;
  }, [runs]);

  return (
    <Page wide>
      <PageHeader
        eyebrow="Temporal"
        title="Workflow runs"
        description="One workflow a week: fetch alerts for your parks, classify, compose, publish. Flaky APIs get retried and crashed workers get resumed. Both are highlighted here, not hidden."
        actions={
          <Button variant="secondary" leadingIcon={RiRefreshLine} onClick={reload}>
            Refresh
          </Button>
        }
      />

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          { label: "Runs", value: totals.runs },
          { label: "Completed", value: totals.completed },
          { label: "Activity retries", value: totals.retries },
          { label: "Resumed after crash", value: totals.resumed },
        ].map((s) => (
          <div key={s.label} className="flex flex-col gap-1 rounded-2xl border border-border-button-default bg-background-primary-default px-4 py-3">
            <span className="text-caption-1-medium text-text-tertiary">{s.label}</span>
            <span className="tt-figure text-[26px] leading-8 text-text-primary tt-num">{loading ? "…" : s.value}</span>
          </div>
        ))}
      </div>

      {loading ? (
        <div className="grid gap-4 lg:grid-cols-[380px_minmax(0,1fr)]">
          <div className="h-[420px] animate-pulse rounded-2xl bg-background-secondary-default" />
          <div className="h-[420px] animate-pulse rounded-2xl bg-background-secondary-default" />
        </div>
      ) : runs.length === 0 ? (
        <div className="relative flex flex-col items-center gap-3 overflow-hidden rounded-3xl border border-dashed border-border-button-hover px-6 py-20 text-center">
          <Topo variant="empty" opacity={0.12} />
          <p className="relative font-sign text-[24px] leading-8 font-semibold text-text-primary">No runs yet</p>
          <p className="relative text-body-2-regular text-text-secondary">Generate a card from the Overview to start one.</p>
        </div>
      ) : (
        <div className="grid items-start gap-4 lg:grid-cols-[380px_minmax(0,1fr)]">
          <Panel title="Recent runs" padded={false}>
            <ul className="flex flex-col p-1.5" role="listbox" aria-label="Workflow runs">
              {runs.map((r) => {
                const f = runFlags(r);
                const active = r.workflow_id === selected?.workflow_id;
                return (
                  <li key={r.workflow_id} role="option" aria-selected={active}>
                    <button
                      type="button"
                      onClick={() => setSelectedId(r.workflow_id)}
                      className={cx(
                        "flex w-full cursor-pointer flex-col gap-1.5 rounded-xl px-3 py-2.5 text-start outline-none transition-colors focus-visible:ring-2 focus-visible:ring-border-focus-ring",
                        active ? "bg-background-secondary-default ring-1 ring-border-button-default" : "hover:bg-background-secondary-default/70",
                      )}
                    >
                      <span className="flex items-center gap-2">
                        <StatusDot status={r.status} />
                        <span className="min-w-0 flex-1 truncate font-mono text-caption-1-medium text-text-primary">{r.workflow_id}</span>
                      </span>
                      <span className="flex flex-wrap items-center gap-1.5 ps-4">
                        {(r.parks ?? []).map((p) => (
                          <span key={p} className="rounded bg-background-tertiary-default px-1 font-mono text-caption-2-medium text-text-secondary uppercase">
                            {p}
                          </span>
                        ))}
                        {f.retries > 0 && (
                          <Chip variant="caption" color="yellow" className="gap-1 py-0">
                            <RiRefreshLine className="size-3" aria-hidden /> {f.retries} retr{f.retries === 1 ? "y" : "ies"}
                          </Chip>
                        )}
                        {f.resumed && (
                          <Chip variant="caption" color="blue" className="gap-1 py-0">
                            <RiRestartLine className="size-3" aria-hidden /> Resumed
                          </Chip>
                        )}
                        {isSimulated(r.workflow_id) && (
                          <Chip variant="caption" color="soft" className="py-0">
                            Simulated
                          </Chip>
                        )}
                        <span className="ms-auto text-caption-1-regular text-text-tertiary">{relativeTime(r.started_at)}</span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </Panel>

          {selected && (
            <Panel
              key={selected.workflow_id}
              className="tt-rise"
              title={<span className="font-mono text-body-2-semibold break-all">{selected.workflow_id}</span>}
              description={`Started ${formatDate(selected.started_at, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit" })}`}
              actions={
                selected.status === "completed" && ((source === "live" && selected.card_id) || isSimulated(selected.workflow_id)) ? (
                  <NavButton href="/card" size="small" variant="secondary" leadingIcon={RiTicket2Line} onClick={() => setLastWorkflow(selected.workflow_id)}>
                    Open card
                  </NavButton>
                ) : undefined
              }
            >
              <div className="flex flex-col gap-6">
                {runFlags(selected).resumed && (
                  <div className="flex items-start gap-3 rounded-xl border border-sky bg-sky-surface px-3 py-2.5">
                    <RiRestartLine className="mt-0.5 size-4 shrink-0 text-sky" aria-hidden />
                    <div className="flex min-w-0 flex-col gap-0.5">
                      <p className="text-body-2-semibold text-text-primary">Resumed after worker crash</p>
                      <p className="text-caption-1-regular break-words text-text-secondary">
                        A worker died mid-run. Temporal replayed the event history on a fresh worker and continued; completed activities were not re-run.
                        {selected.workers?.length ? (
                          <span className="font-mono"> {selected.workers.join(" → ")}</span>
                        ) : null}
                      </p>
                    </div>
                  </div>
                )}
                <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
                  {[
                    { k: "Status", v: selected.status },
                    { k: "Duration", v: formatDuration(durationMs(selected.started_at, selected.ended_at)) },
                    { k: "Activities", v: String(selected.steps.length) },
                    { k: "Total attempts", v: String(selected.steps.reduce((n, s) => n + Math.max(1, s.attempt), 0)) },
                    ...(selected.history_events != null ? [{ k: "History events", v: String(selected.history_events) }] : []),
                    ...(selected.workers?.length ? [{ k: selected.workers.length > 1 ? "Workers" : "Worker", v: String(selected.workers.length) }] : []),
                  ].map((x) => (
                    <div key={x.k} className="rounded-xl bg-background-secondary-default px-3 py-2">
                      <dt className="text-caption-1-medium text-text-tertiary">{x.k}</dt>
                      <dd className="font-mono text-body-2-semibold text-text-primary capitalize tt-num">{x.v}</dd>
                    </div>
                  ))}
                </dl>
                <section className="flex flex-col gap-3">
                  <h3 className="tt-eyebrow text-text-tertiary">Waterfall</h3>
                  <Waterfall run={selected} />
                </section>
                <section className="flex flex-col gap-3">
                  <h3 className="tt-eyebrow text-text-tertiary">Event timeline</h3>
                  <StepTimeline steps={selected.steps} />
                </section>
              </div>
            </Panel>
          )}
        </div>
      )}
    </Page>
  );
}
