import type { CardPark, Decision, ProcessedAlert, TrailCard } from "./types";

export const DECISION_RANK: Record<Decision, number> = { go: 0, caution: 1, no_go: 2 };

export function worstDecision(ds: Decision[]): Decision {
  return ds.reduce<Decision>((w, d) => (DECISION_RANK[d] > DECISION_RANK[w] ? d : w), "go");
}

function uniq(xs: string[]) {
  return [...new Set(xs.map((x) => x.trim()).filter(Boolean))];
}

function clip(s: string, n = 70) {
  return s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s;
}

function joinTrails(trails: string[]) {
  if (trails.length <= 2) return trails.join(" & ");
  return `${trails.slice(0, 2).join(", ")} +${trails.length - 2}`;
}

/**
 * Client-side mirror of the backend's compose_card step. Used to build a card
 * when the workflow is simulated (API offline) — the live workflow composes
 * its own card server-side.
 */
export function composePark(code: string, name: string, alerts: ProcessedAlert[]): CardPark {
  const closures = alerts.filter((a) => a.verdict.is_closed);
  const closed = uniq(closures.flatMap((a) => a.verdict.trails_affected));
  const hardNoGo = alerts.filter((a) => a.verdict.decision === "no_go" && !a.verdict.is_closed);
  const cautions = alerts.filter((a) => a.verdict.decision === "caution");

  let decision: Decision;
  let headline: string;
  if (hardNoGo.length) {
    decision = "no_go";
    headline = `No-go — ${clip(hardNoGo[0].verdict.reason, 60)}`;
  } else if (closed.length) {
    decision = "caution";
    headline = `Go — but skip ${joinTrails(closed)}`;
  } else if (closures.length) {
    decision = "caution";
    headline = `Go — some areas closed`;
  } else if (cautions.length) {
    decision = "caution";
    headline = `Go with care — ${clip(cautions[0].title, 56)}`;
  } else {
    decision = "go";
    headline = alerts.length ? "Go — nothing blocking the trails" : "Go — no active alerts";
  }

  const watch_for = uniq(
    [...hardNoGo, ...cautions, ...alerts.filter((a) => a.verdict.decision === "go" && a.verdict.severity > 1)]
      .map((a) => clip(a.verdict.reason || a.title, 80)),
  ).slice(0, 4);

  return {
    park_code: code,
    park_name: name,
    decision,
    headline,
    closed_trails: closed.slice(0, 6),
    watch_for,
    alert_ids: alerts.map((a) => a.id),
  };
}

export function composeCard({
  parks,
  alerts,
  parkNames,
  workflowId,
  generatedAt,
}: {
  parks: string[];
  alerts: ProcessedAlert[];
  parkNames: Record<string, string>;
  workflowId: string;
  generatedAt: string;
}): TrailCard {
  const cardParks = parks.map((code) => {
    const mine = alerts.filter((a) => a.park_code === code);
    const name = parkNames[code] ?? mine[0]?.park_name ?? code.toUpperCase();
    return composePark(code, name, mine);
  });
  const weekOf = generatedAt.slice(0, 10);
  const models = uniq(alerts.filter((a) => parks.includes(a.park_code)).map((a) => a.model));
  return {
    id: `card_${weekOf}_${parks.join("-")}`,
    generated_at: generatedAt,
    week_of: weekOf,
    parks: cardParks,
    overall: worstDecision(cardParks.map((p) => p.decision)),
    workflow_id: workflowId,
    model: models[0] ?? "unknown",
  };
}
