"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getCardStatus, startCard } from "./api";
import { recordCard, setLastWorkflow } from "./store";
import type { CardStatus } from "./types";

export type GenPhase = "idle" | "starting" | "running" | "done" | "error";

export function useCardGeneration() {
  const [phase, setPhase] = useState<GenPhase>("idle");
  const [workflowId, setWorkflowId] = useState<string | null>(null);
  const [status, setStatus] = useState<CardStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const timer = useRef<number | null>(null);

  const stop = () => {
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = null;
  };

  useEffect(() => stop, []);

  const poll = useCallback((id: string) => {
    const tick = async () => {
      try {
        const { data } = await getCardStatus(id);
        setStatus(data);
        if (data.status === "completed" && data.card) {
          setPhase("done");
          setLastWorkflow(id);
          recordCard(data.card.parks.reduce((n, p) => n + p.alert_ids.length, 0));
          return;
        }
        if (data.status === "failed") {
          setPhase("error");
          setError(data.steps.find((s) => s.status === "failed")?.error ?? "Workflow failed");
          return;
        }
      } catch (e) {
        // transient polling error — keep polling, Temporal will keep running
        console.warn("poll failed", e);
      }
      timer.current = window.setTimeout(tick, 800);
    };
    void tick();
  }, []);

  const start = useCallback(
    async (parks: string[]) => {
      stop();
      setPhase("starting");
      setError(null);
      setStatus(null);
      setStartedAt(Date.now());
      try {
        const { workflow_id } = await startCard(parks);
        setWorkflowId(workflow_id);
        setPhase("running");
        poll(workflow_id);
      } catch (e) {
        setPhase("error");
        setError(String(e));
      }
    },
    [poll],
  );

  const reset = useCallback(() => {
    stop();
    setPhase("idle");
    setStatus(null);
    setWorkflowId(null);
    setError(null);
  }, []);

  return { phase, workflowId, status, error, startedAt, start, reset };
}
