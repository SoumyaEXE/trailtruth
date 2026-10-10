"use client";

import { useSyncExternalStore } from "react";

/* ----- tiny localStorage-backed stores (all access wrapped in try/catch) ---- */

function read<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage blocked: state lives in memory for this session */
  }
}

function createStore<T>(key: string, fallback: T) {
  const listeners = new Set<() => void>();
  let cache: T | undefined;
  const get = () => {
    if (cache === undefined) cache = read(key, fallback);
    return cache;
  };
  const set = (next: T) => {
    cache = next;
    write(key, next);
    listeners.forEach((l) => l());
  };
  const subscribe = (l: () => void) => {
    listeners.add(l);
    const onStorage = (e: StorageEvent) => {
      if (e.key === key) {
        cache = undefined;
        l();
      }
    };
    window.addEventListener("storage", onStorage);
    return () => {
      listeners.delete(l);
      window.removeEventListener("storage", onStorage);
    };
  };
  const use = () => useSyncExternalStore(subscribe, get, () => fallback);
  return { get, set, subscribe, use };
}

/* ----- watchlist ----------------------------------------------------------- */

export const DEFAULT_WATCHLIST = ["havo", "chch", "yell"];
const watchlist = createStore<string[]>("trailtruth:watchlist", DEFAULT_WATCHLIST);

export function useWatchlist() {
  const list = watchlist.use();
  return {
    list,
    add: (code: string) => {
      const cur = watchlist.get();
      if (!cur.includes(code)) watchlist.set([...cur, code]);
    },
    remove: (code: string) => watchlist.set(watchlist.get().filter((c) => c !== code)),
    reset: () => watchlist.set(DEFAULT_WATCHLIST),
  };
}

/* ----- last generated workflow --------------------------------------------- */

const lastWorkflow = createStore<string | null>("trailtruth:last-workflow", null);
export const useLastWorkflow = lastWorkflow.use;
export const setLastWorkflow = lastWorkflow.set;

/* ----- "minutes you didn't spend in this app" ------------------------------
 * Estimate: every alert the card digests for you would take ~1.5 min to find
 * and read on nps.gov. Subtract the time you actually spent here.
 */
export const SECONDS_PER_ALERT_READ = 90;

interface Usage {
  secondsInApp: number;
  alertsDigested: number;
  cards: number;
}

const usage = createStore<Usage>("trailtruth:usage", { secondsInApp: 0, alertsDigested: 0, cards: 0 });
export const useUsage = usage.use;

export function recordCard(alertCount: number) {
  const u = usage.get();
  usage.set({ ...u, alertsDigested: u.alertsDigested + alertCount, cards: u.cards + 1 });
}

export function tickUsage(seconds: number) {
  const u = usage.get();
  usage.set({ ...u, secondsInApp: u.secondsInApp + seconds });
}

export function minutesSaved(u: Usage) {
  return Math.max(0, Math.round((u.alertsDigested * SECONDS_PER_ALERT_READ - u.secondsInApp) / 60));
}
