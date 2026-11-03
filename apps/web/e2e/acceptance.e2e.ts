import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { expect, test, type Page } from "@playwright/test";
import type {
  OrganizerMeetingState,
  ParticipantState,
  ProposeResolutionResponse,
  RecordResponse,
} from "../src/contracts/api";
import { noAxeViolations } from "./axe";
import { analyzeWithScript, closeRound } from "./seed";

/**
 * M6.6: a 5-minute recording of a three-person meeting, from upload through speaker mapping,
 * review, one question round and a resolution, to a record that passes its checks.
 *
 * By default the transcription is replayed from packages/asr/fixtures/replay and the analysis
 * replies are scripted. With LIVE=1 (and a dev server started with LIVE=1) both are real, the
 * test allows for their latency, and it prints how long each organizer step took.
 */
const LIVE = process.env.LIVE === "1";
const fixtures = join(import.meta.dirname, "fixtures");
const run = promisify(execFile);

/** Who says each line of the script, so voices can be matched by their words. */
async function scriptLines(): Promise<{ who: string; words: Set<string> }[]> {
  const text = await readFile(join(fixtures, "pilot-meeting.txt"), "utf8");
  return text
    .split("\n")
    .filter((l) => l.includes(": "))
    .map((l) => {
      const [who, said] = [l.slice(0, l.indexOf(": ")), l.slice(l.indexOf(": ") + 2)];
      return { who, words: new Set(said.toLowerCase().match(/[a-z']+/g) ?? []) };
    });
}

/** The person whose script lines share the most words with what a voice said. */
function likeliest(said: string, lines: { who: string; words: Set<string> }[]): string {
  const words = said.toLowerCase().match(/[a-z']+/g) ?? [];
  const score = new Map<string, number>();
  for (const line of lines) {
    const overlap = words.filter((w) => line.words.has(w)).length / Math.max(line.words.size, 1);
    score.set(line.who, Math.max(score.get(line.who) ?? 0, overlap));
  }
  return [...score.entries()].sort((a, b) => b[1] - a[1])[0]![0];
}

/**
 * Who said one turn, if a single script line clearly matches it: most of the line's words and
 * most of the turn's. Short replies like "Agreed." match several lines and are left alone.
 */
function speakerOfTurn(said: string, lines: { who: string; words: Set<string> }[]) {
  const words = new Set(said.toLowerCase().match(/[a-z']+/g) ?? []);
  if (words.size < 4) return null;
  const fit = (line: { words: Set<string> }) => {
    const shared = [...words].filter((w) => line.words.has(w)).length;
    return Math.min(shared / words.size, shared / line.words.size);
  };
  const best = [...lines].sort((a, b) => fit(b) - fit(a))[0]!;
  return fit(best) >= 0.6 ? best.who : null;
}

const timings: [string, number][] = [];
let fixedTurns = 0;
async function timed<T>(step: string, fn: () => Promise<T>): Promise<T> {
  const start = Date.now();
  const result = await fn();
  timings.push([step, Date.now() - start]);
  return result;
}

async function organizerState(page: Page, id: string, token: string) {
  const res = await page.request.get(`/api/meetings/${id}`, {
    headers: { authorization: `Bearer ${token}` },
  });
  return (await res.json()) as OrganizerMeetingState;
}

test.skip(({ isMobile }) => isMobile, "One device is enough for the timed flow");

test("a 5-minute recording becomes a checked record", async ({ page, request }) => {
  test.setTimeout(LIVE ? 15 * 60_000 : 120_000);
  const work = await mkdtemp(join(tmpdir(), "forkcheck-acceptance-"));
  const wav = join(work, "pilot-meeting.wav");
  // FLAC decodes to the same samples everywhere, so the replayed transcription's key matches.
  await run("ffmpeg", [
    "-nostdin",
    "-loglevel",
    "error",
    "-i",
    join(fixtures, "pilot-meeting.flac"),
    "-c:a",
    "pcm_s16le",
    "-f",
    "wav",
    wav,
  ]);

  try {
    await timed("Create and upload", async () => {
      await page.goto("/new");
      await page.getByLabel("Meeting title").fill("Northwind pilot launch check-in");
      await page.getByLabel("Meeting date and time").fill("2026-10-26T15:00");
      await page.getByLabel("Time zone").fill("America/New_York");
      await page.getByLabel("Participant names, one per line").fill("Priya\nMarco\nDana");
      await page.getByRole("radio", { name: "Upload a recording" }).check();
      await page.getByLabel("Recording", { exact: true }).setInputFiles(wav);
      await page.getByLabel(/Everyone in this recording agreed/).check();
      await page.getByRole("button", { name: "Create meeting check" }).click();
      await expect(page.getByRole("heading", { name: "Meeting check created" })).toBeVisible({
        timeout: 60_000,
      });
    });
    const links = page.getByRole("listitem").filter({ hasText: "/p/" }).getByRole("link");
    const participantTokens = (await links.evaluateAll((as) =>
      as.map((a) => a.getAttribute("href")!.split("/p/")[1]!),
    )) as string[];
    const href = await page
      .getByRole("listitem")
      .filter({ hasText: "/m/" })
      .getByRole("link")
      .getAttribute("href");
    await page.goto(href!);
    const id = new URL(page.url()).pathname.split("/").at(-1)!;
    // The organizer key travels in the link's fragment; the page stores it only once it runs.
    const token = new URLSearchParams(new URL(href!, "http://x").hash.slice(1)).get("k")!;

    await timed("Wait for transcription", async () => {
      await expect(page.getByRole("button", { name: "Save speakers" })).toBeVisible({
        timeout: LIVE ? 10 * 60_000 : 30_000,
      });
    });

    await timed("Map speakers", async () => {
      const lines = await scriptLines();
      const { segments } = await organizerState(page, id, token);
      const labels = [
        ...new Set(segments.flatMap((s) => (s.speakerLabel ? [s.speakerLabel] : []))),
      ];
      for (const label of labels) {
        const said = segments
          .filter((s) => s.speakerLabel === label)
          .map((s) => s.text)
          .join(" ");
        await page
          .getByLabel(`Who is Speaker ${label}?`)
          .selectOption({ label: likeliest(said, lines) });
      }
      await page.getByRole("button", { name: "Save speakers" }).click();
      await expect(page.getByRole("heading", { name: "Transcript review" })).toBeVisible();
    });
    await noAxeViolations(page);

    await timed("Fix misattributed turns", async () => {
      // Diarization can give one voice to two people; review fixes those turns one by one.
      const lines = await scriptLines();
      const { segments, participants } = await organizerState(page, id, token);
      const turns = page.locator(".turns > li");
      for (const [i, segment] of segments.entries()) {
        const who = speakerOfTurn(segment.text, lines);
        const now = participants.find((p) => p.id === segment.participantId)?.displayName;
        if (who === null || who === now) continue;
        const turn = turns.nth(i);
        await turn.getByRole("button", { name: "Edit turn" }).click();
        await turn.getByLabel("Who said it").selectOption({ label: who });
        await turn.getByRole("button", { name: "Save turn" }).click();
        await expect(turn.locator(".turn-speaker")).toContainText(who);
        fixedTurns++;
      }
    });

    await timed("Review and finish", async () => {
      // Keep the recording, so the record's quotes can be played back.
      await page.getByLabel(/Keep the recording/).check();
      if (!LIVE) {
        await page.route("**/analyze", async (route) =>
          route.fulfill({ json: await analyzeWithScript(id) }),
        );
      }
      await page.getByRole("button", { name: "Finish review" }).click();
      await expect(page.getByRole("heading", { name: "Decisions found" })).toBeVisible({
        timeout: LIVE ? 5 * 60_000 : 30_000,
      });
    });

    await timed("Publish questions", async () => {
      const publish = page.getByRole("button", { name: /^Publish \d+ questions?$/ });
      await publish.click();
      await expect(page.getByRole("button", { name: "Reveal answers" })).toBeVisible();
    });

    // Participants answer on their own devices; here through their API. Priya and Marco
    // read the first question differently, so it splits; everyone agrees on the rest.
    const [priya, marco, dana] = participantTokens;
    for (const [who, first] of [
      [priya!, 0],
      [marco!, 1],
      [dana!, 0],
    ] as const) {
      const { openProbes } = (await (
        await request.get(`/api/p/${who}`)
      ).json()) as ParticipantState;
      for (const [i, probe] of openProbes.entries()) {
        const option = probe.options[i === 0 ? first : 0]!;
        const sent = await request.post(`/api/p/${who}/answers`, {
          data: { probeId: probe.id, choice: "option", optionId: option.id },
        });
        expect(sent.ok()).toBe(true);
      }
    }
    await timed("Reveal answers", async () => {
      await closeRound(request, id, token);
    });

    const state = (await (await request.get(`/api/p/${priya}`)).json()) as ParticipantState;
    const split = state.revealed.find((r) => r.split.outcome === "split")!.split;
    const proposed = (await (
      await request.post(`/api/p/${priya}/resolutions`, {
        data: { splitId: split.id, text: "Single sign-on runs in production on Friday." },
      })
    ).json()) as ProposeResolutionResponse;
    for (const who of [priya!, marco!, dana!]) {
      expect((await request.post(`/api/p/${who}/resolutions/${proposed.id}/confirm`)).ok()).toBe(
        true,
      );
    }

    await timed("Open the record", async () => {
      await page.goto(`/m/${id}/record`);
      await expect(page.getByText("Every item passed the record checks.")).toBeVisible();
    });
    const record = page.locator("article.record");
    await expect(record).toContainText("Single sign-on runs in production on Friday.");
    await expect(record).toContainText("From automatic transcription");
    // The recording was kept, so the organizer can play the quotes.
    await expect(
      record.getByRole("button", { name: /^Play from \d\d:\d\d$/ }).first(),
    ).toBeVisible();
    await noAxeViolations(page);

    if (LIVE) {
      // A live record can't be asserted word for word, so it is printed for the PR.
      const res = await request.get(`/api/meetings/${id}/record`, {
        headers: { authorization: `Bearer ${token}` },
      });
      const { record: built } = (await res.json()) as RecordResponse;
      console.log(built.items.map((i) => `  [${i.category}] ${i.text}`).join("\n"));
    }
    const total = timings.reduce((sum, [, ms]) => sum + ms, 0);
    console.log(
      [
        `M6.6 ${LIVE ? "live" : "replayed"} run`,
        ...timings.map(([step, ms]) => `  ${step}: ${(ms / 1000).toFixed(1)} s`),
        `  Total: ${(total / 1000).toFixed(1)} s`,
        `  Turns reassigned in review: ${fixedTurns}`,
      ].join("\n"),
    );
  } finally {
    await rm(work, { recursive: true, force: true });
  }
});
