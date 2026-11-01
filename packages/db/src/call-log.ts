import { randomUUID } from "node:crypto";
import { and, asc, eq } from "drizzle-orm";
import { toIso, type Db } from "./client";
import { modelCall } from "./schema";

/** The stage name transcriptions are logged under, next to the model stages. */
export const TRANSCRIBE_STAGE = "transcribe";

/** The ai package's ModelCallEntry, restated because db may not import ai. */
export interface ModelCallRecord {
  at: string;
  stage: string;
  provider: string;
  model: string;
  promptVersion: string;
  cacheHit: boolean;
  latencyMs: number;
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number | null;
  costUsd: number;
  ok: boolean;
  error: string | null;
}

/** A ModelCallLog that writes `model_call` rows, scoped to one meeting or eval run. */
export class DbCallLog {
  constructor(
    private readonly db: Db,
    private readonly scope: { meetingId?: string; evalRunId?: string } = {},
  ) {}

  async write(entry: ModelCallRecord): Promise<void> {
    await this.db.insert(modelCall).values({
      ...entry,
      id: randomUUID(),
      meetingId: this.scope.meetingId ?? null,
      evalRunId: this.scope.evalRunId ?? null,
      at: new Date(entry.at),
    });
  }
}

/** A meeting's logged model calls, oldest first. */
export async function meetingModelCalls(db: Db, meetingId: string): Promise<ModelCallRecord[]> {
  const rows = await db
    .select()
    .from(modelCall)
    .where(eq(modelCall.meetingId, meetingId))
    .orderBy(asc(modelCall.at), asc(modelCall.id));
  return rows.map(({ id: _id, meetingId: _m, evalRunId: _e, at, ...rest }) => ({
    ...rest,
    at: toIso(at),
  }));
}

/** Whether any of the meeting's model results or its transcription came from a recorded reply. */
export async function meetingReplays(
  db: Db,
  meetingId: string,
): Promise<{ model: boolean; transcription: boolean }> {
  const rows = await db
    .selectDistinct({ stage: modelCall.stage })
    .from(modelCall)
    .where(
      and(
        eq(modelCall.meetingId, meetingId),
        eq(modelCall.provider, "fake"),
        eq(modelCall.ok, true),
      ),
    );
  return {
    model: rows.some((r) => r.stage !== TRANSCRIBE_STAGE),
    transcription: rows.some((r) => r.stage === TRANSCRIBE_STAGE),
  };
}
