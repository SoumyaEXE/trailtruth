"use client";

import { useMemo, useState } from "react";
import {
  RiCheckboxCircleLine,
  RiCloseCircleLine,
  RiCodeSSlashLine,
  RiFlaskLine,
  RiHourglassLine,
  RiMoneyDollarCircleLine,
  RiTimerFlashLine,
} from "@remixicon/react";
import { Area, AreaChart, CartesianGrid, PolarAngleAxis, RadialBar, RadialBarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { AgentThinking } from "@/components/application/agent-thinking/agent-thinking";
import { Chip } from "@/components/base/badges/chip";
import { SegmentedControl, SegmentedControlItem } from "@/components/base/segmented-control/segmented-control";
import { Select, SelectItem } from "@/components/base/select/select";
import { Tab, TabList, TabPanel, Tabs } from "@/components/base/tabs/tabs";
import { Page, PageHeader, Panel } from "@/components/trail/app-shell";
import { DecisionBadge } from "@/components/trail/decision";
import { Topo } from "@/components/trail/topo";
import { getEval } from "@/lib/api";
import { formatDate, pct, usd } from "@/lib/format";
import { MOCK_EVAL } from "@/lib/mock";
import type { Decision, EvalModel, EvalResults } from "@/lib/types";
import { useLoad } from "@/lib/use-load";
import { cx } from "@/utils/cx";

const ROLE_ORDER = ["lora", "teacher", "base", "base_guided", "heuristic"];
const ROLE_LABEL: Record<string, string> = {
  lora: "LoRA student",
  teacher: "Teacher",
  base: "Base student",
  base_guided: "Base + long prompt",
  heuristic: "Keyword heuristic",
};
const roleLabel = (r: string) => ROLE_LABEL[r] ?? r;
const roleColor = (role: string) => `var(--tt-m-${ROLE_ORDER.includes(role) ? role : "heuristic"})`;
const ready = (m?: EvalModel): m is EvalModel => !!m && !m.pending && m.decision_acc != null;
const cleanName = (n: string) => n.replace(/\s*\[placeholder\]/i, "");

type Metric = "json_valid" | "decision_acc" | "closure_f1" | "hazard_acc";
const QUALITY: { key: Metric; label: string; hint: string }[] = [
  { key: "decision_acc", label: "Decision accuracy", hint: "go / caution / no_go vs. the NPS category label" },
  { key: "json_valid", label: "Valid JSON", hint: "Parses and matches the TrailVerdict schema" },
  { key: "closure_f1", label: "Closure F1", hint: "is_closed vs. gold closure label" },
  { key: "hazard_acc", label: "Hazard accuracy", hint: "hazard_type agreement with the teacher" },
];

function sortModels(models: EvalModel[]) {
  const idx = (r: string) => (ROLE_ORDER.indexOf(r) < 0 ? 99 : ROLE_ORDER.indexOf(r));
  return [...models].sort((a, b) => idx(a.role) - idx(b.role));
}

function Swatch({ role, pending }: { role: string; pending?: boolean }) {
  return (
    <span
      className={cx("size-2.5 shrink-0 rounded-[3px]", pending && "opacity-50")}
      style={{ background: pending ? `repeating-linear-gradient(45deg, ${roleColor(role)} 0 2px, transparent 2px 4px)` : roleColor(role), boxShadow: pending ? `inset 0 0 0 1px ${roleColor(role)}` : undefined }}
      aria-hidden
    />
  );
}

function Legend({ models }: { models: EvalModel[] }) {
  return (
    <ul className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
      {models.map((m) => (
        <li key={m.name} className="flex items-center gap-1.5 text-caption-1-medium" title={cleanName(m.name)}>
          <Swatch role={m.role} pending={!ready(m)} />
          <span className="text-text-primary">{roleLabel(m.role)}</span>
          {!ready(m) && <span className="text-text-tertiary">· training</span>}
        </li>
      ))}
    </ul>
  );
}

function BarList({
  models,
  value,
  format,
  max,
  better = "high",
}: {
  models: EvalModel[];
  value: (m: EvalModel) => number | null;
  format: (v: number) => string;
  max?: number;
  better?: "high" | "low";
}) {
  const vals = models.map(value).filter((v): v is number => v != null);
  const top = max ?? Math.max(...vals, 1e-9);
  const best = vals.length ? (better === "high" ? Math.max(...vals) : Math.min(...vals)) : null;
  return (
    <ul className="flex flex-col gap-2">
      {models.map((m) => {
        const v = ready(m) ? value(m) : null;
        const w = v != null && top > 0 ? Math.max(1.5, (v / top) * 100) : 0;
        return (
          <li
            key={m.name}
            className="group grid grid-cols-[minmax(0,128px)_minmax(0,1fr)_60px] items-center gap-2"
            title={`${cleanName(m.name)}: ${v != null ? format(v) : "awaiting training run"}`}
          >
            <span className="truncate text-caption-1-medium text-text-secondary">{roleLabel(m.role)}</span>
            <span className="relative h-5 overflow-hidden rounded-md bg-background-secondary-default">
              {v != null ? (
                <span
                  className="absolute inset-y-0 start-0 rounded-md transition-[width,opacity] duration-500 ease-out group-hover:opacity-85"
                  style={{ width: `${w}%`, background: roleColor(m.role) }}
                />
              ) : (
                <span
                  className="absolute inset-0 animate-pulse rounded-md opacity-40"
                  style={{ background: `repeating-linear-gradient(45deg, ${roleColor(m.role)} 0 2px, transparent 2px 7px)` }}
                />
              )}
            </span>
            <span className={cx("text-end font-mono text-caption-1-medium tt-num", v != null && v === best ? "text-text-primary" : "text-text-tertiary")}>
              {v != null ? format(v) : "—"}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

const fmtPct = (v: number | null) => (v == null ? "—" : pct(v));

function QualityTable({ models }: { models: EvalModel[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="bui-table bui-table-sm min-w-[720px]">
        <thead>
          <tr>
            <th>Model</th>
            {QUALITY.map((q) => (
              <th key={q.key} className="!text-end">{q.label}</th>
            ))}
            <th className="!text-end">p50 latency</th>
            <th className="!text-end">$ / 1k alerts</th>
          </tr>
        </thead>
        <tbody>
          {models.map((m) => (
            <tr key={m.name}>
              <td>
                <span className="flex items-center gap-2">
                  <Swatch role={m.role} pending={!ready(m)} />
                  <span className="truncate">{cleanName(m.name)}</span>
                  {!ready(m) && <Chip variant="caption" color="soft" className="py-0">pending</Chip>}
                </span>
              </td>
              {QUALITY.map((q) => (
                <td key={q.key} className="text-end font-mono tt-num">{fmtPct(m[q.key])}</td>
              ))}
              <td className="text-end font-mono tt-num">{m.p50_latency_ms == null ? "—" : `${Math.round(m.p50_latency_ms).toLocaleString()} ms`}</td>
              <td className="text-end font-mono tt-num">{m.cost_per_1k_alerts_usd == null ? "—" : usd(m.cost_per_1k_alerts_usd)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Kpi({ icon: Icon, label, value, sub, pending }: { icon: typeof RiFlaskLine; label: string; value: string; sub: string; pending?: boolean }) {
  return (
    <div className={cx("flex min-w-0 flex-col gap-1.5 rounded-2xl border p-4", pending ? "border-dashed border-border-button-hover bg-background-secondary-default" : "border-border-button-default bg-background-primary-default")}>
      <span className="flex items-center gap-1.5 text-caption-1-medium text-text-tertiary">
        <Icon className="size-3.5" aria-hidden />
        <span className="truncate">{label}</span>
      </span>
      <span className={cx("tt-figure text-[28px] leading-8 tt-num", pending ? "text-text-tertiary" : "text-text-primary")}>{value}</span>
      <span className="text-caption-1-regular text-text-secondary">{sub}</span>
    </div>
  );
}

function ParityRadial({ student, teacher }: { student?: EvalModel; teacher?: EvalModel }) {
  const s = student?.decision_acc ?? null;
  const t = teacher?.decision_acc ?? null;
  const parity = s != null && t != null && t > 0 ? s / t : 0;
  const data = [{ name: "parity", value: Math.min(100, Math.round(parity * 100)), fill: student ? roleColor(student.role) : "var(--tt-m-lora)" }];
  return (
    <div className="flex flex-col items-center gap-3">
      <div className="relative size-[180px]">
        <ResponsiveContainer width="100%" height="100%">
          <RadialBarChart data={data} innerRadius="74%" outerRadius="100%" startAngle={90} endAngle={-270} barSize={14}>
            <PolarAngleAxis type="number" domain={[0, 100]} tick={false} axisLine={false} />
            <RadialBar dataKey="value" background={{ fill: "var(--color-chart-track)" }} cornerRadius={8} isAnimationActive animationDuration={700} />
          </RadialBarChart>
        </ResponsiveContainer>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="tt-figure text-[34px] leading-10 text-text-primary tt-num">{Math.round(parity * 100)}%</span>
          <span className="text-caption-1-medium text-text-tertiary">{parity > 1 ? "beats teacher" : "of teacher"}</span>
        </div>
      </div>
      <p className="max-w-[260px] text-center text-body-2-regular text-text-secondary">
        Decision accuracy of the <span className="font-medium text-text-primary">{student ? roleLabel(student.role).toLowerCase() : "student"}</span> relative to the
        teacher{student?.role !== "lora" ? ". The LoRA student replaces it once training lands" : ""}.
      </p>
    </div>
  );
}

function LossCurve({ curve }: { curve: [number, number][] }) {
  const data = curve.map(([step, loss]) => ({ step, loss }));
  return (
    <div className="h-[240px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -12 }}>
          <defs>
            <linearGradient id="lossFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--tt-m-lora)" stopOpacity={0.28} />
              <stop offset="100%" stopColor="var(--tt-m-lora)" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid vertical={false} stroke="var(--color-separator-border)" strokeDasharray="3 4" />
          <XAxis dataKey="step" tickLine={false} axisLine={false} tickMargin={8} minTickGap={28} interval="preserveStartEnd" tick={{ fontSize: 12, fill: "var(--color-text-tertiary)" }} />
          <YAxis tickLine={false} axisLine={false} width={44} tick={{ fontSize: 12, fill: "var(--color-text-tertiary)" }} tickFormatter={(v: number) => v.toFixed(1)} />
          <Tooltip
            cursor={{ stroke: "var(--color-chart-cursor)", strokeWidth: 1, strokeDasharray: "4 4" }}
            content={({ active, payload }) =>
              active && payload?.length ? (
                <div className="rounded-lg border border-border-button-default bg-background-primary-default px-2.5 py-1.5 shadow-dropdown">
                  <p className="text-caption-1-medium text-text-tertiary">Step {String(payload[0].payload.step)}</p>
                  <p className="font-mono text-caption-1-semibold text-text-primary tt-num">loss {Number(payload[0].value).toFixed(3)}</p>
                </div>
              ) : null
            }
          />
          <Area type="monotone" dataKey="loss" stroke="var(--tt-m-lora)" strokeWidth={2} fill="url(#lossFill)" activeDot={{ r: 4, strokeWidth: 2, stroke: "var(--color-background-primary-default)" }} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

function Confusion({ labels, matrix, role }: { labels: string[]; matrix: number[][]; role: string }) {
  const max = Math.max(...matrix.flat(), 1);
  const total = matrix.flat().reduce((a, b) => a + b, 0);
  const correct = matrix.reduce((n, row, i) => n + (row[i] ?? 0), 0);
  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-[76px_repeat(3,minmax(0,1fr))] gap-1.5" role="table" aria-label="Confusion matrix (rows: expected, columns: predicted)">
        <div role="row" className="contents">
          <span className="self-end text-caption-2-medium text-text-tertiary" role="columnheader">
            exp ↓ pred →
          </span>
          {labels.map((l) => (
            <span key={l} role="columnheader" className="flex justify-center">
              <DecisionBadge decision={l as Decision} size="sm" />
            </span>
          ))}
        </div>
        {matrix.map((row, i) => {
          const rowTotal = row.reduce((a, b) => a + b, 0) || 1;
          return (
            <div role="row" key={labels[i]} className="contents">
              <span role="rowheader" className="flex items-center">
                <DecisionBadge decision={labels[i] as Decision} size="sm" />
              </span>
              {row.map((v, j) => {
                const t = v / max;
                const diag = i === j;
                const strong = diag && t > 0.55;
                return (
                  <span
                    role="cell"
                    key={j}
                    title={`Expected ${labels[i]}, predicted ${labels[j]}: ${v}`}
                    className="flex aspect-[1.5] flex-col items-center justify-center rounded-lg border border-border-button-default"
                    style={{
                      background: diag
                        ? `color-mix(in oklab, ${roleColor(role)} ${Math.round(10 + t * 72)}%, var(--color-background-primary-default))`
                        : `color-mix(in oklab, var(--color-text-tertiary) ${Math.round(t * 40)}%, var(--color-background-primary-default))`,
                    }}
                  >
                    <span className={cx("font-mono text-body-semibold tt-num", strong ? "text-white" : "text-text-primary")}>{v}</span>
                    <span className={cx("font-mono text-caption-2-regular tt-num", strong ? "text-white/80" : "text-text-tertiary")}>{Math.round((v / rowTotal) * 100)}%</span>
                  </span>
                );
              })}
            </div>
          );
        })}
      </div>
      <p className="text-caption-1-regular text-text-tertiary tt-num">
        {correct}/{total} on the diagonal. Rows are the gold label and columns the model&apos;s decision. Most misses are between neighboring levels.
      </p>
    </div>
  );
}

function parseVerdict(s: string | null | undefined): Record<string, unknown> | null {
  if (!s) return null;
  try {
    const o = JSON.parse(s);
    return o && typeof o === "object" && "decision" in o ? o : null;
  } catch {
    return null;
  }
}

function OutputBlock({ label, role, output, expected }: { label: string; role: string; output: string | null | undefined; expected: string }) {
  if (output == null) {
    return (
      <div className="flex min-w-0 flex-col gap-2">
        <span className="flex items-center gap-1.5 text-caption-1-semibold text-text-primary">
          <Swatch role={role} pending />
          {label}
        </span>
        <div className="flex min-h-[132px] flex-col items-center justify-center gap-1.5 rounded-xl border border-dashed border-border-button-hover px-3 text-center">
          <RiHourglassLine className="size-4 text-foreground-icon-tertiary" aria-hidden />
          <span className="text-caption-1-medium text-text-tertiary">Awaiting training run</span>
        </div>
      </div>
    );
  }
  const v = parseVerdict(output);
  const decision = v?.decision as string | undefined;
  const right = decision === expected;
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <span className="flex min-w-0 items-center gap-1.5 text-caption-1-semibold text-text-primary">
          <Swatch role={role} />
          <span className="truncate">{label}</span>
        </span>
        {v ? (
          <span className={cx("inline-flex shrink-0 items-center gap-1 text-caption-1-semibold", right ? "text-go-text" : "text-caution-text")}>
            {right ? <RiCheckboxCircleLine className="size-3.5" aria-hidden /> : <RiCloseCircleLine className="size-3.5" aria-hidden />}
            {right ? "Correct" : "Wrong call"}
          </span>
        ) : (
          <span className="inline-flex shrink-0 items-center gap-1 text-caption-1-semibold text-nogo-text">
            <RiCloseCircleLine className="size-3.5" aria-hidden /> Invalid JSON
          </span>
        )}
      </div>
      <pre
        className={cx(
          "min-h-[132px] overflow-x-auto rounded-xl border p-3 font-mono text-caption-1-regular leading-5 whitespace-pre-wrap break-words",
          v ? "border-border-button-default bg-background-secondary-default text-text-primary" : "border-nogo-border bg-nogo-surface text-nogo-text",
        )}
      >
        {v ? JSON.stringify(v, null, 2) : output}
      </pre>
    </div>
  );
}

function PendingState({ onPreview }: { onPreview: () => void }) {
  return (
    <section className="relative overflow-hidden rounded-3xl border border-dashed border-border-button-hover bg-background-primary-default">
      <Topo variant="empty" opacity={0.12} />
      <div className="relative flex flex-col items-center gap-5 px-6 py-16 text-center sm:py-20">
        <span className="flex size-12 items-center justify-center rounded-2xl bg-accent-50 text-accent-700 dark:bg-accent-950 dark:text-accent-300">
          <RiFlaskLine className="size-6" aria-hidden />
        </span>
        <div className="flex flex-col gap-2">
          <h2 className="font-sign text-[28px] leading-9 font-semibold text-text-primary">Awaiting training run</h2>
          <p className="max-w-[480px] text-body-regular text-text-secondary">
            No evaluation results yet. They will appear here as soon as <code className="rounded bg-background-secondary-default px-1 font-mono text-caption-1-medium">ml/results/eval.json</code> lands.
          </p>
        </div>
        <AgentThinking variant="infinity" label="Waiting for eval.json" showTimer={false} />
        <button type="button" onClick={onPreview} className="rounded-md text-body-2-semibold text-accent-600 underline-offset-2 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-border-focus-ring dark:text-accent-300">
          Preview the layout with sample numbers
        </button>
      </div>
    </section>
  );
}

function PendingBanner({ model }: { model: EvalModel }) {
  return (
    <div className="relative flex flex-col gap-3 overflow-hidden rounded-2xl border border-dashed border-accent-300 bg-accent-50/60 p-4 sm:flex-row sm:items-center sm:justify-between dark:border-accent-800 dark:bg-accent-950/40">
      <div className="flex items-start gap-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-background-primary-default text-accent-700 shadow-xs dark:text-accent-300">
          <RiHourglassLine className="size-5" aria-hidden />
        </span>
        <div className="flex flex-col gap-0.5">
          <p className="text-body-semibold text-text-primary">LoRA student: awaiting training run</p>
          <p className="text-body-2-regular text-text-secondary">
            <span className="font-mono text-caption-1-medium">{cleanName(model.name)}</span> is queued on Tinker. Teacher, base and heuristic rows below are real
            measurements on the same held-out set. The LoRA row fills in when training finishes.
          </p>
        </div>
      </div>
      <AgentThinking variant="wave" label="Training" showTimer={false} className="shrink-0" />
    </div>
  );
}

export function LabView() {
  const { data, loading } = useLoad(getEval, "eval");
  const [preview, setPreview] = useState(false);
  const [view, setView] = useState<"chart" | "table">("chart");
  const [example, setExample] = useState(0);

  const evalData: EvalResults | undefined = useMemo(() => (data?.pending && preview ? { ...MOCK_EVAL, pending: false } : data), [data, preview]);
  const models = useMemo(() => sortModels(evalData?.models ?? []), [evalData]);
  const by = (role: string) => models.find((m) => m.role === role);
  const lora = by("lora");
  const base = by("base");
  const teacher = by("teacher");
  const student = ready(lora) ? lora : base;
  const allPending = !!evalData && (evalData.pending || models.length === 0 || models.every((m) => !ready(m)));
  const placeholder = !!evalData && (evalData.fixture || /placeholder/i.test(evalData.note ?? "") || (data?.pending && preview));

  const confusionKeys = useMemo(() => {
    const keys = Object.keys(evalData?.confusion ?? {});
    return keys.sort((a, b) => (ROLE_ORDER.indexOf(a) < 0 ? 99 : ROLE_ORDER.indexOf(a)) - (ROLE_ORDER.indexOf(b) < 0 ? 99 : ROLE_ORDER.indexOf(b)));
  }, [evalData]);
  const [confusionPick, setConfusionPick] = useState<string | null>(null);
  const confusionKey = confusionPick && confusionKeys.includes(confusionPick) ? confusionPick : confusionKeys.includes("lora") ? "lora" : confusionKeys.includes("base") ? "base" : confusionKeys[0];
  const confusion = confusionKey ? evalData?.confusion[confusionKey] : undefined;
  const examples = evalData?.examples ?? [];
  const ex = examples[Math.min(example, Math.max(0, examples.length - 1))];

  const speedup = (m?: EvalModel) =>
    m?.p50_latency_ms && teacher?.p50_latency_ms ? teacher.p50_latency_ms / m.p50_latency_ms : null;
  const cheaper = (m?: EvalModel) =>
    m?.cost_per_1k_alerts_usd && teacher?.cost_per_1k_alerts_usd ? teacher.cost_per_1k_alerts_usd / m.cost_per_1k_alerts_usd : null;

  return (
    <Page wide>
      <PageHeader
        eyebrow={
          evalData
            ? `Held-out test set · n=${evalData.test_size} · ${formatDate(evalData.generated_at)}`
            : "Distillation"
        }
        title="Model Lab"
        description={
          evalData?.teacher_model && evalData?.student_model
            ? `Can ${evalData.student_model.split("/").pop()}, LoRA-tuned on Tinker with labels from ${evalData.teacher_model.split("/").pop()}, read NPS alerts as well as its teacher? Every model is scored on the same held-out alerts.`
            : "Can a small open model, LoRA-tuned on Tinker with labels from a large teacher, read NPS alerts as well as the teacher? Every model is scored on the same held-out alerts."
        }
        actions={
          placeholder ? (
            <Chip variant="caption" color="yellow">Placeholder numbers</Chip>
          ) : evalData && !allPending ? (
            <Chip variant="caption" color="lime">Measured · ml/results/eval.json</Chip>
          ) : undefined
        }
      />

      {loading ? (
        <div className="grid gap-4 lg:grid-cols-4">
          {Array.from({ length: 4 }, (_, i) => (
            <div key={i} className="h-[120px] animate-pulse rounded-2xl bg-background-secondary-default" />
          ))}
        </div>
      ) : !evalData || (allPending && !preview) ? (
        <PendingState onPreview={() => setPreview(true)} />
      ) : (
        <div className="flex flex-col gap-4">
          {placeholder && (
            <p className="rounded-xl border border-caution-border bg-caution-surface px-3 py-2 text-body-2-medium text-caution-text">
              Placeholder numbers that show the layout. The real Tinker run replaces them.
            </p>
          )}
          {lora && !ready(lora) && <PendingBanner model={lora} />}

          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {ready(lora) ? (
              <Kpi
                icon={RiFlaskLine}
                label="Decision accuracy · LoRA"
                value={fmtPct(lora.decision_acc)}
                sub={base?.decision_acc != null && lora.decision_acc != null ? `${lora.decision_acc >= base.decision_acc ? "+" : ""}${Math.round((lora.decision_acc - base.decision_acc) * 100)} pts vs. base` : "—"}
              />
            ) : (
              <Kpi icon={RiFlaskLine} label="Decision accuracy · LoRA" value="Training…" sub="Awaiting Tinker run" pending />
            )}
            {ready(lora) ? (
              <Kpi
                icon={RiCodeSSlashLine}
                label="Hazard accuracy · LoRA"
                value={fmtPct(lora.hazard_acc)}
                sub={base?.hazard_acc != null ? `base ${pct(base.hazard_acc)} · teacher ${fmtPct(teacher?.hazard_acc ?? null)}` : "—"}
              />
            ) : (
              <Kpi
                icon={RiCodeSSlashLine}
                label={`Decision accuracy · ${student ? roleLabel(student.role) : "student"}`}
                value={fmtPct(student?.decision_acc ?? null)}
                sub={teacher?.decision_acc != null ? `teacher ${pct(teacher.decision_acc)}` : "—"}
              />
            )}
            <Kpi
              icon={RiTimerFlashLine}
              label={`p50 latency · ${student ? roleLabel(student.role) : "student"}`}
              value={student?.p50_latency_ms != null ? `${Math.round(student.p50_latency_ms).toLocaleString()} ms` : "—"}
              sub={speedup(student) ? (speedup(student)! < 1.25 ? "≈ teacher on hosted Tinker (network-bound)" : `${speedup(student)!.toFixed(1)}× faster than teacher`) : "—"}
            />
            <Kpi
              icon={RiMoneyDollarCircleLine}
              label={`Cost / 1k alerts · ${student ? roleLabel(student.role) : "student"}`}
              value={student?.cost_per_1k_alerts_usd != null ? usd(student.cost_per_1k_alerts_usd) : "—"}
              sub={cheaper(student) ? `${cheaper(student)!.toFixed(0)}× cheaper than teacher` : "—"}
            />
          </div>

          <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
            <Panel
              title="Quality on held-out alerts"
              description="Higher is better. Hatched bars are still training."
              actions={
                <SegmentedControl
                  aria-label="View"
                  selectedKeys={new Set([view])}
                  onSelectionChange={(k) => {
                    const v = [...k][0];
                    if (v) setView(v as "chart" | "table");
                  }}
                >
                  <SegmentedControlItem id="chart">Chart</SegmentedControlItem>
                  <SegmentedControlItem id="table">Table</SegmentedControlItem>
                </SegmentedControl>
              }
            >
              {view === "chart" ? (
                <div className="flex flex-col gap-5">
                  <Legend models={models} />
                  <div className="grid gap-x-8 gap-y-6 md:grid-cols-2">
                    {QUALITY.map((q) => (
                      <div key={q.key} className="flex flex-col gap-2.5">
                        <div className="flex flex-col">
                          <span className="text-body-2-semibold text-text-primary">{q.label}</span>
                          <span className="text-caption-1-regular text-text-tertiary">{q.hint}</span>
                        </div>
                        <BarList models={models} value={(m) => m[q.key]} format={(v) => pct(v)} max={1} />
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <QualityTable models={models} />
              )}
            </Panel>
            <Panel title="Teacher parity">
              <ParityRadial student={student} teacher={teacher} />
            </Panel>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Panel title="Speed & cost" description="Lower is better. Shown as two separate charts rather than one dual-axis chart.">
              <Tabs>
                <TabList aria-label="Speed or cost">
                  <Tab id="latency">p50 latency</Tab>
                  <Tab id="cost">Cost per 1k alerts</Tab>
                </TabList>
                <TabPanel id="latency">
                  <BarList models={models} value={(m) => m.p50_latency_ms} format={(v) => (v < 10 ? `${v.toFixed(2)} ms` : `${Math.round(v).toLocaleString()} ms`)} better="low" />
                </TabPanel>
                <TabPanel id="cost">
                  <BarList models={models} value={(m) => m.cost_per_1k_alerts_usd} format={usd} better="low" />
                </TabPanel>
              </Tabs>
            </Panel>
            <Panel
              title="LoRA training loss"
              description={
                evalData.training?.loss_curve?.length
                  ? `${evalData.training.steps} steps · ${evalData.training.epochs} epochs · rank ${evalData.training.lora_rank}`
                  : `rank ${evalData.training?.lora_rank ?? "—"}${evalData.training?.base_model ? ` · ${evalData.training.base_model}` : ""}`
              }
            >
              {evalData.training?.loss_curve?.length ? (
                <LossCurve curve={evalData.training.loss_curve} />
              ) : (
                <div className="relative flex h-[240px] flex-col items-center justify-center gap-3 overflow-hidden rounded-xl border border-dashed border-border-button-hover">
                  <svg viewBox="0 0 300 100" className="absolute inset-x-6 top-8 h-[60%] w-[calc(100%-48px)] opacity-25" preserveAspectRatio="none" aria-hidden>
                    <path d="M0 8 C 40 40, 80 70, 140 82 S 240 92, 300 94" fill="none" stroke="var(--color-text-tertiary)" strokeWidth="2" strokeDasharray="5 6" vectorEffect="non-scaling-stroke" />
                  </svg>
                  <AgentThinking variant="stars" label="Awaiting first training step" showTimer={false} className="relative" />
                </div>
              )}
            </Panel>
          </div>

          <div className="grid gap-4 lg:grid-cols-[minmax(0,440px)_minmax(0,1fr)]">
            <Panel
              title="Confusion matrix"
              description={confusionKey ? `${roleLabel(confusionKey)} decisions` : undefined}
              actions={
                confusionKeys.length > 1 ? (
                  <Select
                    aria-label="Model for confusion matrix"
                    size="sm"
                    selectedKey={confusionKey}
                    onSelectionChange={(k) => setConfusionPick(String(k))}
                    popoverClassName="min-w-48"
                  >
                    {confusionKeys.map((k) => (
                      <SelectItem key={k} id={k} textValue={roleLabel(k)}>
                        <Swatch role={k} />
                        {roleLabel(k)}
                      </SelectItem>
                    ))}
                  </Select>
                ) : undefined
              }
            >
              {confusion && confusionKey ? (
                <Confusion labels={confusion.labels} matrix={confusion.matrix} role={confusionKey} />
              ) : (
                <p className="text-body-2-regular text-text-tertiary">Not available.</p>
              )}
            </Panel>

            <Panel
              title="Side by side"
              description="The same held-out alert, scored by each model."
              actions={
                examples.length > 1 ? (
                  <Select
                    aria-label="Example alert"
                    size="sm"
                    selectedKey={String(Math.min(example, examples.length - 1))}
                    onSelectionChange={(k) => setExample(Number(k))}
                    triggerClassName="max-w-[220px]"
                    popoverClassName="min-w-[300px]"
                  >
                    {examples.map((e, i) => (
                      <SelectItem key={i} id={String(i)} textValue={e.title}>
                        <span className="min-w-0 flex-1 truncate">{e.title}</span>
                      </SelectItem>
                    ))}
                  </Select>
                ) : undefined
              }
            >
              {ex ? (
                <div className="flex flex-col gap-4">
                  <div className="flex flex-col gap-1.5">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="min-w-0 text-body-semibold text-text-primary">{ex.title}</p>
                      <span className="flex items-center gap-1.5 text-caption-1-medium text-text-tertiary">
                        {ex.nps_category ? `NPS: ${ex.nps_category} →` : "Expected"} <DecisionBadge decision={ex.expected_decision as Decision} size="sm" />
                      </span>
                    </div>
                    {ex.description && <p className="line-clamp-3 text-body-2-regular text-text-secondary">{ex.description}</p>}
                  </div>
                  <div className="grid gap-3 md:grid-cols-3">
                    <OutputBlock label="Base student" role="base" output={ex.base_output} expected={ex.expected_decision} />
                    <OutputBlock label="LoRA student" role="lora" output={ex.lora_output} expected={ex.expected_decision} />
                    {"teacher_output" in ex ? (
                      <OutputBlock label="Teacher" role="teacher" output={ex.teacher_output} expected={ex.expected_decision} />
                    ) : (
                      <OutputBlock label="Heuristic" role="heuristic" output={ex.heuristic_output} expected={ex.expected_decision} />
                    )}
                  </div>
                </div>
              ) : (
                <p className="text-body-2-regular text-text-tertiary">No examples recorded.</p>
              )}
            </Panel>
          </div>

          {evalData.notes?.length ? (
            <Panel title="Methodology">
              <ul className="grid gap-x-8 gap-y-2 md:grid-cols-2">
                {evalData.notes.map((n, i) => (
                  <li key={i} className="flex gap-2 text-body-2-regular text-text-secondary">
                    <span className="mt-[7px] size-1.5 shrink-0 rotate-45 bg-foreground-icon-tertiary" aria-hidden />
                    <span>{n}</span>
                  </li>
                ))}
              </ul>
            </Panel>
          ) : null}
        </div>
      )}
    </Page>
  );
}
