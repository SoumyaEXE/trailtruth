/**
 * Data layer.
 *
 * Every read tries, in order:
 *   1. the live FastAPI backend   (NEXT_PUBLIC_API_URL, default http://localhost:8000)
 *   2. static fixtures            (/fixtures/*.json, written by the backend agent)
 *   3. bundled mock data          (lib/mock.ts)
 * and reports which one answered, so the UI can show a "demo data" chip.
 *
 * Card generation falls back to an in-browser simulation of the Temporal
 * workflow (same step names, including a retried NPS 503) when the API is down.
 */
import { composeCard } from "./compose";
import {
  MOCK_ALERTS,
  MOCK_CARD_STATUS,
  MOCK_EVAL,
  MOCK_PARKS,
  MOCK_RUNS,
} from "./mock";
import type {
  CardStatus,
  DataSource,
  EvalResults,
  Park,
  ProcessedAlert,
  WorkflowRun,
  WorkflowStep,
} from "./types";

export const API_URL = (process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000").replace(/\/$/, "");

const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
const TIMEOUT_MS = 2500;
const API_RETRY_AFTER_MS = 20_000;

export interface Sourced<T> {
  data: T;
  source: DataSource;
}

/* ----- source tracking (drives the "demo data" chip) ---------------------- */

type Listener = () => void;
const listeners = new Set<Listener>();
let lastSource: DataSource | null = null;

function report(source: DataSource) {
  if (lastSource === source) return;
  lastSource = source;
  listeners.forEach((l) => l());
}

export const dataSourceStore = {
  subscribe(l: Listener) {
    listeners.add(l);
    return () => listeners.delete(l);
  },
  get(): DataSource | null {
    return lastSource;
  },
};

/* ----- low-level fetchers -------------------------------------------------- */

let apiDownUntil = 0;

async function fetchWithTimeout(url: string, init?: RequestInit): Promise<Response> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal, cache: "no-store" });
  } finally {
    clearTimeout(t);
  }
}

async function fromApi<T>(path: string, init?: RequestInit): Promise<T> {
  if (Date.now() < apiDownUntil) throw new Error("api marked down");
  try {
    const res = await fetchWithTimeout(`${API_URL}${path}`, init);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return (await res.json()) as T;
  } catch (err) {
    // Only network-level failures mark the API down; HTTP errors propagate.
    if (!(err instanceof Error && err.message.startsWith("HTTP"))) {
      apiDownUntil = Date.now() + API_RETRY_AFTER_MS;
    }
    throw err;
  }
}

const fixtureCache = new Map<string, Promise<unknown>>();

function fromFixture<T>(name: string): Promise<T> {
  let p = fixtureCache.get(name) as Promise<T> | undefined;
  if (!p) {
    p = fetch(`${BASE_PATH}/fixtures/${name}`).then((r) => {
      if (!r.ok) throw new Error(`fixture ${name}: HTTP ${r.status}`);
      return r.json() as Promise<T>;
    });
    p.catch(() => fixtureCache.delete(name));
    fixtureCache.set(name, p);
  }
  return p;
}

async function load<T>(
  apiPath: string | null,
  fixture: string,
  mock: T,
  fromFixtureData: (raw: unknown) => T = (raw) => raw as T,
): Promise<Sourced<T>> {
  if (apiPath) {
    try {
      const data = await fromApi<T>(apiPath);
      report("live");
      return { data, source: "live" };
    } catch {
      /* fall through */
    }
  }
  try {
    const raw = await fromFixture<unknown>(fixture);
    const data = fromFixtureData(raw);
    report("fixture");
    return { data, source: "fixture" };
  } catch {
    /* fall through */
  }
  report("mock");
  return { data: mock, source: "mock" };
}

/* ----- public reads -------------------------------------------------------- */

export function getHealth(): Promise<boolean> {
  return fromApi<unknown>("/api/health").then(
    () => true,
    () => false,
  );
}

export function getParks(): Promise<Sourced<Park[]>> {
  return load<Park[]>("/api/parks", "parks.json", MOCK_PARKS);
}

let allAlerts: Promise<Sourced<ProcessedAlert[]>> | null = null;

export function getAlerts(park?: string): Promise<Sourced<ProcessedAlert[]>> {
  if (park) {
    return load<ProcessedAlert[]>(
      `/api/alerts?park=${encodeURIComponent(park)}`,
      "alerts.json",
      MOCK_ALERTS.filter((a) => a.park_code === park),
      (raw) => (raw as ProcessedAlert[]).filter((a) => a.park_code === park),
    );
  }
  if (!allAlerts) {
    allAlerts = load<ProcessedAlert[]>("/api/alerts", "alerts.json", MOCK_ALERTS);
    allAlerts.then((r) => {
      if (r.source !== "live") return;
      // Live data can change; allow a refetch after a minute.
      setTimeout(() => (allAlerts = null), 60_000);
    });
  }
  return allAlerts;
}

export function getRuns(): Promise<Sourced<WorkflowRun[]>> {
  return load<WorkflowRun[]>("/api/runs", "runs.json", MOCK_RUNS).then((r) => ({
    ...r,
    data: [...simulatedRuns(), ...r.data],
  }));
}

export function getEval(): Promise<Sourced<EvalResults>> {
  return load<EvalResults>("/api/eval", "eval.json", MOCK_EVAL);
}

/* ----- card workflow ------------------------------------------------------- */

const SIM_KEY = "trailtruth:sim-workflows";

interface SimWorkflow {
  workflow_id: string;
  parks: string[];
  started: number;
}

function readSims(): SimWorkflow[] {
  try {
    const raw = window.localStorage.getItem(SIM_KEY);
    return raw ? (JSON.parse(raw) as SimWorkflow[]) : [];
  } catch {
    return [];
  }
}

function writeSims(sims: SimWorkflow[]) {
  try {
    window.localStorage.setItem(SIM_KEY, JSON.stringify(sims.slice(0, 12)));
  } catch {
    /* storage unavailable — the simulation still runs for this session */
  }
}

const memorySims = new Map<string, SimWorkflow>();

function findSim(id: string): SimWorkflow | undefined {
  return memorySims.get(id) ?? readSims().find((s) => s.workflow_id === id);
}

export function isSimulated(id: string): boolean {
  return id.startsWith("sim-");
}

export async function startCard(parks: string[]): Promise<{ workflow_id: string; source: DataSource }> {
  try {
    const res = await fromApi<{ workflow_id: string }>("/api/cards", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ parks }),
    });
    report("live");
    return { workflow_id: res.workflow_id, source: "live" };
  } catch {
    const today = new Date().toISOString().slice(0, 10);
    const rand = Math.random().toString(16).slice(2, 6);
    const sim: SimWorkflow = {
      workflow_id: `sim-trailcard-${today}-${parks.join("-")}-${rand}`,
      parks,
      started: Date.now(),
    };
    memorySims.set(sim.workflow_id, sim);
    writeSims([sim, ...readSims()]);
    report(lastSource === "live" ? "fixture" : (lastSource ?? "fixture"));
    return { workflow_id: sim.workflow_id, source: lastSource ?? "fixture" };
  }
}

export async function getCardStatus(id: string): Promise<Sourced<CardStatus>> {
  const sim = findSim(id);
  if (sim) {
    return { data: await simulateStatus(sim), source: lastSource === "live" ? "fixture" : (lastSource ?? "fixture") };
  }
  return load<CardStatus>(`/api/cards/${encodeURIComponent(id)}`, "card_status.json", MOCK_CARD_STATUS);
}

/** The most recent finished card: newest completed run (live or simulated) → fixture card. */
export async function getLatestCard(): Promise<Sourced<CardStatus>> {
  const runs = await getRuns();
  const latest = runs.data
    .filter((r) => r.status === "completed")
    .sort((a, b) => (b.started_at ?? "").localeCompare(a.started_at ?? ""))[0];
  if (latest && (runs.source === "live" || findSim(latest.workflow_id))) {
    try {
      const status = await getCardStatus(latest.workflow_id);
      if (status.data.card) return status;
    } catch {
      /* fall through to fixture */
    }
  }
  return load<CardStatus>(null, "card_status.json", MOCK_CARD_STATUS);
}

/* ----- workflow simulation -------------------------------------------------- */

interface PlannedStep {
  name: string;
  /** ms offsets from workflow start */
  start: number;
  end: number;
  /** if set, attempt 1 fails at this offset and attempt 2 runs to `end` */
  failAt?: number;
  error?: string;
}

function plan(parks: string[]): PlannedStep[] {
  const steps: PlannedStep[] = [];
  let t = 250;
  parks.forEach((p, i) => {
    const flaky = i === Math.min(1, parks.length - 1) && parks.length > 0;
    const dur = 650;
    if (flaky) {
      steps.push({
        name: `fetch_alerts:${p}`,
        start: t,
        failAt: t + 600,
        end: t + 600 + 1000 + dur,
        error: "attempt 1: NPS API HTTP 503 Service Unavailable (retried after 1s backoff)",
      });
      t += 600 + 1000 + dur;
    } else {
      steps.push({ name: `fetch_alerts:${p}`, start: t, end: t + dur });
      t += dur;
    }
  });
  steps.push({ name: "classify_alerts", start: t, end: t + 2200 });
  t += 2200;
  steps.push({ name: "compose_card", start: t, end: t + 700 });
  t += 700;
  steps.push({ name: "publish_card", start: t, end: t + 450 });
  return steps;
}

function iso(ms: number) {
  return new Date(ms).toISOString();
}

function stepsAt(sim: SimWorkflow, now: number): { steps: WorkflowStep[]; done: boolean } {
  const elapsed = now - sim.started;
  const planned = plan(sim.parks);
  const steps: WorkflowStep[] = planned.map((s) => {
    if (elapsed < s.start) {
      return { name: s.name, status: "pending", attempt: 0, started_at: null, ended_at: null };
    }
    if (s.failAt !== undefined && elapsed < s.failAt) {
      return { name: s.name, status: "running", attempt: 1, started_at: iso(sim.started + s.start), ended_at: null };
    }
    if (s.failAt !== undefined && elapsed < s.failAt + 1000) {
      return {
        name: s.name,
        status: "retrying",
        attempt: 1,
        started_at: iso(sim.started + s.start),
        ended_at: null,
        error: "NPS API HTTP 503 Service Unavailable — backing off 1s",
      };
    }
    if (elapsed < s.end) {
      return {
        name: s.name,
        status: "running",
        attempt: s.failAt !== undefined ? 2 : 1,
        started_at: iso(sim.started + s.start),
        ended_at: null,
        error: s.error,
      };
    }
    return {
      name: s.name,
      status: "completed",
      attempt: s.failAt !== undefined ? 2 : 1,
      started_at: iso(sim.started + s.start),
      ended_at: iso(sim.started + s.end),
      error: s.error,
    };
  });
  return { steps, done: elapsed >= planned[planned.length - 1].end };
}

async function simulateStatus(sim: SimWorkflow): Promise<CardStatus> {
  const { steps, done } = stepsAt(sim, Date.now());
  if (!done) {
    return { status: "running", steps, workflow_id: sim.workflow_id };
  }
  const { data: alerts } = await getAlerts();
  const { data: parks } = await getParks();
  const card = composeCard({
    parks: sim.parks,
    alerts,
    parkNames: Object.fromEntries(parks.map((p) => [p.park_code, p.park_name])),
    workflowId: sim.workflow_id,
    generatedAt: iso(sim.started + plan(sim.parks).at(-1)!.end),
  });
  return { status: "completed", steps, card, workflow_id: sim.workflow_id };
}

function simulatedRuns(): WorkflowRun[] {
  if (typeof window === "undefined") return [];
  const now = Date.now();
  return readSims().map((sim) => {
    const { steps, done } = stepsAt(sim, now);
    const planned = plan(sim.parks);
    return {
      workflow_id: sim.workflow_id,
      status: done ? "completed" : "running",
      steps,
      parks: sim.parks,
      started_at: iso(sim.started),
      ended_at: done ? iso(sim.started + planned[planned.length - 1].end) : null,
      retries: steps.filter((s) => s.attempt > 1).length,
    };
  });
}
