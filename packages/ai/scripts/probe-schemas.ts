/**
 * Live check that Meta strict mode accepts every stage schema (R§12 item 11): one minimal call each.
 * Usage: LIVE=1 tsx packages/ai/scripts/probe-schemas.ts [--out <markdown file to append to>]
 */
import { appendFileSync } from "node:fs";
import OpenAI from "openai";
import { EnvError, loadEnv, loadLocalEnvFile } from "@forkcheck/config";
import { META_BASE_URL, META_CHAT_MODEL } from "../src/models";
import { stageNames } from "../src/port";
import { responseFormatName, stageJsonSchema, stageSchemas } from "../src/schemas/index";
import { estimateCostUsd } from "./meta-probe-checks";

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
const messages = [
  {
    role: "developer" as const,
    content: "Fill the response schema with a short, minimal example based on the excerpt.",
  },
  {
    role: "user" as const,
    content: "[s1] Priya: So SSO is ready by Friday. Marco, that's yours?\n[s2] Marco: Yep.",
  },
];

const lines = [
  `## Meta strict-schema probe, ${new Date().toISOString()}`,
  "",
  `Model \`${META_CHAT_MODEL}\`, \`reasoning_effort: low\`, \`max_completion_tokens: 1500\`.`,
  "",
  "| Stage schema | Accepted | HTTP | ms | Finish | Zod parse | Tokens (prompt/completion/reasoning) | Est. $ |",
  "|---|---|---|---|---|---|---|---|",
];
let total = 0;
let rejected = 0;

for (const stage of stageNames) {
  const name = responseFormatName(stage);
  const start = performance.now();
  try {
    const { data, response } = await client.chat.completions
      .create({
        model: META_CHAT_MODEL,
        reasoning_effort: "low",
        max_completion_tokens: 1500,
        messages,
        response_format: {
          type: "json_schema",
          json_schema: { name, schema: stageJsonSchema(stage), strict: true },
        },
      })
      .withResponse();
    const ms = Math.round(performance.now() - start);
    const choice = data.choices[0];
    let parsed = "no content";
    try {
      parsed = stageSchemas[stage].safeParse(JSON.parse(choice?.message.content ?? "")).success
        ? "ok"
        : "FAIL";
    } catch {
      parsed = "not JSON";
    }
    const usage = data.usage;
    const cost = usage
      ? estimateCostUsd({
          ...usage,
          cached_tokens: usage.prompt_tokens_details?.cached_tokens,
        })
      : 0;
    total += cost;
    const tokens = usage
      ? `${usage.prompt_tokens}/${usage.completion_tokens}/${usage.completion_tokens_details?.reasoning_tokens ?? "?"}`
      : "not reported";
    lines.push(
      `| \`${name}\` | yes | ${response.status} | ${ms} | ${choice?.finish_reason ?? "missing"} | ${parsed} | ${tokens} | ${cost.toFixed(5)} |`,
    );
  } catch (error) {
    if (!(error instanceof OpenAI.APIError)) throw error;
    rejected++;
    const message = error.message.replaceAll("|", "\\|").replaceAll("\n", " ");
    lines.push(`| \`${name}\` | NO: ${message} | ${error.status ?? "?"} | | | | | |`);
  }
}

lines.push(
  "",
  `${stageNames.length - rejected} of ${stageNames.length} accepted; est. total $${total.toFixed(4)}.`,
);
const report = lines.join("\n") + "\n";
console.log(report);
if (outFile) appendFileSync(outFile, "\n" + report);

if (rejected) process.exitCode = 1;
