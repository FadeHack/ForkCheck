import { describe, expect, it } from "vitest";
import { simulateOutput, type ModelPort, type ModelResponse } from "@forkcheck/ai";
import { routeStages } from "../src/index";

describe("routeStages", () => {
  it("sends overridden stages to their provider and the rest to the primary", async () => {
    const seen: string[] = [];
    const tagged = (name: string): ModelPort => ({
      call: async <T>(request: { stage: string }) => {
        seen.push(`${name}:${request.stage}`);
        return { output: null, call: null } as unknown as ModelResponse<T>;
      },
    });
    const model = routeStages(tagged("open"), { simulateAnswer: tagged("spark") });
    const request = {
      promptVersion: "v1",
      messages: [],
      schema: simulateOutput,
      reasoningEffort: "low" as const,
    };
    await model.call({ ...request, stage: "simulateAnswer" });
    await model.call({ ...request, stage: "extract" });
    expect(seen).toEqual(["spark:simulateAnswer", "open:extract"]);
  });
});
