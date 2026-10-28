import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { transcribeResponse, type TranscribeResponse } from "@forkcheck/asr";
import { audioTruth, parseScenario, type AudioTruth, type Scenario } from "../src/index";
import { liveTranscriber } from "./live";

const workspace = resolve(import.meta.dirname, "../../..");

/** Every scenario under scenarios/, by id. */
export function loadScenarios(): Map<string, Scenario> {
  const walk = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
      e.isDirectory()
        ? walk(join(dir, e.name))
        : e.name.endsWith(".json")
          ? [join(dir, e.name)]
          : [],
    );
  const scenarios = new Map<string, Scenario>();
  for (const file of walk(join(workspace, "scenarios"))) {
    try {
      const s = parseScenario(readFileSync(file, "utf8"));
      scenarios.set(s.id, s);
    } catch {
      // Not a scenario file (fixtures, samples in another format).
    }
  }
  return scenarios;
}

export interface AudioInput {
  name: string;
  truth: AudioTruth;
  scenario: Scenario;
  response: TranscribeResponse;
  /** Live transcription cost; 0 when the response came from the cache. */
  costUsd: number;
}

let client: ReturnType<typeof liveTranscriber> | undefined;

/**
 * A rendered WAV with its sibling truth file and scenario. The response is read from
 * var/audio/asr/<name>.json if present; otherwise the WAV is transcribed (LIVE=1) and cached.
 */
export async function loadAudioInput(
  wavPath: string,
  scenarios: Map<string, Scenario>,
): Promise<AudioInput> {
  const name = basename(wavPath, ".wav");
  const truth = audioTruth.parse(
    JSON.parse(readFileSync(join(dirname(wavPath), `${name}.truth.json`), "utf8")),
  );
  const scenario = scenarios.get(truth.scenarioId);
  if (!scenario) throw new Error(`no scenario with id ${truth.scenarioId}`);

  const cacheDir = join(workspace, "var", "audio", "asr");
  const cached = join(cacheDir, `${name}.json`);
  if (existsSync(cached)) {
    const response = transcribeResponse.parse(JSON.parse(readFileSync(cached, "utf8")));
    return { name, truth, scenario, response, costUsd: 0 };
  }
  client ??= liveTranscriber();
  const result = await client.transcribe(readFileSync(wavPath), {
    keywords: scenario.participants,
  });
  mkdirSync(cacheDir, { recursive: true });
  writeFileSync(cached, JSON.stringify(result.response, null, 2) + "\n");
  console.error(`transcribed ${name}: ${result.latencyMs} ms, $${result.costUsd.toFixed(5)}`);
  return { name, truth, scenario, response: result.response, costUsd: result.costUsd };
}
