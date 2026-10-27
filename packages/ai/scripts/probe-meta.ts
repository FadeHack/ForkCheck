/**
 * Live probe of the Meta chat API: lists models, then makes one strict json_schema call.
 * Usage: LIVE=1 tsx packages/ai/scripts/probe-meta.ts [--out <markdown file to append to>]
 */
import { appendFileSync } from "node:fs";
import OpenAI from "openai";
import { EnvError, loadEnv, loadLocalEnvFile } from "@forkcheck/config";
import { META_BASE_URL, META_CHAT_MODEL } from "../src/models";
import {
  checkModelList,
  checkOutput,
  estimateCostUsd,
  probeJsonSchema,
  probeMessages,
  type Check,
} from "./meta-probe-checks";

loadLocalEnvFile();

let env;
try {
  env = loadEnv(process.env, { require: ["MODEL_API_KEY"] });
} catch (error) {
  if (!(error instanceof EnvError)) throw error;
  console.error(error.message);
  process.exit(1);
}
if (!env.LIVE) {
  console.error("Refusing to call the live API: set LIVE=1.");
  process.exit(1);
}

const outIndex = process.argv.indexOf("--out");
const outFile = outIndex === -1 ? undefined : process.argv[outIndex + 1];

const client = new OpenAI({ baseURL: META_BASE_URL, apiKey: env.MODEL_API_KEY, maxRetries: 0 });
const checks: Check[] = [];
const lines: string[] = [`## Meta chat probe, ${new Date().toISOString()}`, ""];

const modelsStart = performance.now();
const models = await client.models.list();
const ids = models.data.map((m) => m.id).sort();
checks.push(checkModelList(ids));
lines.push(`- \`GET /models\`: ${Math.round(performance.now() - modelsStart)} ms`);
lines.push(`- Models: ${ids.map((id) => `\`${id}\``).join(", ")}`);

const chatStart = performance.now();
const { data: completion, response } = await client.chat.completions
  .create({
    model: META_CHAT_MODEL,
    reasoning_effort: "medium",
    messages: probeMessages,
    response_format: {
      type: "json_schema",
      json_schema: { name: "ProbeDecision", schema: probeJsonSchema, strict: true },
    },
  })
  .withResponse();
const chatMs = Math.round(performance.now() - chatStart);

const choice = completion.choices[0];
checks.push(...checkOutput(choice?.message.content, choice?.finish_reason ?? "missing"));

const usage = completion.usage;
const rateLimits = [...response.headers.entries()]
  .filter(([name]) => name.startsWith("x-ratelimit-"))
  .map(([name, value]) => `${name}=${value}`);

lines.push(
  `- \`POST /chat/completions\`: HTTP ${response.status}, ${chatMs} ms, model \`${completion.model}\``,
);
if (usage) {
  const reasoning = usage.completion_tokens_details?.reasoning_tokens;
  const cached = usage.prompt_tokens_details?.cached_tokens;
  lines.push(
    `- Usage: prompt ${usage.prompt_tokens}, completion ${usage.completion_tokens}` +
      `, reasoning ${reasoning ?? "not reported"}, cached ${cached ?? "not reported"}` +
      `, est. $${estimateCostUsd({ ...usage, cached_tokens: cached }).toFixed(5)}`,
  );
} else {
  lines.push("- Usage: not reported");
}
lines.push(`- Rate-limit headers: ${rateLimits.length ? rateLimits.join(", ") : "none"}`);
lines.push(`- Output: \`${choice?.message.content ?? ""}\``);
lines.push("", "| Check | Result | Detail |", "|---|---|---|");
for (const c of checks) lines.push(`| ${c.name} | ${c.ok ? "pass" : "FAIL"} | ${c.detail} |`);

const report = lines.join("\n") + "\n";
console.log(report);
if (outFile) appendFileSync(outFile, "\n" + report);

if (checks.some((c) => !c.ok)) process.exitCode = 1;
