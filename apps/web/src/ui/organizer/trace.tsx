"use client";

import { useState, type SyntheticEvent } from "react";
import type { TraceCall, TraceResponse } from "../../contracts/api";
import { callApi, MISSING_KEY, organizerToken, type Loaded } from "../api";
import { ErrorNotice, Loading } from "../components";

const stageLabel: Record<string, string> = {
  extract: "Find decisions",
  findCandidates: "Find what could be read two ways",
  generateProbes: "Draft questions",
  critique: "Check drafted questions",
  mapWriteIn: "Match written answers",
  draftResolution: "Draft wording",
  generateRecheck: "Draft recheck question",
  draftRecordProse: "Write record summary",
  simulateAnswer: "Simulated answers",
};

const replayed = (c: TraceCall) => c.provider === "fake";

function source(c: TraceCall): string {
  if (c.cacheHit) return "Cache";
  return replayed(c) ? "Replay" : "Live";
}

const whole = new Intl.NumberFormat("en-US");
const usd = (n: number) => `$${n.toFixed(4)}`;

function tokens(c: TraceCall): string {
  const base = `${whole.format(c.inputTokens)} in, ${whole.format(c.outputTokens)} out`;
  return c.reasoningTokens === null
    ? base
    : `${base}, ${whole.format(c.reasoningTokens)} reasoning`;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function TraceView({ data }: { data: TraceResponse }) {
  const { calls, computed } = data;
  const anyReplay = calls.some(replayed);
  const cost = calls.reduce((n, c) => n + c.costUsd, 0);
  const failed = calls.filter((c) => !c.ok).length;
  return (
    <>
      <h3>Model calls</h3>
      {calls.length === 0 ? (
        <p>No model calls are logged for this meeting yet.</p>
      ) : (
        <>
          <p>
            {plural(calls.length, "call")}, {usd(cost)} in total
            {failed > 0 && <>, {failed} failed</>}.
            {anyReplay && (
              <> Replayed calls reuse a recorded reply, so they take no time and cost nothing.</>
            )}
          </p>
          <div className="table-scroll" role="region" aria-label="Model calls" tabIndex={0}>
            <table className="trace-table">
              <thead>
                <tr>
                  <th scope="col">Stage</th>
                  <th scope="col">Provider and model</th>
                  <th scope="col">Source</th>
                  <th scope="col">Time</th>
                  <th scope="col">Tokens</th>
                  <th scope="col">Cost</th>
                </tr>
              </thead>
              <tbody>
                {calls.map((c, i) => (
                  <tr key={`${c.at}-${i}`}>
                    <th scope="row">
                      {stageLabel[c.stage] ?? c.stage}
                      <span className="trace-version">{c.promptVersion}</span>
                      {!c.ok && (
                        <span className="trace-failed">
                          Failed: {c.error ?? "no reason logged"}
                        </span>
                      )}
                    </th>
                    <td>{replayed(c) ? c.model : `${c.provider} ${c.model}`}</td>
                    <td>{source(c)}</td>
                    <td>{replayed(c) ? "Not timed" : `${whole.format(c.latencyMs)} ms`}</td>
                    <td>{tokens(c)}</td>
                    <td>{usd(c.costUsd)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      <h3>Computed by code, not the model</h3>
      {computed === null ? (
        <p>Nothing yet. Code compares the answers once a round closes.</p>
      ) : (
        <ul>
          <li>
            Which questions got different answers: {computed.questions.split} with different
            answers, {computed.questions.consistent} with the same answer
            {computed.questions.insufficient > 0 && (
              <>, {computed.questions.insufficient} with too few answers</>
            )}
            .
          </li>
          <li>Who confirmed which wording: {plural(computed.confirmations, "confirmation")}.</li>
          <li>
            Where each record item goes: {computed.record.confirmed} confirmed,{" "}
            {computed.record.unresolved} unresolved, {computed.record.stated} stated in the meeting.
          </li>
        </ul>
      )}
    </>
  );
}

/** Closed by default; it fetches the log each time it opens, so it shows the latest calls. */
export function TracePanel({ meetingId }: { meetingId: string }) {
  const [loaded, setLoaded] = useState<Loaded<TraceResponse> | null>(null);

  async function onToggle(e: SyntheticEvent<HTMLDetailsElement>) {
    if (!e.currentTarget.open) return;
    const token = organizerToken(meetingId);
    if (token === null) {
      setLoaded({ state: "error", message: MISSING_KEY, status: null });
      return;
    }
    setLoaded((prev) => prev ?? { state: "loading" });
    const res = await callApi<TraceResponse>(
      `/api/meetings/${encodeURIComponent(meetingId)}/trace`,
      { token },
    );
    setLoaded(
      res.ok
        ? { state: "ready", data: res.data }
        : { state: "error", message: res.message, status: res.status },
    );
  }

  return (
    <aside className="trace" aria-labelledby="trace-heading">
      <details onToggle={onToggle}>
        <summary>
          <h2 id="trace-heading">What the model did</h2>
        </summary>
        {loaded?.state === "loading" && <Loading>Reading the call log.</Loading>}
        {loaded?.state === "error" && <ErrorNotice>{loaded.message}</ErrorNotice>}
        {loaded?.state === "ready" && <TraceView data={loaded.data} />}
      </details>
    </aside>
  );
}
