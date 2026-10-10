"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, type ComponentType, type ReactNode } from "react";
import {
  RiAlarmWarningLine,
  RiCloseLine,
  RiCompass3Line,
  RiFlaskLine,
  RiLeafLine,
  RiMenuLine,
  RiNodeTree,
  RiTicket2Line,
} from "@remixicon/react";
import { ThemeToggle } from "@/components/application/theme/theme-toggle";
import { IconButton } from "@/components/base/buttons/icon-button";
import { Kbd } from "@/components/base/kbd/kbd";
import { minutesSaved, tickUsage, useUsage } from "@/lib/store";
import { cx } from "@/utils/cx";
import { DataSourceChip } from "./data-source-chip";
import { Wordmark } from "./logo";

type Icon = ComponentType<{ className?: string; "aria-hidden"?: boolean | "true" | "false" }>;

export const NAV: { href: string; label: string; icon: Icon; hint: string }[] = [
  { href: "/", label: "Overview", icon: RiCompass3Line, hint: "1" },
  { href: "/card", label: "Trail card", icon: RiTicket2Line, hint: "2" },
  { href: "/alerts", label: "Alerts", icon: RiAlarmWarningLine, hint: "3" },
  { href: "/lab", label: "Model Lab", icon: RiFlaskLine, hint: "4" },
  { href: "/runs", label: "Workflow runs", icon: RiNodeTree, hint: "5" },
  { href: "/about", label: "Why open", icon: RiLeafLine, hint: "6" },
];

function isActive(pathname: string, href: string) {
  return href === "/" ? pathname === "/" : pathname.startsWith(href);
}

function NavList({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Primary" className="flex flex-col gap-0.5">
      {NAV.map((item) => {
        const active = isActive(pathname, item.href);
        const Icon = item.icon;
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onNavigate}
            aria-current={active ? "page" : undefined}
            className={cx(
              "group flex items-center justify-between rounded-2lg p-2 outline-none",
              "transition-colors duration-150 ease focus-visible:ring-2 focus-visible:ring-border-focus-ring",
              active
                ? "bg-linear-to-b from-accent-500 to-accent-600 shadow-nav-selected"
                : "hover:bg-background-secondary-hover",
            )}
          >
            <span className="flex min-w-0 items-center gap-2">
              <Icon className={cx("size-5 shrink-0", active ? "text-white" : "text-foreground-icon-secondary")} aria-hidden />
              <span className={cx("text-body-medium whitespace-nowrap", active ? "text-white" : "text-text-secondary group-hover:text-text-primary")}>
                {item.label}
              </span>
            </span>
            <Kbd className={cx("hidden lg:inline-flex min-w-5", active && "bg-white/20 text-white")}>{item.hint}</Kbd>
          </Link>
        );
      })}
    </nav>
  );
}

function SavedMinutes() {
  const usage = useUsage();
  const saved = minutesSaved(usage);
  return (
    <div className="rounded-2xl border border-border-button-default bg-background-primary-default p-3">
      <p className="tt-eyebrow text-text-tertiary">Minutes not spent here</p>
      <p className="mt-1 flex items-baseline gap-1.5">
        <span className="tt-figure text-[28px] leading-8 text-text-primary tt-num">{saved}</span>
        <span className="text-body-2-medium text-text-secondary">min</span>
      </p>
      <p className="mt-1 text-caption-1-regular text-text-tertiary">
        {usage.alertsDigested
          ? `${usage.alertsDigested} alerts digested into ${usage.cards} card${usage.cards === 1 ? "" : "s"}`
          : "Generate a card to start the count"}
      </p>
    </div>
  );
}

function SidebarBody({ onNavigate, mobile }: { onNavigate?: () => void; mobile?: boolean }) {
  return (
    <div className="flex h-full flex-col justify-between gap-6">
      <div className="flex flex-col gap-5">
        {!mobile && (
          <Link href="/" className="rounded-2lg p-1 outline-none focus-visible:ring-2 focus-visible:ring-border-focus-ring">
            <Wordmark />
          </Link>
        )}
        <NavList onNavigate={onNavigate} />
      </div>
      <div className="flex flex-col gap-3">
        <SavedMinutes />
        <div className="flex items-center justify-between gap-2 px-1">
          <DataSourceChip />
          <ThemeToggle appearance="sidebar-segmented" size="small" />
        </div>
      </div>
    </div>
  );
}

function useGlobalShortcuts() {
  const router = useRouter();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName) || t.closest("[role='listbox'],[role='dialog'],[role='grid']"))) return;
      const item = NAV.find((n) => n.hint === e.key);
      if (item) {
        e.preventDefault();
        router.push(item.href);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [router]);
}

function useUsageClock() {
  useEffect(() => {
    const id = window.setInterval(() => {
      if (document.visibilityState === "visible") tickUsage(10);
    }, 10_000);
    return () => window.clearInterval(id);
  }, []);
}

export function AppShell({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  useGlobalShortcuts();
  useUsageClock();

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open]);

  return (
    <div className="min-h-dvh bg-background-full">
      <a
        href="#main"
        className="tt-no-print sr-only z-50 rounded-lg bg-background-primary-default px-3 py-2 text-body-medium focus:not-sr-only focus:fixed focus:top-3 focus:left-3"
      >
        Skip to content
      </a>

      {/* Mobile top bar */}
      <header className="tt-no-print sticky top-0 z-30 flex h-14 items-center justify-between gap-3 border-b border-separator-border bg-background-full/85 px-4 backdrop-blur-md lg:hidden">
        <Link href="/" className="rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-border-focus-ring">
          <Wordmark />
        </Link>
        <div className="flex items-center gap-2">
          <DataSourceChip className="hidden min-[380px]:inline-flex" />
          <IconButton icon={RiMenuLine} size="small" aria-label="Open navigation" aria-expanded={open} onClick={() => setOpen(true)} />
        </div>
      </header>

      {/* Mobile drawer */}
      <div
        className={cx("tt-no-print fixed inset-0 z-40 lg:hidden", open ? "pointer-events-auto" : "pointer-events-none")}
        aria-hidden={!open}
      >
        <div
          className={cx("absolute inset-0 bg-black/40 transition-opacity duration-200", open ? "opacity-100" : "opacity-0")}
          onClick={() => setOpen(false)}
        />
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Navigation"
          className={cx(
            "absolute inset-y-2 start-2 flex w-[min(300px,calc(100vw-32px))] flex-col gap-4 rounded-3xl border border-border-button-white bg-background-secondary-default p-3 shadow-sidebar",
            "transition-transform duration-300 ease-out",
            open ? "translate-x-0" : "-translate-x-[110%]",
          )}
        >
          <div className="flex items-center justify-between p-1">
            <Wordmark />
            <IconButton icon={RiCloseLine} size="small" aria-label="Close navigation" onClick={() => setOpen(false)} tabIndex={open ? 0 : -1} />
          </div>
          <div className="min-h-0 flex-1">{open && <SidebarBody mobile onNavigate={() => setOpen(false)} />}</div>
        </div>
      </div>

      <div className="flex lg:gap-3 lg:p-3">
        {/* Desktop sidebar */}
        <aside className="tt-no-print sticky top-3 hidden h-[calc(100dvh-24px)] w-[248px] shrink-0 rounded-3xl border border-border-button-white bg-background-secondary-default p-3 shadow-sidebar lg:block">
          <SidebarBody />
        </aside>

        <main id="main" key={pathname} className="tt-print-root min-w-0 flex-1">
          {children}
        </main>
      </div>
    </div>
  );
}

/** Standard page frame: header + content with consistent gutters. */
export function Page({ children, className, wide }: { children: ReactNode; className?: string; wide?: boolean }) {
  return (
    <div className={cx("tt-print-root mx-auto w-full px-4 pt-6 pb-16 sm:px-6 lg:px-8 lg:pt-8", wide ? "max-w-[1360px]" : "max-w-[1200px]", className)}>
      {children}
    </div>
  );
}

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="tt-no-print mb-6 flex flex-col gap-4 sm:mb-8 md:flex-row md:items-end md:justify-between">
      <div className="flex min-w-0 flex-col gap-1.5">
        {eyebrow && <p className="tt-eyebrow text-text-tertiary">{eyebrow}</p>}
        <h1 className="text-title-2-semibold text-text-primary sm:text-title-1-semibold">{title}</h1>
        {description && <p className="max-w-[640px] text-body-regular text-text-secondary">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

export function Panel({
  children,
  className,
  title,
  description,
  actions,
  padded = true,
}: {
  children: ReactNode;
  className?: string;
  title?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  padded?: boolean;
}) {
  return (
    <section className={cx("min-w-0 rounded-2xl border border-border-button-default bg-background-primary-default shadow-card", className)}>
      {(title || actions) && (
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-separator-border px-4 py-3">
          <div className="flex min-w-0 flex-col gap-0.5">
            {title && <h2 className="text-headline-semibold text-text-primary">{title}</h2>}
            {description && <p className="text-body-2-regular text-text-secondary">{description}</p>}
          </div>
          {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </div>
      )}
      <div className={cx(padded && "p-4")}>{children}</div>
    </section>
  );
}
