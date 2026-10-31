import { describe, expect, it } from "vitest";
import {
  chatCostUsd,
  MemoryCallLog,
  MemorySpendLedger,
  ModelCallError,
  SpendCapError,
  simulateOutput,
  type ModelRequest,
} from "../src/index";
import {
  BASETEN_BASE_URL,
  BASETEN_CHAT_PRICE,
  BASETEN_MODEL,
  BasetenProvider,
  type BasetenCallInfo,
} from "../src/providers/baseten";

type Output = { optionId: string | null; reason: string };

const request: ModelRequest<Output> = {
  stage: "simulateAnswer",
  promptVersion: "simulate.v1",
  messages: [
    { role: "developer", content: "Answer as the participant." },
    { role: "user", content: "Which option?" },
  ],
  schema: simulateOutput,
  reasoningEffort: "medium",
};

const valid = JSON.stringify({ optionId: "o2", reason: "brief" });
const completion = (content: string | null, finish = "stop") => ({
  id: "c1",
  object: "chat.completion",
  created: 0,
  model: BASETEN_MODEL,
  choices: [{ index: 0, finish_reason: finish, message: { role: "assistant", content } }],
  usage: {
    prompt_tokens: 1000,
    completion_tokens: 2000,
    total_tokens: 3000,
    completion_tokens_details: { reasoning_tokens: 1500 },
  },
});
const ok = (content: string | null = valid, finish = "stop") =>
  new Response(JSON.stringify(completion(content, finish)), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
const status = (code: number) =>
  new Response(JSON.stringify({ error: { message: `status ${code}` } }), {
    status: code,
    headers: { "content-type": "application/json" },
  });

function mockFetch(...script: (() => Response)[]) {
  const requests: { url: string; body: Record<string, unknown> }[] = [];
  const fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    requests.push({ url: String(input), body: JSON.parse(String(init?.body)) });
    const next = script[requests.length - 1];
    if (!next) throw new Error("unexpected extra request");
    return next();
  }) as typeof globalThis.fetch;
  return { fetch, requests };
}

function provider(fetch: typeof globalThis.fetch, spendCapUsd = 1) {
  const ledger = new MemorySpendLedger();
  const log = new MemoryCallLog();
  const delays: number[] = [];
  const baseten = new BasetenProvider({
    apiKey: "test-key",
    spendCapUsd,
    ledger,
    log,
    fetch,
    sleep: async (ms) => void delays.push(ms),
    random: () => 0.5,
    now: () => new Date("2026-11-01T12:00:00Z"),
  });
  return { baseten, ledger, log, delays };
}

const oneCall = chatCostUsd(
  { promptTokens: 1000, completionTokens: 2000, cachedTokens: 0 },
  BASETEN_CHAT_PRICE,
);

describe("BasetenProvider", () => {
  it("valid: parses the answer, sends the exact model ID, effort and embedded schema", async () => {
    const { fetch, requests } = mockFetch(() => ok());
    const { baseten, ledger, log } = provider(fetch);
    const { output, call } = await baseten.call(request);

    expect(output).toEqual({ optionId: "o2", reason: "brief" });
    expect(requests).toHaveLength(1);
    const [{ url, body }] = requests as [(typeof requests)[number]];
    expect(url).toBe(`${BASETEN_BASE_URL}/chat/completions`);
    expect(body.model).toBe("meta-models/muse-spark-open-1026");
    expect(body.reasoning_effort).toBe("medium");
    const messages = body.messages as { role: string; content: string }[];
    expect(messages.at(-1)).toMatchObject({ role: "developer" });
    expect(messages.at(-1)!.content).toContain('"optionId"');

    expect(call).toMatchObject({
      provider: "baseten",
      model: BASETEN_MODEL,
      ok: true,
      validFirstTry: true,
      inputTokens: 1000,
      outputTokens: 2000,
      reasoningTokens: 1500,
    } satisfies Partial<BasetenCallInfo>);
    expect(call.costUsd).toBeCloseTo(oneCall);
    expect(await ledger.totalUsd("baseten")).toBeCloseTo(oneCall);
    expect(await ledger.totalUsd("meta")).toBe(0);
    expect(log.entries).toHaveLength(1);
  });

  it("invalid then repaired: one repair turn quoting the problem, both calls billed", async () => {
    const { fetch, requests } = mockFetch(
      () => ok("Sure! Here is the answer: {optionId: o2}"),
      () => ok("```json\n" + valid + "\n```"),
    );
    const { baseten, ledger } = provider(fetch);
    const { output, call } = await baseten.call(request);

    expect(output.optionId).toBe("o2");
    expect(call).toMatchObject({ ok: true, validFirstTry: false, inputTokens: 2000 });
    const repair = requests[1]!.body.messages as { role: string; content: string }[];
    expect(repair.at(-2)).toEqual({
      role: "assistant",
      content: "Sure! Here is the answer: {optionId: o2}",
    });
    expect(repair.at(-1)!.content).toMatch(/not valid: it is not JSON/);
    expect(await ledger.totalUsd("baseten")).toBeCloseTo(2 * oneCall);
  });

  it("names the schema problem in the repair turn", async () => {
    const { fetch, requests } = mockFetch(
      () => ok(JSON.stringify({ optionId: 2 })),
      () => ok(),
    );
    await provider(fetch).baseten.call(request);
    const repair = requests[1]!.body.messages as { content: string }[];
    expect(repair.at(-1)!.content).toMatch(/does not match the schema \(optionId: .*reason: /);
  });

  it("invalid twice: invalid_output after exactly one repair, logged as failed", async () => {
    const { fetch, requests } = mockFetch(
      () => ok("nope"),
      () => ok(JSON.stringify({ reason: 3 })),
    );
    const { baseten, log } = provider(fetch);
    const error = await baseten.call(request).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ModelCallError);
    expect(error).toMatchObject({ kind: "invalid_output" });
    expect(requests).toHaveLength(2);
    expect(log.entries).toHaveLength(1);
    expect(log.entries[0]).toMatchObject({ ok: false, validFirstTry: false });
    expect(log.entries[0]!.error).toMatch(/^invalid_output: still invalid after one repair/);
  });

  it("529 then success: backs off like a 429", async () => {
    const { fetch, requests } = mockFetch(
      () => status(529),
      () => status(429),
      () => ok(),
    );
    const { baseten, delays } = provider(fetch);
    const { call } = await baseten.call(request);

    expect(requests).toHaveLength(3);
    expect(delays).toEqual([500, 1000]);
    expect(call).toMatchObject({ ok: true, validFirstTry: true });
  });

  it("does not retry a 400", async () => {
    const { fetch, requests } = mockFetch(() => status(400));
    const error = await provider(fetch)
      .baseten.call(request)
      .catch((e: unknown) => e);
    expect(error).toMatchObject({ kind: "request", status: 400 });
    expect(requests).toHaveLength(1);
  });

  it("stops at its own spend cap without calling", async () => {
    const { fetch, requests } = mockFetch();
    const { baseten, ledger } = provider(fetch, 0.5);
    await ledger.add("meta", 10);
    await ledger.add("baseten", 0.5);
    await expect(baseten.call(request)).rejects.toBeInstanceOf(SpendCapError);
    expect(requests).toHaveLength(0);
  });

  it("treats a truncated answer as truncated, not as something to repair", async () => {
    const { fetch, requests } = mockFetch(() => ok('{"optionId":', "length"));
    const error = await provider(fetch)
      .baseten.call(request)
      .catch((e: unknown) => e);
    expect(error).toMatchObject({ kind: "truncated" });
    expect(requests).toHaveLength(1);
  });
});
