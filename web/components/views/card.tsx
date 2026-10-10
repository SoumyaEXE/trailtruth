"use client";

import { useMemo, useRef, useState } from "react";
import { RiDownload2Line, RiExternalLinkLine, RiPrinterLine, RiSmartphoneLine, RiSparkling2Line } from "@remixicon/react";
import { Button } from "@/components/base/buttons/button";
import { SegmentedControl, SegmentedControlItem } from "@/components/base/segmented-control/segmented-control";
import { Page, PageHeader, Panel } from "@/components/trail/app-shell";
import { DecisionGlyph } from "@/components/trail/decision";
import { NavButton } from "@/components/trail/nav-button";
import { conditionsUrl, TrailCardView, type CardLayout } from "@/components/trail/trail-card";
import { getAlerts, getCardStatus, getLatestCard, getParks } from "@/lib/api";
import { formatDate, shortParkName } from "@/lib/format";
import { useLastWorkflow } from "@/lib/store";
import { useLoad } from "@/lib/use-load";

export function CardView() {
  const lastWorkflow = useLastWorkflow();
  const status = useLoad(() => (lastWorkflow ? getCardStatus(lastWorkflow).catch(() => getLatestCard()) : getLatestCard()), lastWorkflow ?? "latest");
  const parks = useLoad(getParks, "parks");
  const alerts = useLoad(() => getAlerts(), "alerts");
  const [layout, setLayout] = useState<CardLayout>("sheet");
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const sheetRef = useRef<HTMLDivElement>(null);
  const phoneRef = useRef<HTMLDivElement>(null);

  const card = status.data?.card ?? null;
  const parkStates = useMemo(() => Object.fromEntries((parks.data ?? []).map((p) => [p.park_code, p.states])), [parks.data]);
  const alertById = useMemo(() => new Map((alerts.data ?? []).map((a) => [a.id, a])), [alerts.data]);

  async function exportPng() {
    const node = layout === "phone" ? phoneRef.current : sheetRef.current;
    if (!node || !card) return;
    setExporting(true);
    setExportError(null);
    try {
      const { toPng } = await import("html-to-image");
      const url = await toPng(node, {
        pixelRatio: layout === "phone" ? 3 : 2,
        cacheBust: true,
        style: { borderRadius: layout === "phone" ? "0" : "20px", boxShadow: "none" },
      });
      const a = document.createElement("a");
      a.href = url;
      a.download = `${card.id}${layout === "phone" ? "_lockscreen" : ""}.png`;
      a.click();
    } catch (e) {
      setExportError(`Couldn't render the image (${String(e)}). Try Print → Save as PDF instead.`);
    } finally {
      setExporting(false);
    }
  }

  return (
    <Page>
      <PageHeader
        eyebrow={card ? `Week of ${formatDate(card.week_of, { month: "long", day: "numeric", year: "numeric" })}` : "Trail card"}
        title="Your trail card"
        description="Print it, or save it to your lock screen, then close this tab. That's the whole product."
        actions={
          <>
            <SegmentedControl
              aria-label="Card layout"
              selectedKeys={new Set([layout])}
              onSelectionChange={(keys) => {
                const next = [...keys][0];
                if (next) setLayout(next as CardLayout);
              }}
            >
              <SegmentedControlItem id="sheet">Sheet</SegmentedControlItem>
              <SegmentedControlItem id="phone">Lock screen</SegmentedControlItem>
            </SegmentedControl>
            <Button variant="secondary" leadingIcon={RiPrinterLine} onClick={() => window.print()} disabled={!card}>
              Print
            </Button>
            <Button
              leadingIcon={layout === "phone" ? RiSmartphoneLine : RiDownload2Line}
              onClick={exportPng}
              disabled={!card || exporting}
            >
              {exporting ? "Rendering…" : layout === "phone" ? "Save to lock screen" : "Download PNG"}
            </Button>
          </>
        }
      />

      {exportError && (
        <p role="alert" className="tt-no-print mb-4 rounded-xl border border-nogo-border bg-nogo-surface px-3 py-2 text-body-2-medium text-nogo-text">
          {exportError}
        </p>
      )}

      {status.loading ? (
        <div className="mx-auto h-[640px] w-full max-w-[820px] animate-pulse rounded-[20px] bg-background-secondary-default" />
      ) : card ? (
        <>
          <div className="flex justify-center">
            <div className={layout === "phone" ? "hidden print:block print:w-full" : "w-full max-w-[820px]"}>
              <TrailCardView card={card} layout="sheet" parkStates={parkStates} ref={sheetRef} className="mx-auto" />
            </div>
            {layout === "phone" && (
              <div className="tt-no-print flex w-full justify-center py-2">
                <div className="origin-top scale-[0.92] min-[400px]:scale-100">
                  <TrailCardView card={card} layout="phone" ref={phoneRef} />
                </div>
              </div>
            )}
          </div>

          <div className="tt-no-print mx-auto mt-8 max-w-[820px]">
            <Panel title="Sources" description="Every line on the card traces back to an NPS alert. Tap through to verify before you go." padded={false}>
              <ul className="divide-y divide-separator-border">
                {card.parks.map((p) => (
                  <li key={p.park_code} className="flex flex-col gap-2 px-4 py-3">
                    <div className="flex items-center justify-between gap-3">
                      <span className="flex min-w-0 items-center gap-2 text-body-semibold text-text-primary">
                        <DecisionGlyph decision={p.decision} />
                        <span className="truncate">{shortParkName(p.park_name)}</span>
                      </span>
                      <a
                        href={conditionsUrl(p.park_code)}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex shrink-0 items-center gap-1 rounded-md text-caption-1-semibold text-accent-600 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-border-focus-ring dark:text-accent-300"
                      >
                        nps.gov conditions <RiExternalLinkLine className="size-3.5" aria-hidden />
                      </a>
                    </div>
                    <ul className="flex flex-col gap-1 ps-6">
                      {p.alert_ids.slice(0, 6).map((id) => {
                        const a = alertById.get(id);
                        return (
                          <li key={id} className="flex min-w-0 items-baseline gap-2 text-body-2-regular text-text-secondary">
                            {a ? <DecisionGlyph decision={a.verdict.decision} className="size-3 translate-y-0.5" /> : null}
                            <span className="min-w-0 truncate">{a ? a.title : <span className="font-mono text-caption-1-regular">{id}</span>}</span>
                          </li>
                        );
                      })}
                      {p.alert_ids.length > 6 && <li className="text-caption-1-regular text-text-tertiary">+{p.alert_ids.length - 6} more alerts</li>}
                      {p.alert_ids.length === 0 && <li className="text-caption-1-regular text-text-tertiary">No active alerts</li>}
                    </ul>
                  </li>
                ))}
              </ul>
            </Panel>
          </div>
        </>
      ) : (
        <div className="flex flex-col items-center gap-4 rounded-3xl border border-dashed border-border-button-hover px-6 py-20 text-center">
          <p className="font-sign text-[24px] leading-8 font-semibold text-text-primary">No card yet</p>
          <p className="max-w-[400px] text-body-2-regular text-text-secondary">Generate one from the Overview. It takes about ten seconds.</p>
          <NavButton href="/" leadingIcon={RiSparkling2Line}>
            Go to Overview
          </NavButton>
        </div>
      )}
    </Page>
  );
}
