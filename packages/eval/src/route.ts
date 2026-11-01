import type { ModelPort, ModelRequest, ModelResponse, StageName } from "@forkcheck/ai";

/**
 * Sends each stage to its own provider, the rest to `primary`. The comparison runs Spark Open
 * for the stages under test and keeps the simulator on Muse Spark, so the simulated
 * participants are the same in every condition (R§7.2).
 */
export function routeStages(
  primary: ModelPort,
  overrides: Partial<Record<StageName, ModelPort>>,
): ModelPort {
  return {
    call<T>(request: ModelRequest<T>): Promise<ModelResponse<T>> {
      return (overrides[request.stage] ?? primary).call(request);
    },
  };
}
