"use client";

import { RiArrowRightLine, RiDatabase2Line, RiFlaskLine, RiLockLine, RiMoneyDollarCircleLine, RiNodeTree, RiPrinterLine, RiRobot2Line, RiSignalWifiOffLine } from "@remixicon/react";
import { Page } from "@/components/trail/app-shell";
import { NavButton } from "@/components/trail/nav-button";
import { Topo } from "@/components/trail/topo";
import { getEval } from "@/lib/api";
import { usd } from "@/lib/format";
import { minutesSaved, SECONDS_PER_ALERT_READ, useUsage } from "@/lib/store";
import { useLoad } from "@/lib/use-load";

const PIPELINE = [
  { icon: RiDatabase2Line, title: "NPS alerts", body: "~600 live alerts from developer.nps.gov" },
  { icon: RiRobot2Line, title: "Teacher labels", body: "A large open model writes strict-JSON verdicts" },
  { icon: RiFlaskLine, title: "Distill on Tinker", body: "LoRA-tune a 1B open student on those labels" },
  { icon: RiNodeTree, title: "Temporal, weekly", body: "Fetch → classify → compose, with retries" },
  { icon: RiPrinterLine, title: "One card", body: "Print it, pocket it, close the app" },
];

export function AboutView() {
  const usage = useUsage();
  const saved = minutesSaved(usage);
  const evalRes = useLoad(getEval, "eval");
  const loraRaw = evalRes.data?.models.find((m) => m.role === "lora");
  const lora = loraRaw?.cost_per_1k_alerts_usd != null ? loraRaw : evalRes.data?.models.find((m) => m.role === "base");
  const teacher = evalRes.data?.models.find((m) => m.role === "teacher");

  const pillars = [
    {
      icon: RiSignalWifiOffLine,
      title: "Offline at the trailhead",
      body: "There's no signal at most trailheads. TrailTruth's answer is paper: one printed card, plus a lock-screen image that needs no network. A 1B model is small enough to run on a laptop the night before, with no cloud round-trip.",
    },
    {
      icon: RiLockLine,
      title: "Where you go is yours",
      body: "Your watchlist stays in your browser. With an open model running locally, your weekend plans never become training data for someone else's API. The only outbound request is to the public NPS feed.",
    },
    {
      icon: RiMoneyDollarCircleLine,
      title: "Cheap enough to run every week",
      body:
        lora?.cost_per_1k_alerts_usd != null && teacher?.cost_per_1k_alerts_usd != null
          ? `The small student classifies 1,000 alerts for about ${usd(lora.cost_per_1k_alerts_usd)}, versus ${usd(teacher.cost_per_1k_alerts_usd)} for the teacher. That cost is low enough for a volunteer, a ranger station or a school group to run every week, indefinitely.`
          : "A distilled 1B student costs a few cents per thousand alerts, versus dollars for a frontier model. That's low enough for anyone to run every week, indefinitely.",
    },
  ];

  return (
    <Page>
      <section className="relative mb-8 overflow-hidden rounded-3xl bg-overbar text-overbar-text">
        <Topo variant="hero" opacity={0.18} className="text-sandstone" />
        <div className="relative grid gap-8 p-6 sm:p-10 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)] lg:items-end">
          <div className="flex flex-col gap-4">
            <p className="tt-eyebrow opacity-75">Why open</p>
            <h1 className="font-sign text-[36px] leading-[42px] font-semibold tracking-[-0.02em] sm:text-[48px] sm:leading-[54px]">
              The best outdoor app is the one you close.
            </h1>
            <p className="max-w-[520px] text-[15px] leading-6 opacity-85">
              TrailTruth exists to cut screen time, so it measures success in minutes you <em>didn&apos;t</em> spend here. Open models, open data and open
              source are what make that possible.
            </p>
          </div>
          <div className="rounded-2xl bg-white/[0.07] p-5 ring-1 ring-white/15 backdrop-blur-sm">
            <p className="tt-eyebrow opacity-75">Minutes you didn&apos;t spend in this app</p>
            <p className="mt-2 flex items-baseline gap-2">
              <span className="tt-figure text-[64px] leading-[68px] tt-num">{saved}</span>
              <span className="text-[15px] opacity-80">min</span>
            </p>
            <p className="mt-2 text-[13px] leading-5 opacity-75 tt-num">
              {usage.alertsDigested} alerts digested × {SECONDS_PER_ALERT_READ / 60} min to find and read each on nps.gov, minus {Math.round(usage.secondsInApp / 60)} min actually
              spent here. Measured on this device only.
            </p>
          </div>
        </div>
      </section>

      <div className="mb-10 grid gap-3 md:grid-cols-3">
        {pillars.map((p) => (
          <article key={p.title} className="flex flex-col gap-3 rounded-2xl border border-border-button-default bg-background-primary-default p-5 shadow-card">
            <span className="flex size-9 items-center justify-center rounded-xl bg-accent-50 text-accent-700 dark:bg-accent-950 dark:text-accent-300">
              <p.icon className="size-5" aria-hidden />
            </span>
            <h2 className="text-title-3-semibold text-text-primary">{p.title}</h2>
            <p className="text-body-2-regular text-text-secondary">{p.body}</p>
          </article>
        ))}
      </div>

      <section className="mb-10">
        <h2 className="mb-1 text-title-3-semibold text-text-primary">How it works</h2>
        <p className="mb-5 max-w-[640px] text-body-2-regular text-text-secondary">
          A big open model teaches a small one. A durable workflow runs it once a week. You get a single artifact.
        </p>
        <ol className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {PIPELINE.map((s, i) => (
            <li key={s.title} className="relative flex flex-col gap-2 rounded-2xl border border-border-button-default bg-background-primary-default p-4">
              <span className="flex items-center justify-between">
                <span className="flex size-8 items-center justify-center rounded-lg bg-background-secondary-default text-foreground-icon-secondary">
                  <s.icon className="size-4" aria-hidden />
                </span>
                <span className="font-mono text-caption-1-medium text-text-tertiary">0{i + 1}</span>
              </span>
              <span className="text-body-semibold text-text-primary">{s.title}</span>
              <span className="text-body-2-regular text-text-secondary">{s.body}</span>
              {i < PIPELINE.length - 1 && (
                <RiArrowRightLine className="absolute top-1/2 -end-3 z-10 hidden size-4 -translate-y-1/2 rounded-full bg-background-full text-foreground-icon-tertiary lg:block" aria-hidden />
              )}
            </li>
          ))}
        </ol>
      </section>

      <section className="flex flex-col gap-4 rounded-2xl border border-border-button-default bg-background-secondary-default p-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-col gap-1">
          <p className="text-body-semibold text-text-primary">Built entirely in the open</p>
          <p className="max-w-[620px] text-body-2-regular text-text-secondary">
            Open-weight teacher and student models · LoRA training on Tinker · Temporal workflows · BoardUI (MIT) · public NPS Alerts API. Not affiliated with or
            endorsed by the National Park Service. Always confirm current conditions with the park.
          </p>
        </div>
        <NavButton href="/" trailingIcon={RiArrowRightLine} className="shrink-0">
          Make your card
        </NavButton>
      </section>
    </Page>
  );
}
