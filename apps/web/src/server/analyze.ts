import { randomUUID } from "node:crypto";
import type { Meeting, MeetingStatus } from "@forkcheck/core";
import type { AnalysisStep } from "@forkcheck/db";
import { draftProbes, extract, findCandidates, type MeetingContext } from "@forkcheck/engine";
import type { AnalyzeResponse } from "../contracts/api";
import type { Deps } from "./deps";
import { logError } from "./log";
import { stepClaim, StepTakenOver, withHeartbeat } from "./steps";

/** Statuses analysis may start from. Once questions exist the meeting is `probing` or later. */
const STARTABLE: readonly MeetingStatus[] = ["draft", "review", "failed"];

/** Step names as the organizer sees them in an error. */
export const STEP_LABELS: Record<AnalysisStep, string> = {
  extract: "read decisions",
  candidates: "find open details",
  probes: "draft questions",
};

export type AnalyzeOutcome =
  | { ok: true; response: AnalyzeResponse }
  | { ok: false; status: 409 | 502; code: string; message: string };

async function stored(deps: Deps, meetingId: string): Promise<AnalyzeResponse> {
  const a = await deps.meetings.analysis(meetingId);
  return { decisions: a.decisions, candidates: a.candidates, draftProbes: a.probes };
}

/**
 * Runs extract, candidates and probe drafting, saving after each step. A finished analysis of
 * the current transcript version is returned as stored; a failed one, or one whose run went
 * silent past the step lease, resumes after its last finished step.
 */
export async function analyzeMeeting(deps: Deps, meeting: Meeting): Promise<AnalyzeOutcome> {
  const before = await deps.meetings.analysisProgress(meeting.id);
  if (before?.version === meeting.transcriptVersion && before.step === "probes") {
    return { ok: true, response: await stored(deps, meeting.id) };
  }
  if (meeting.transcriptVersion === 0) {
    return {
      ok: false,
      status: 409,
      code: "no_transcript",
      message: "There is no transcript to analyze yet. Paste one or finish transcription first.",
    };
  }
  const runId = randomUUID();
  if (!(await deps.meetings.startAnalysis(meeting.id, STARTABLE, stepClaim(deps, runId)))) {
    const current = await deps.meetings.get(meeting.id);
    return current?.status === "analyzing"
      ? {
          ok: false,
          status: 409,
          code: "analysis_running",
          message:
            "Analysis is already running for this meeting. Wait for it to finish, or retry if it stops showing progress.",
        }
      : {
          ok: false,
          status: 409,
          code: "analysis_closed",
          message:
            "Questions were already drafted for this meeting, so it can't be analyzed again.",
        };
  }

  const progress = await deps.meetings.analysisProgress(meeting.id);
  if (progress?.version !== meeting.transcriptVersion) {
    await deps.meetings.resetAnalysis(meeting.id, meeting.transcriptVersion);
  }
  const done = progress?.version === meeting.transcriptVersion ? progress.step : null;
  const model = withHeartbeat(deps, meeting.id, runId, deps.model(meeting.id));
  const context: MeetingContext = {
    id: meeting.id,
    title: meeting.title,
    heldAt: meeting.heldAt,
    timezone: meeting.timezone,
  };
  const [participants, segments] = await Promise.all([
    deps.meetings.participants(meeting.id),
    deps.meetings.segments(meeting.id),
  ]);

  let step: AnalysisStep = "extract";
  try {
    if (done === null) {
      const { output } = await extract({ meeting: context, participants, segments }, model);
      await deps.meetings.saveDecisions(meeting.id, output.decisions);
    }
    step = "candidates";
    if (done === null || done === "extract") {
      const { decisions } = await deps.meetings.analysis(meeting.id);
      const { output } = await findCandidates(
        { meeting: context, participants, segments, decisions, dimensions: deps.dimensions },
        model,
      );
      await deps.meetings.saveCandidates(meeting.id, output.candidates);
    }
    step = "probes";
    const { decisions, candidates } = await deps.meetings.analysis(meeting.id);
    const { probes } = await draftProbes(
      { meeting: context, participants, segments, decisions, candidates },
      model,
    );
    await deps.meetings.saveDraftProbes(meeting.id, probes);
  } catch (error) {
    if (error instanceof StepTakenOver) {
      return {
        ok: false,
        status: 409,
        code: "analysis_running",
        message: "A newer request took over this analysis. Its progress shows on the meeting.",
      };
    }
    logError(`analyze ${meeting.id} at ${step}`, error);
    const message = `Drafting stopped at '${STEP_LABELS[step]}'. Retry from that step.`;
    await deps.meetings.failAnalysis(meeting.id, runId, step, message);
    return { ok: false, status: 502, code: "analysis_failed", message };
  }
  return { ok: true, response: await stored(deps, meeting.id) };
}
