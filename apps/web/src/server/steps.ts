import type { ModelPort } from "@forkcheck/ai";
import type { Meeting } from "@forkcheck/core";
import type { AnalysisStep } from "@forkcheck/db";
import type { MeetingProgressResponse } from "../contracts/api";
import type { Deps } from "./deps";

/**
 * How long a running step may stay silent before another request may take it over. Longer
 * than the slowest single model call: 3 attempts of up to 180 s each, plus backoff.
 */
export const STEP_LEASE_MS = 10 * 60_000;

/** Thrown inside a run that another request took over, so it stops at its next model call. */
export class StepTakenOver extends Error {
  constructor(meetingId: string) {
    super(`another run took over the step for ${meetingId}`);
    this.name = "StepTakenOver";
  }
}

export const stepClaim = (deps: Deps, runId: string) => {
  const now = deps.now();
  return { runId, now, staleBefore: new Date(now.getTime() - STEP_LEASE_MS) };
};

/**
 * Records a sign of life around every model call. A run that lost its claim stops there,
 * before it can save what a call returned over the newer run's rows.
 */
export function withHeartbeat(deps: Deps, meetingId: string, runId: string, model: ModelPort) {
  const beat = async () => {
    if (!(await deps.meetings.heartbeat(meetingId, runId, deps.now()))) {
      throw new StepTakenOver(meetingId);
    }
  };
  return {
    async call(request) {
      await beat();
      const response = await model.call(request);
      await beat();
      return response;
    },
  } satisfies ModelPort;
}

const NEXT_STEP: Record<AnalysisStep, AnalysisStep | null> = {
  extract: "candidates",
  candidates: "probes",
  probes: null,
};

/** Small enough to poll every few seconds while a long step runs. */
export async function meetingProgress(
  deps: Deps,
  meeting: Meeting,
): Promise<MeetingProgressResponse> {
  const progress = await deps.meetings.analysisProgress(meeting.id);
  const heartbeat = progress?.heartbeatAt ? Date.parse(progress.heartbeatAt) : null;
  const stalled = heartbeat !== null && deps.now().getTime() - heartbeat > STEP_LEASE_MS;
  const base = { status: meeting.status, error: meeting.error };
  switch (meeting.status) {
    case "analyzing": {
      const current = progress?.version === meeting.transcriptVersion ? progress.step : null;
      const step = current === null ? "extract" : NEXT_STEP[current];
      return { ...base, step, stalled };
    }
    case "transcribing":
      return { ...base, step: "transcribe", stalled };
    case "failed": {
      // Transcription is the only step that fails before there is a transcript.
      const step =
        meeting.source === "audio" && meeting.transcriptVersion === 0
          ? "transcribe"
          : (progress?.failedStep ?? null);
      return { ...base, step, stalled: false };
    }
    default:
      return { ...base, step: null, stalled: false };
  }
}
