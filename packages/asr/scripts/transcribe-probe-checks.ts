import { transcribeResponse, transcribeTurn, type TranscribeResponse } from "../src/transcribe";

export interface ScriptLine {
  speaker: string;
  voice: string;
  text: string;
}

export const probeScript: readonly ScriptLine[] = [
  {
    speaker: "Priya",
    voice: "Samantha",
    text: "Morning Marco. Let's lock the plan for the pricing page.",
  },
  {
    speaker: "Marco",
    voice: "Daniel",
    text: "Sure. I can have the new copy ready by Thursday afternoon.",
  },
  {
    speaker: "Priya",
    voice: "Samantha",
    text: "Great. Then we ship on Friday, after the legal review.",
  },
  {
    speaker: "Marco",
    voice: "Daniel",
    text: "Who is booking the legal review? I assumed you were.",
  },
  { speaker: "Priya", voice: "Samantha", text: "I'll book it today and send you the invite." },
  {
    speaker: "Marco",
    voice: "Daniel",
    text: "Perfect. And done means the page is live, not just merged.",
  },
];

export interface Check {
  name: string;
  ok: boolean;
  detail: string;
}

const words = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9' ]+/g, " ")
    .split(/\s+/)
    .filter(Boolean);

/** Share of script words found in the transcript, counting repeats (bag-of-words recall). */
export function wordRecall(script: string, transcript: string): number {
  const expected = words(script);
  const available = new Map<string, number>();
  for (const w of words(transcript)) available.set(w, (available.get(w) ?? 0) + 1);
  let found = 0;
  for (const w of expected) {
    const n = available.get(w) ?? 0;
    if (n > 0) {
      found += 1;
      available.set(w, n - 1);
    }
  }
  return expected.length === 0 ? 1 : found / expected.length;
}

export interface ShapeReport {
  checks: Check[];
  response?: TranscribeResponse;
  extraKeys: string[];
}

export function checkResponse(body: unknown, expectedDurationMs: number): ShapeReport {
  const parsed = transcribeResponse.safeParse(body);
  if (!parsed.success) {
    const detail = parsed.error.issues
      .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("; ");
    return { checks: [{ name: "response schema (R§4.1)", ok: false, detail }], extraKeys: [] };
  }
  const response = parsed.data;
  const known = new Set(Object.keys(transcribeResponse.shape));
  const knownTurn = new Set(Object.keys(transcribeTurn.shape));
  const extraKeys = [
    ...Object.keys(response).filter((k) => !known.has(k)),
    ...new Set(
      response.turns.flatMap((t) =>
        Object.keys(t)
          .filter((k) => !knownTurn.has(k))
          .map((k) => `turns[].${k}`),
      ),
    ),
  ];

  const speakers = new Set(response.turns.map((t) => t.speaker).filter((s) => s !== undefined));
  const recall = wordRecall(probeScript.map((l) => l.text).join(" "), response.transcript);
  const durationGap = Math.abs(response.audioDurationMs - expectedDurationMs);

  return {
    response,
    extraKeys,
    checks: [
      { name: "response schema (R§4.1)", ok: true, detail: "ok" },
      {
        name: "distinct speaker labels ≥ 2",
        ok: speakers.size >= 2,
        detail: `${speakers.size}: ${[...speakers].join(", ") || "none"}`,
      },
      {
        name: "every turn has a speaker",
        ok: response.turns.every((t) => t.speaker !== undefined),
        detail: `${response.turns.filter((t) => t.speaker !== undefined).length}/${response.turns.length}`,
      },
      {
        name: "word recall ≥ 0.8",
        ok: recall >= 0.8,
        detail: recall.toFixed(3),
      },
      {
        name: "audioDurationMs within 1 s of the file",
        ok: durationGap <= 1000,
        detail: `${response.audioDurationMs} vs ${expectedDurationMs}`,
      },
    ],
  };
}
