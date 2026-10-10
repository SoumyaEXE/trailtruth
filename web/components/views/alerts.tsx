"use client";

import { Fragment, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  RiArrowDownSLine,
  RiCheckboxCircleLine,
  RiErrorWarningLine,
  RiExternalLinkLine,
  RiFilterOffLine,
  RiLockLine,
  RiSearchLine,
} from "@remixicon/react";
import {
  flexRender,
  getCoreRowModel,
  getExpandedRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type ExpandedState,
  type SortingState,
} from "@tanstack/react-table";
import { Button } from "@/components/base/buttons/button";
import { InputBase } from "@/components/base/input/input";
import { Pagination } from "@/components/base/pagination/pagination";
import { SegmentedControl, SegmentedControlItem } from "@/components/base/segmented-control/segmented-control";
import { Select, SelectItem } from "@/components/base/select/select";
import { ChevronSortDown } from "@/components/foundations/icons/chevrons";
import { Page, PageHeader } from "@/components/trail/app-shell";
import { DecisionBadge, DecisionGlyph } from "@/components/trail/decision";
import { getAlerts } from "@/lib/api";
import { DECISION_RANK } from "@/lib/compose";
import { DECISION_LABEL, formatDate, hazardLabel, shortParkName } from "@/lib/format";
import {
  CATEGORY_TO_DECISION,
  DECISIONS,
  HAZARD_TYPES,
  NPS_CATEGORIES,
  type NpsCategory,
  type ProcessedAlert,
} from "@/lib/types";
import { useLoad } from "@/lib/use-load";
import { cx } from "@/utils/cx";

function expected(a: ProcessedAlert) {
  return CATEGORY_TO_DECISION[a.nps_category as NpsCategory];
}
function agrees(a: ProcessedAlert) {
  const e = expected(a);
  return e ? e === a.verdict.decision : true;
}

function SeverityPips({ value }: { value: number }) {
  return (
    <span className="inline-flex items-center gap-0.5" role="img" aria-label={`Severity ${value} of 3`}>
      {[1, 2, 3].map((i) => (
        <span
          key={i}
          className={cx(
            "h-3 w-1.5 rounded-[2px]",
            i <= value
              ? value === 3
                ? "bg-nogo-solid"
                : value === 2
                  ? "bg-caution-solid"
                  : "bg-go-solid"
              : "bg-background-tertiary-default",
          )}
        />
      ))}
    </span>
  );
}

function JsonView({ value }: { value: unknown }) {
  const json = JSON.stringify(value, null, 2);
  const html = json
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/("(?:\\.|[^"\\])*")(\s*:)?|\b(true|false|null)\b|(-?\d+(?:\.\d+)?)/g, (m, str, colon, lit, num) => {
      if (str) return colon ? `<span class="text-sky">${str}</span>${colon}` : `<span class="text-pine">${str}</span>`;
      if (lit) return `<span class="text-clay">${lit}</span>`;
      if (num) return `<span class="text-sandstone">${num}</span>`;
      return m;
    });
  return (
    <pre
      className="overflow-x-auto rounded-xl bg-background-secondary-default p-3 font-mono text-caption-1-regular leading-5 whitespace-pre-wrap break-words text-text-primary"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

function ExpandedRow({ a }: { a: ProcessedAlert }) {
  const exp = expected(a);
  const ok = agrees(a);
  return (
    <div className="grid gap-4 p-4 lg:grid-cols-2">
      <section className="flex min-w-0 flex-col gap-2.5 rounded-2xl border border-border-button-default bg-background-primary-default p-4">
        <div className="flex items-center justify-between gap-2">
          <p className="tt-eyebrow text-text-tertiary">Original NPS alert</p>
          <span className="rounded-md bg-background-secondary-default px-1.5 py-0.5 text-caption-1-semibold text-text-secondary">{a.nps_category}</span>
        </div>
        <h3 className="text-headline-semibold text-text-primary">{a.title}</h3>
        <p className="text-body-2-regular whitespace-pre-line text-text-secondary">{a.description}</p>
        <div className="mt-auto flex flex-wrap items-center gap-x-3 gap-y-1 pt-1 text-caption-1-regular text-text-tertiary">
          <span>{a.park_name || "Unknown park"}</span>
          <span>Indexed {formatDate(a.last_indexed)}</span>
          {a.url && (
            <a href={a.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-accent-600 hover:underline dark:text-accent-300">
              Source <RiExternalLinkLine className="size-3" aria-hidden />
            </a>
          )}
        </div>
      </section>
      <section className="flex min-w-0 flex-col gap-2.5 rounded-2xl border border-border-button-default bg-background-primary-default p-4">
        <div className="flex items-center justify-between gap-2">
          <p className="tt-eyebrow text-text-tertiary">Model verdict (JSON)</p>
          <DecisionBadge decision={a.verdict.decision} size="sm" />
        </div>
        <JsonView value={a.verdict} />
        <dl className="grid grid-cols-2 gap-2 sm:grid-cols-[1.6fr_1fr_1fr]">
          <div className="rounded-xl bg-background-secondary-default px-3 py-2">
            <dt className="text-caption-1-medium text-text-tertiary">Model</dt>
            <dd className="truncate font-mono text-caption-1-medium text-text-primary" title={a.model}>{a.model}</dd>
          </div>
          <div className="rounded-xl bg-background-secondary-default px-3 py-2">
            <dt className="text-caption-1-medium text-text-tertiary">Latency</dt>
            <dd className="font-mono text-caption-1-medium text-text-primary tt-num">{a.latency_ms.toLocaleString()} ms</dd>
          </div>
          <div className={cx("col-span-2 rounded-xl px-3 py-2 sm:col-span-1", ok ? "bg-go-surface" : "bg-caution-surface")}>
            <dt className="text-caption-1-medium text-text-tertiary">vs. NPS label</dt>
            <dd className={cx("flex items-center gap-1 text-caption-1-semibold", ok ? "text-go-text" : "text-caution-text")}>
              {ok ? <RiCheckboxCircleLine className="size-3.5" aria-hidden /> : <RiErrorWarningLine className="size-3.5" aria-hidden />}
              {exp ? (ok ? "Agrees" : `Expected ${DECISION_LABEL[exp]}`) : "No label"}
            </dd>
          </div>
        </dl>
      </section>
    </div>
  );
}

const ALL = "all";
const PAGE_SIZE = 20;

export function AlertsView() {
  const params = useSearchParams();
  const router = useRouter();
  const { data, loading } = useLoad(() => getAlerts(), "alerts");
  const [park, setPark] = useState(params.get("park") ?? ALL);
  const [decision, setDecision] = useState(ALL);
  const [hazard, setHazard] = useState(ALL);
  const [category, setCategory] = useState(ALL);
  const [scope, setScope] = useState<"all" | "disagree" | "closed">("all");
  const [query, setQuery] = useState("");
  const [sorting, setSorting] = useState<SortingState>([{ id: "decision", desc: true }]);
  const [expanded, setExpanded] = useState<ExpandedState>({});
  const [pageIndex, setPageIndex] = useState(0);

  const alerts = useMemo(() => data ?? [], [data]);
  const parks = useMemo(() => {
    const m = new Map<string, string>();
    alerts.forEach((a) => a.park_code && m.set(a.park_code, a.park_name || a.park_code));
    return [...m.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [alerts]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return alerts.filter(
      (a) =>
        (park === ALL || a.park_code === park) &&
        (decision === ALL || a.verdict.decision === decision) &&
        (hazard === ALL || a.verdict.hazard_type === hazard) &&
        (category === ALL || a.nps_category === category) &&
        (scope === "all" || (scope === "disagree" ? !agrees(a) : a.verdict.is_closed)) &&
        (!q || a.title.toLowerCase().includes(q) || a.park_name.toLowerCase().includes(q) || a.description.toLowerCase().includes(q)),
    );
  }, [alerts, park, decision, hazard, category, scope, query]);

  const stats = useMemo(() => {
    const labeled = alerts.filter((a) => expected(a));
    const agree = labeled.filter(agrees).length;
    const lat = [...alerts.map((a) => a.latency_ms)].sort((a, b) => a - b);
    return {
      total: alerts.length,
      agreement: labeled.length ? agree / labeled.length : 0,
      p50: lat.length ? lat[Math.floor(lat.length / 2)] : 0,
      closed: alerts.filter((a) => a.verdict.is_closed).length,
      models: [...new Set(alerts.map((a) => a.model))],
    };
  }, [alerts]);

  const columns = useMemo<ColumnDef<ProcessedAlert>[]>(
    () => [
      {
        id: "expand",
        header: () => <span className="sr-only">Expand</span>,
        enableSorting: false,
        cell: ({ row }) => (
          <button
            type="button"
            onClick={row.getToggleExpandedHandler()}
            aria-expanded={row.getIsExpanded()}
            aria-label={row.getIsExpanded() ? "Collapse alert" : "Expand alert"}
            className="flex size-7 cursor-pointer items-center justify-center rounded-lg text-foreground-icon-secondary outline-none hover:bg-background-secondary-hover focus-visible:ring-2 focus-visible:ring-border-focus-ring"
          >
            <RiArrowDownSLine className={cx("size-4 transition-transform duration-200", row.getIsExpanded() ? "rotate-0" : "-rotate-90")} aria-hidden />
          </button>
        ),
      },
      {
        id: "decision",
        header: "Decision",
        accessorFn: (a) => DECISION_RANK[a.verdict.decision] * 10 + a.verdict.severity,
        cell: ({ row }) => <DecisionBadge decision={row.original.verdict.decision} size="sm" />,
      },
      {
        id: "title",
        header: "Alert",
        accessorFn: (a) => a.title,
        cell: ({ row }) => (
          <div className="flex max-w-[420px] min-w-[240px] flex-col">
            <span className="line-clamp-1 text-body-2-medium text-text-primary" title={row.original.title}>
              {row.original.title}
            </span>
            <span className="line-clamp-1 text-caption-1-regular text-text-tertiary">{row.original.verdict.reason}</span>
          </div>
        ),
      },
      {
        id: "park",
        header: "Park",
        accessorFn: (a) => a.park_name,
        cell: ({ row }) => (
          <div className="flex max-w-[180px] flex-col">
            <span className="truncate text-body-2-medium text-text-primary">{row.original.park_name ? shortParkName(row.original.park_name) : "—"}</span>
            <span className="font-mono text-caption-1-regular text-text-tertiary uppercase">{row.original.park_code || "n/a"}</span>
          </div>
        ),
      },
      {
        id: "hazard",
        header: "Hazard",
        accessorFn: (a) => a.verdict.hazard_type,
        cell: ({ row }) => (
          <span className="inline-flex items-center gap-1.5 text-body-2-medium whitespace-nowrap text-text-secondary">
            {row.original.verdict.is_closed && <RiLockLine className="size-3.5 text-nogo-solid" aria-label="Closure" />}
            {hazardLabel(row.original.verdict.hazard_type)}
          </span>
        ),
      },
      {
        id: "category",
        header: "NPS category",
        accessorFn: (a) => a.nps_category,
        cell: ({ row }) => {
          const ok = agrees(row.original);
          return (
            <span className="inline-flex items-center gap-1.5 text-body-2-medium whitespace-nowrap text-text-secondary">
              {row.original.nps_category}
              {!ok && (
                <span title="Model disagrees with NPS label" className="inline-flex">
                  <RiErrorWarningLine className="size-3.5 text-caution-solid" aria-label="Disagrees with NPS label" />
                </span>
              )}
            </span>
          );
        },
      },
      {
        id: "severity",
        header: "Sev.",
        accessorFn: (a) => a.verdict.severity,
        cell: ({ row }) => <SeverityPips value={row.original.verdict.severity} />,
      },
      {
        id: "latency",
        header: "Latency",
        accessorFn: (a) => a.latency_ms,
        cell: ({ row }) => <span className="font-mono text-caption-1-medium text-text-secondary tt-num">{row.original.latency_ms.toLocaleString()} ms</span>,
      },
      {
        id: "indexed",
        header: "Indexed",
        accessorFn: (a) => a.last_indexed,
        cell: ({ row }) => <span className="text-body-2-regular whitespace-nowrap text-text-secondary tt-num">{formatDate(row.original.last_indexed)}</span>,
      },
    ],
    [],
  );

  // eslint-disable-next-line react-hooks/incompatible-library
  const table = useReactTable({
    data: filtered,
    columns,
    getRowId: (r, i) => `${r.id}-${i}`,
    state: { sorting, expanded, pagination: { pageIndex, pageSize: PAGE_SIZE } },
    onSortingChange: setSorting,
    onExpandedChange: setExpanded,
    onPaginationChange: (u) => {
      const next = typeof u === "function" ? u({ pageIndex, pageSize: PAGE_SIZE }) : u;
      setPageIndex(next.pageIndex);
    },
    getRowCanExpand: () => true,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getExpandedRowModel: getExpandedRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    autoResetPageIndex: false,
  });

  const resetPage = () => {
    setPageIndex(0);
    setExpanded({});
  };
  const anyFilter = park !== ALL || decision !== ALL || hazard !== ALL || category !== ALL || scope !== "all" || query;
  const resetAll = () => {
    setPark(ALL);
    setDecision(ALL);
    setHazard(ALL);
    setCategory(ALL);
    setScope("all");
    setQuery("");
    resetPage();
    router.replace("/alerts");
  };

  const totalPages = table.getPageCount();
  const rows = table.getRowModel().rows;

  return (
    <Page wide>
      <PageHeader
        eyebrow="Audit trail"
        title="Alerts"
        description="Every NPS alert next to the model's strict-JSON verdict. Expand a row to compare the original text with the output. The warning icon marks a disagreement with the NPS category."
      />

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          { label: "Alerts classified", value: loading ? "…" : stats.total.toLocaleString() },
          { label: "Agreement with NPS label", value: loading ? "…" : `${Math.round(stats.agreement * 100)}%` },
          { label: "Closures detected", value: loading ? "…" : stats.closed.toLocaleString() },
          { label: "p50 latency", value: loading ? "…" : `${stats.p50.toLocaleString()} ms`, sub: stats.models.join(", ") },
        ].map((s) => (
          <div key={s.label} className="flex min-w-0 flex-col gap-1 rounded-2xl border border-border-button-default bg-background-primary-default px-4 py-3">
            <span className="text-caption-1-medium text-text-tertiary">{s.label}</span>
            <span className="tt-figure text-[26px] leading-8 text-text-primary tt-num">{s.value}</span>
            {s.sub && <span className="truncate font-mono text-caption-2-regular text-text-tertiary" title={s.sub}>{s.sub}</span>}
          </div>
        ))}
      </div>

      <section className="flex w-full min-w-0 flex-col rounded-2xl border border-border-table bg-background-primary-default pt-3">
        {/* Toolbar */}
        <div className="flex flex-col gap-3 px-3 pb-3">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div className="flex items-center gap-3">
              <SegmentedControl
                aria-label="Scope"
                selectedKeys={new Set([scope])}
                onSelectionChange={(k) => {
                  const v = [...k][0];
                  if (v) {
                    setScope(v as typeof scope);
                    resetPage();
                  }
                }}
              >
                <SegmentedControlItem id="all">All</SegmentedControlItem>
                <SegmentedControlItem id="closed">Closures</SegmentedControlItem>
                <SegmentedControlItem id="disagree">Disagreements</SegmentedControlItem>
              </SegmentedControl>
            </div>
            <InputBase
              aria-label="Search alerts"
              placeholder="Search title, park, text…"
              leadingIcon={RiSearchLine}
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                resetPage();
              }}
              fieldClassName="w-full rounded-full bg-background-secondary-default md:w-[280px]"
              className="text-body-medium"
            />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Select
              aria-label="Filter by park"
              selectedKey={park}
              onSelectionChange={(k) => {
                setPark(String(k));
                resetPage();
              }}
              size="sm"
              className="max-w-full"
              triggerClassName="max-w-[240px]"
              popoverClassName="min-w-[280px]"
            >
              <SelectItem id={ALL} textValue="All parks">All parks</SelectItem>
              {parks.map(([code, name]) => (
                <SelectItem key={code} id={code} textValue={name}>
                  <span className="min-w-0 flex-1 truncate">{shortParkName(name)}</span>
                  <span className="font-mono text-caption-1-regular text-text-tertiary uppercase">{code}</span>
                </SelectItem>
              ))}
            </Select>
            <Select
              aria-label="Filter by decision"
              selectedKey={decision}
              onSelectionChange={(k) => {
                setDecision(String(k));
                resetPage();
              }}
              size="sm"
              popoverClassName="min-w-44"
            >
              <SelectItem id={ALL} textValue="All decisions">All decisions</SelectItem>
              {DECISIONS.map((d) => (
                <SelectItem key={d} id={d} textValue={DECISION_LABEL[d]}>
                  <DecisionGlyph decision={d} className="size-3.5" />
                  {DECISION_LABEL[d]}
                </SelectItem>
              ))}
            </Select>
            <Select
              aria-label="Filter by hazard type"
              selectedKey={hazard}
              onSelectionChange={(k) => {
                setHazard(String(k));
                resetPage();
              }}
              size="sm"
              popoverClassName="min-w-44"
            >
              <SelectItem id={ALL} textValue="All hazards">All hazards</SelectItem>
              {HAZARD_TYPES.map((h) => (
                <SelectItem key={h} id={h} textValue={hazardLabel(h)}>
                  {hazardLabel(h)}
                </SelectItem>
              ))}
            </Select>
            <Select
              aria-label="Filter by NPS category"
              selectedKey={category}
              onSelectionChange={(k) => {
                setCategory(String(k));
                resetPage();
              }}
              size="sm"
              popoverClassName="min-w-44"
            >
              <SelectItem id={ALL} textValue="All NPS categories">All NPS categories</SelectItem>
              {NPS_CATEGORIES.map((c) => (
                <SelectItem key={c} id={c} textValue={c}>
                  {c}
                </SelectItem>
              ))}
            </Select>
            <span className="ms-auto text-body-2-medium text-text-tertiary tt-num">
              {filtered.length.toLocaleString()} of {alerts.length.toLocaleString()}
            </span>
            {anyFilter && (
              <Button variant="secondary" size="xs" leadingIcon={RiFilterOffLine} onClick={resetAll}>
                Reset
              </Button>
            )}
          </div>
        </div>

        {/* Table */}
        <div className="w-full overflow-x-auto">
          <table className="bui-table bui-table-sm min-w-[1040px]" aria-label="NPS alerts and model verdicts">
            <thead>
              {table.getHeaderGroups().map((hg) => (
                <tr key={hg.id}>
                  {hg.headers.map((h) => {
                    const canSort = h.column.getCanSort();
                    const dir = h.column.getIsSorted();
                    return (
                      <th
                        key={h.id}
                        className={cx(h.column.id === "expand" && "w-10")}
                        aria-sort={dir === "asc" ? "ascending" : dir === "desc" ? "descending" : undefined}
                      >
                        {canSort ? (
                          <button
                            type="button"
                            onClick={h.column.getToggleSortingHandler()}
                            className="-mx-1 flex cursor-pointer items-center gap-0.5 rounded-md px-1 outline-none focus-visible:ring-2 focus-visible:ring-border-focus-ring"
                          >
                            {flexRender(h.column.columnDef.header, h.getContext())}
                            <ChevronSortDown
                              className={cx(
                                "size-5 shrink-0 transition-[transform,color] duration-150",
                                dir === "asc" && "rotate-180",
                                dir ? "text-text-secondary" : "text-text-tertiary opacity-60",
                              )}
                            />
                          </button>
                        ) : (
                          flexRender(h.column.columnDef.header, h.getContext())
                        )}
                      </th>
                    );
                  })}
                </tr>
              ))}
            </thead>
            <tbody>
              {loading &&
                Array.from({ length: 8 }, (_, i) => (
                  <tr key={`sk-${i}`}>
                    <td colSpan={columns.length}>
                      <div className="h-7 animate-pulse rounded-lg bg-background-secondary-default" />
                    </td>
                  </tr>
                ))}
              {!loading && rows.length === 0 && (
                <tr>
                  <td colSpan={columns.length}>
                    <div className="flex h-40 flex-col items-center justify-center gap-2 text-center">
                      <p className="text-body-medium text-text-secondary">No alerts match these filters.</p>
                      <Button variant="secondary" size="small" onClick={resetAll}>
                        Reset filters
                      </Button>
                    </div>
                  </td>
                </tr>
              )}
              {rows.map((row) => (
                <Fragment key={row.id}>
                  <tr
                    className={cx("cursor-pointer hover:bg-background-secondary-default/60", row.getIsExpanded() && "bg-background-secondary-default/60")}
                    onClick={(e) => {
                      if ((e.target as HTMLElement).closest("button,a")) return;
                      row.toggleExpanded();
                    }}
                  >
                    {row.getVisibleCells().map((cell) => (
                      <td key={cell.id}>{flexRender(cell.column.columnDef.cell, cell.getContext())}</td>
                    ))}
                  </tr>
                  {row.getIsExpanded() && (
                    <tr className="bg-background-secondary-default/60">
                      <td colSpan={columns.length} className="p-0!">
                        <ExpandedRow a={row.original} />
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>

        {totalPages > 1 && (
          <div className="border-t border-separator-border px-3 py-3">
            <Pagination page={pageIndex + 1} totalPages={totalPages} onChange={(p) => {
              setPageIndex(p - 1);
              setExpanded({});
            }} />
          </div>
        )}
      </section>
    </Page>
  );
}
