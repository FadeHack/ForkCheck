import { describe, expect, it } from "vitest";
import { writeInOutput, type ModelPort, type ModelRequest } from "@forkcheck/ai";
import { stageNames, type Stages } from "../src/index";

describe("stage contracts", () => {
  it("lists the nine stages", () => {
    expect(stageNames).toHaveLength(9);
  });

  it("a stage passes its request through the port and returns a trace", async () => {
    const seen: ModelRequest<unknown>[] = [];
    const port: ModelPort = {
      call: (request) => {
        seen.push(request as ModelRequest<unknown>);
        const output = request.schema.parse({ optionId: "o1", reason: "fits" });
        return Promise.resolve({
          output,
          call: {
            stage: request.stage,
            provider: "fake",
            model: "fake",
            promptVersion: request.promptVersion,
            cacheHit: true,
            latencyMs: 0,
            inputTokens: 0,
            outputTokens: 0,
            reasoningTokens: null,
            costUsd: 0,
            ok: true,
            error: null,
          },
        });
      },
    };

    const mapWriteIn: Stages["mapWriteIn"] = async (input, model) => {
      const { output, call } = await model.call({
        stage: "mapWriteIn",
        promptVersion: "test.v0",
        messages: [{ role: "user", content: input.text }],
        schema: writeInOutput,
        reasoningEffort: "low",
      });
      return {
        output: { mappedOptionId: output.optionId, mappedByModel: true },
        trace: { stage: "mapWriteIn", promptVersion: "test.v0", calls: [call], drops: [] },
      };
    };

    const probe = {
      id: "p1",
      meetingId: "m1",
      kind: "diagnostic" as const,
      candidateId: "c1",
      splitId: null,
      tier: "free" as const,
      stem: "What has to exist by Friday?",
      options: [{ id: "o1", text: "A production login" }],
      lint: [],
      promptVersion: "test.v0",
      status: "published" as const,
    };
    const result = await mapWriteIn({ probe, text: "prod" }, port);
    expect(result.output).toEqual({ mappedOptionId: "o1", mappedByModel: true });
    expect(result.trace.calls).toHaveLength(1);
    expect(seen[0]?.stage).toBe("mapWriteIn");
  });
});
