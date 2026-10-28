import { randomUUID } from "node:crypto";
import type { Db } from "./client";
import { modelCall } from "./schema";

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
