import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  chatCostUsd,
  FileSpendLedger,
  META_CHAT_PRICE,
  MemoryCallLog,
  MemoryModelCache,
  MemorySpendLedger,
  MetaProvider,
  ModelCallError,
  SpendCapError,
  simulateOutput,
  type ModelRequest,
} from "../src/index";

type Output = { optionId: string | null; reason: string };

const request: ModelRequest<Output> = {
  stage: "simulateAnswer",
  promptVersion: "simulate.v1",
  messages: [
    { role: "developer", content: "Answer as the participant." },
    { role: "user", content: "Which option?" },
  ],
  schema: simulateOutput,
  reasoningEffort: "low",
};

const completion = (content: string | null, finish = "stop") => ({
  id: "c1",
  object: "chat.completion",
  created: 0,
  model: "muse-spark-1.3",
  choices: [{ index: 0, finish_reason: finish, message: { role: "assistant", content } }],
  usage: {
    prompt_tokens: 1000,
    completion_tokens: 2000,
    total_tokens: 3000,
    prompt_tokens_details: { cached_tokens: 400 },
    completion_tokens_details: { reasoning_tokens: 1500 },
  },
});

const ok = (body: unknown = completion(JSON.stringify({ optionId: "o2", reason: "brief" }))) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
const status = (code: number) =>
  new Response(JSON.stringify({ error: { message: `status ${code}` } }), {
    status: code,
    headers: { "content-type": "application/json" },
  });

/** A fetch that answers from a script and records each request. */
function mockFetch(...script: (() => Response | Promise<Response>)[]) {
  const requests: { url: string; body: Record<string, unknown> }[] = [];
  const fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    requests.push({ url: String(input), body: JSON.parse(String(init?.body)) });
    const next = script[requests.length - 1];
    if (!next) throw new Error("unexpected extra request");
    return next();
  }) as typeof globalThis.fetch;
  return { fetch, requests };
}

function provider(
  fetch: typeof globalThis.fetch,
  extra: Partial<ConstructorParameters<typeof MetaProvider>[0]> = {},
) {
  const ledger = new MemorySpendLedger();
  const log = new MemoryCallLog();
  const delays: number[] = [];
  const meta = new MetaProvider({
    apiKey: "test-key",
    spendCapUsd: 1,
    ledger,
    log,
    fetch,
    sleep: async (ms) => void delays.push(ms),
    random: () => 0.5,
    now: () => new Date("2026-10-28T12:00:00Z"),
    ...extra,
  });
  return { meta, ledger, log, delays };
}

const expectedCost = chatCostUsd(
  { promptTokens: 1000, completionTokens: 2000, cachedTokens: 400 },
  META_CHAT_PRICE,
);

describe("MetaProvider", () => {
  it("calls Chat Completions with a strict schema and logs tokens and cost", async () => {
    const { fetch, requests } = mockFetch(() => ok());
    const { meta, ledger, log } = provider(fetch);
    const res = await meta.call(request);

    expect(res.output).toEqual({ optionId: "o2", reason: "brief" });
    expect(res.call).toMatchObject({
      provider: "meta",
      model: "muse-spark-1.3",
      stage: "simulateAnswer",
      promptVersion: "simulate.v1",
      cacheHit: false,
      inputTokens: 1000,
      outputTokens: 2000,
      reasoningTokens: 1500,
      ok: true,
      error: null,
    });
    expect(res.call.costUsd).toBeCloseTo(expectedCost, 10);
    expect(await ledger.totalUsd("meta")).toBeCloseTo(expectedCost, 10);
    expect(log.entries).toEqual([{ ...res.call, at: "2026-10-28T12:00:00.000Z" }]);

    const [sent] = requests;
    expect(sent?.url).toBe("https://api.meta.ai/v1/chat/completions");
    expect(sent?.body).toMatchObject({
      model: "muse-spark-1.3",
      reasoning_effort: "low",
      max_completion_tokens: 4000,
      response_format: {
        type: "json_schema",
        json_schema: { name: "simulate_answer_output", strict: true },
      },
    });
    expect(sent?.body).not.toHaveProperty("n");
    expect(sent?.body).not.toHaveProperty("store");
  });

  it("retries a 429 and then succeeds", async () => {
    const { fetch, requests } = mockFetch(
      () => status(429),
      () => ok(),
    );
    const { meta, delays, log } = provider(fetch);
    await expect(meta.call(request)).resolves.toMatchObject({ call: { ok: true } });
    expect(requests).toHaveLength(2);
    expect(delays).toEqual([500]);
    expect(log.entries).toHaveLength(1);
  });

  it("gives up after three 500s with a typed error", async () => {
    const { fetch, requests } = mockFetch(
      () => status(500),
      () => status(502),
      () => status(503),
    );
    const { meta, delays, log, ledger } = provider(fetch);
    const error = await meta.call(request).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ModelCallError);
    expect(error).toMatchObject({ kind: "server", attempts: 3, status: 503 });
    expect(requests).toHaveLength(3);
    // Full jitter at 0.5 of a 1 s, then 2 s ceiling.
    expect(delays).toEqual([500, 1000]);
    expect(log.entries).toMatchObject([{ ok: false, costUsd: 0 }]);
    expect(await ledger.totalUsd("meta")).toBe(0);
  });

  it("retries a timeout", async () => {
    // Never answers; only the SDK's timeout abort settles it.
    const fetch = ((_url: string | URL | Request, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () =>
          reject(new DOMException("aborted", "AbortError")),
        );
      })) as typeof globalThis.fetch;
    const { meta } = provider(fetch, { timeoutMs: 10 });
    await expect(meta.call(request)).rejects.toMatchObject({ kind: "timeout", attempts: 3 });
  });

  it("does not retry a 400", async () => {
    const { fetch, requests } = mockFetch(() => status(400));
    const { meta } = provider(fetch);
    await expect(meta.call(request)).rejects.toMatchObject({
      kind: "request",
      status: 400,
      attempts: 1,
    });
    expect(requests).toHaveLength(1);
  });

  it("keeps the API key out of the error and the call log when the service echoes it", async () => {
    const { fetch } = mockFetch(
      () =>
        new Response(
          JSON.stringify({ error: { message: "Invalid key test-key or LLM_9_abcdefgh" } }),
          {
            status: 401,
            headers: { "content-type": "application/json" },
          },
        ),
    );
    const { meta, log } = provider(fetch);
    const error = (await meta.call(request).catch((e: unknown) => e)) as Error;
    expect(error.message).not.toContain("test-key");
    expect(error.message).not.toContain("LLM_9_abcdefgh");
    expect(error.message).toContain("[key]");
    expect(JSON.stringify(log.entries)).not.toContain("test-key");
    expect(JSON.stringify(log.entries)).not.toContain("LLM_9_abcdefgh");
  });

  it("rejects a body that violates the schema but still records the spend", async () => {
    const { fetch } = mockFetch(() => ok(completion(JSON.stringify({ optionId: 3 }))));
    const { meta, ledger, log } = provider(fetch);
    await expect(meta.call(request)).rejects.toMatchObject({ kind: "invalid_output" });
    expect(await ledger.totalUsd("meta")).toBeCloseTo(expectedCost, 10);
    expect(log.entries[0]).toMatchObject({ ok: false, costUsd: expectedCost });
  });

  it("rejects non-JSON, truncated and empty responses", async () => {
    for (const [body, kind] of [
      [completion("not json"), "invalid_output"],
      [completion('{"optionId":', "length"), "truncated"],
      [completion(null), "refused"],
    ] as const) {
      const { fetch } = mockFetch(() => ok(body));
      await expect(provider(fetch).meta.call(request)).rejects.toMatchObject({ kind });
    }
  });

  it("refuses without a network call once the cap is reached", async () => {
    const { fetch, requests } = mockFetch(() => ok());
    const { meta, ledger, log } = provider(fetch, { spendCapUsd: 0.5 });
    await ledger.add("meta", 0.5);
    const error = await meta.call(request).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(SpendCapError);
    expect(requests).toHaveLength(0);
    expect(log.entries[0]?.error).toMatch(/^spend_cap/);
  });

  it("serves a cache hit without a network call", async () => {
    const { fetch, requests } = mockFetch(() => ok());
    const cache = new MemoryModelCache();
    const { meta, log } = provider(fetch, { cache });
    const first = await meta.call(request);
    const second = await meta.call(request);
    expect(requests).toHaveLength(1);
    expect(second.output).toEqual(first.output);
    expect(second.call).toMatchObject({ cacheHit: true, costUsd: 0, inputTokens: 0 });
    expect(log.entries.map((e) => e.cacheHit)).toEqual([false, true]);
  });

  it("misses the cache when the prompt version changes", async () => {
    const { fetch, requests } = mockFetch(
      () => ok(),
      () => ok(),
    );
    const { meta } = provider(fetch, { cache: new MemoryModelCache() });
    await meta.call(request);
    await meta.call({ ...request, promptVersion: "simulate.v2" });
    expect(requests).toHaveLength(2);
  });
});

describe("chatCostUsd", () => {
  it("prices cached input, uncached input and output", () => {
    // 600 × 1.25 + 400 × 0.15 + 2000 × 4.25 = 750 + 60 + 8500 per million.
    expect(
      chatCostUsd(
        { promptTokens: 1000, completionTokens: 2000, cachedTokens: 400 },
        META_CHAT_PRICE,
      ),
    ).toBeCloseTo(0.00931, 10);
  });

  it("matches the M0.4 probe estimate", () => {
    expect(
      chatCostUsd({ promptTokens: 141, completionTokens: 2095, cachedTokens: 0 }, META_CHAT_PRICE),
    ).toBeCloseTo(0.00908, 5);
  });
});

describe("FileSpendLedger", () => {
  it("keeps a running total per provider across instances and concurrent adds", async () => {
    const path = join(mkdtempSync(join(tmpdir(), "ledger-")), "var", "spend.json");
    const a = new FileSpendLedger(path);
    await Promise.all([a.add("meta", 0.25), a.add("meta", 0.5), a.add("baseten", 1)]);
    const b = new FileSpendLedger(path);
    expect(await b.totalUsd("meta")).toBeCloseTo(0.75, 10);
    expect(await b.totalUsd("baseten")).toBe(1);
    expect(JSON.parse(readFileSync(path, "utf8"))).toMatchObject({ meta: { calls: 2 } });
  });

  it("does not fail when two ledgers write the same file at once", async () => {
    // Two eval runs in separate processes share var/spend.json; a shared temp name made one
    // rename the other's file away (ENOENT). Totals may still race; writes must not throw.
    const path = join(mkdtempSync(join(tmpdir(), "ledger-")), "spend.json");
    const a = new FileSpendLedger(path);
    const b = new FileSpendLedger(path);
    const adds = Array.from({ length: 20 }, (_, i) => (i % 2 ? a : b).add("meta", 0.01));
    await expect(Promise.all(adds)).resolves.toBeDefined();
    expect(readdirSync(dirname(path))).toEqual(["spend.json"]);
  });
});
