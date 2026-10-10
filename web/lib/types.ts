/**
 * TrailTruth shared types — mirrors shared/schema.py exactly.
 * If you change one, change the other (see CONTRACT.md).
 */

export const HAZARD_TYPES = [
  "closure",
  "wildlife",
  "weather",
  "fire",
  "water",
  "geologic",
  "construction",
  "air_quality",
  "road",
  "facility",
  "other",
] as const;
export type HazardType = (typeof HAZARD_TYPES)[number];

export const DECISIONS = ["go", "caution", "no_go"] as const;
export type Decision = (typeof DECISIONS)[number];

export const NPS_CATEGORIES = ["Danger", "Caution", "Park Closure", "Information"] as const;
export type NpsCategory = (typeof NPS_CATEGORIES)[number];

export const CATEGORY_TO_DECISION: Record<NpsCategory, Decision> = {
  Information: "go",
  Caution: "caution",
  Danger: "no_go",
  "Park Closure": "no_go",
};

/** Canonical model output. */
export interface TrailVerdict {
  hazard_type: HazardType;
  /** 1 = info, 2 = caution, 3 = danger */
  severity: number;
  trails_affected: string[];
  is_closed: boolean;
  decision: Decision;
  /** <= 20 words (max 200 chars) */
  reason: string;
}

export interface ProcessedAlert {
  id: string;
  park_code: string;
  park_name: string;
  title: string;
  description: string;
  url: string;
  /** NPS category — typed as string in schema.py; usually one of NpsCategory. */
  nps_category: string;
  last_indexed: string;
  verdict: TrailVerdict;
  model: string;
  latency_ms: number;
}

export interface CardPark {
  park_code: string;
  park_name: string;
  decision: Decision;
  headline: string;
  closed_trails: string[];
  watch_for: string[];
  alert_ids: string[];
}

export interface TrailCard {
  id: string;
  generated_at: string;
  week_of: string;
  parks: CardPark[];
  overall: Decision;
  workflow_id: string;
  model: string;
}

/* ----- API envelopes (CONTRACT.md → Backend API) -------------------------- */

export interface Park {
  park_code: string;
  park_name: string;
  states: string;
  alert_count: number;
  worst_decision: Decision | null;
}

export type StepStatus = "pending" | "scheduled" | "running" | "retrying" | "completed" | "failed" | (string & {});
export type RunStatus = "pending" | "running" | "completed" | "failed" | (string & {});

export interface WorkflowStep {
  name: string;
  status: StepStatus;
  attempt: number;
  started_at: string | null;
  ended_at: string | null;
  error?: string | null;
  /** Optional human-readable note from the backend, e.g. "9 alerts, source=cache". */
  detail?: string | null;
}

/** GET /api/cards/{workflow_id} */
export interface CardStatus {
  status: RunStatus;
  card?: TrailCard | null;
  steps: WorkflowStep[];
  workflow_id?: string;
  fixture?: boolean;
}

/** GET /api/runs — same shape as CardStatus, without the card. */
export interface WorkflowRun {
  workflow_id: string;
  status: RunStatus;
  steps: WorkflowStep[];
  parks?: string[];
  started_at?: string | null;
  ended_at?: string | null;
  card_id?: string | null;
  retries?: number;
  fixture?: boolean;
}

export type ModelRole = "teacher" | "base" | "base_guided" | "lora" | "heuristic" | (string & {});

/** Metrics are null while a model is still pending (e.g. LoRA not trained yet). */
export interface EvalModel {
  name: string;
  role: ModelRole;
  json_valid: number | null;
  decision_acc: number | null;
  closure_f1: number | null;
  hazard_acc: number | null;
  p50_latency_ms: number | null;
  cost_per_1k_alerts_usd: number | null;
  pending?: boolean;
  model?: string;
  n?: number;
  p95_latency_ms?: number | null;
  decision_macro_f1?: number | null;
  decision_agree_teacher?: number | null;
}

export interface ConfusionMatrix {
  labels: string[];
  matrix: number[][];
  invalid?: number;
}

export interface EvalExample {
  title: string;
  base_output: string | null;
  lora_output: string | null;
  expected_decision: string;
  teacher_output?: string | null;
  heuristic_output?: string | null;
  id?: string;
  park_code?: string;
  description?: string;
  nps_category?: string;
}

/** GET /api/eval → ml/results/eval.json */
export interface EvalResults {
  test_size: number;
  generated_at: string;
  models: EvalModel[];
  confusion: Record<string, ConfusionMatrix>;
  training: {
    steps: number;
    epochs: number;
    lora_rank: number;
    loss_curve: [number, number][];
    test_loss?: [number, number][];
    base_model?: string;
  };
  examples: EvalExample[];
  /** True when no training run has produced results yet. */
  pending?: boolean;
  fixture?: boolean;
  note?: string;
  notes?: string[];
  teacher_model?: string;
  student_model?: string;
  label_source?: string;
  test_by_category?: Record<string, number>;
}

export type DataSource = "live" | "fixture" | "mock";
