/** USD per million tokens. */
export interface ChatPrice {
  input: number;
  cachedInput: number;
  output: number;
}

/** Meta Muse Spark 1.3 (R§4.2). */
export const META_CHAT_PRICE = { input: 1.25, cachedInput: 0.15, output: 4.25 } as const;

export interface ChatUsage {
  promptTokens: number;
  completionTokens: number;
  cachedTokens: number;
}

// Reasoning tokens are already inside completion tokens and bill as output.
export function chatCostUsd(usage: ChatUsage, price: ChatPrice): number {
  const uncached = usage.promptTokens - usage.cachedTokens;
  return (
    (uncached * price.input +
      usage.cachedTokens * price.cachedInput +
      usage.completionTokens * price.output) /
    1_000_000
  );
}
