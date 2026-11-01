import { readFileSync } from "node:fs";
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import type {
  OrganizerMeetingState,
  ParticipantProbe,
  ParticipantState,
  ProposeResolutionResponse,
  RecordResponse,
} from "../src/contracts/api";
import { closeRound } from "./seed";

/**
 * The demo meeting, "Atlas launch sync", from paste to record, once with precise resolutions
 * and once with vague ones. The app's own server answers every model call: from recorded
 * fixtures by default, or live with LIVE=1 (RECORD_FIXTURES=1 saves them for replay).
 */
const LIVE = process.env.LIVE === "1";
const MODEL_WAIT = { timeout: LIVE ? 5 * 60_000 : 30_000 };

interface Demo {
  title: string;
  participants: string[];
  transcript: string;
  scriptedResolutions: {
    mismatch: string;
    precise: { text: string };
    vague: { text: string };
  }[];
}
const demo = JSON.parse(
  readFileSync(new URL("../../../scenarios/demo/atlas-launch.json", import.meta.url), "utf8"),
) as Demo;

type Person = "Nadia" | "Tomas" | "June";

type Topic = "launch" | "owner";
const live = /\bis (available|accessible)\b/i;
const notLive = /\b(unavailable|not yet accessible|not yet available)\b/i;

/**
 * Each person's private brief, as the option they pick: first on the planted questions, then on
 * the recheck after a vague resolution, which leaves everyone with their own reading.
 */
const reads: Record<Person, Record<Topic, RegExp> & { recheck: Record<Topic, RegExp> }> = {
  Nadia: {
    launch: /friday the 13th/i,
    owner: /^June/,
    recheck: { launch: notLive, owner: /^June/ },
  },
  // Monday the 16th isn't offered; Friday is the nearest to it.
  Tomas: {
    launch: /friday the 13th/i,
    owner: /^June/,
    recheck: { launch: notLive, owner: /^June/ },
  },
  June: {
    launch: /thursday the 12th/i,
    owner: /^Tomas/,
    recheck: { launch: live, owner: /^Tomas/ },
  },
};
/** After a precise resolution everyone reads the recheck the same way. */
const settled: Record<Topic, RegExp> = { launch: live, owner: /^June/ };

/**
 * Which planted mismatch a question is about, from its wording. The model may draft more
 * questions than the two planted ones; nobody's brief covers those, so everyone agrees.
 */
function topic(probe: Pick<ParticipantProbe, "stem">): Topic | null {
  if (/out to every customer", what has to exist/i.test(probe.stem)) return "launch";
  if (/help center page/i.test(probe.stem) && /who does it/i.test(probe.stem)) return "owner";
  return null;
}

/**
 * The one option matching the reading. With none, the option with the lowest ID: each person
 * sees the options in their own order, so "the first one shown" would differ.
 */
function choose(probe: ParticipantProbe, reading: RegExp | null) {
  if (reading === null) return [...probe.options].sort((a, b) => (a.id < b.id ? -1 : 1))[0]!;
  const hits = probe.options.filter((o) => reading.test(o.text));
  expect(hits, `one option of "${probe.stem}" matching ${reading}`).toHaveLength(1);
  return hits[0]!;
}

async function answerAll(
  request: APIRequestContext,
  token: string,
  pick: (probe: ParticipantProbe) => RegExp | null,
) {
  const { openProbes } = (await (await request.get(`/api/p/${token}`)).json()) as ParticipantState;
  expect(openProbes.length).toBeGreaterThan(0);
  for (const probe of openProbes) {
    const option = choose(probe, pick(probe));
    const sent = await request.post(`/api/p/${token}/answers`, {
      data: { probeId: probe.id, choice: "option", optionId: option.id },
    });
    expect(sent.ok()).toBe(true);
  }
}

async function createFromPaste(page: Page) {
  await page.goto("/");
  await page.getByLabel("Meeting title").fill(demo.title);
  await page.getByLabel("Meeting date and time").fill("2026-11-03T10:00");
  await page.getByLabel("Time zone").fill("America/New_York");
  await page.getByLabel("Participant names, one per line").fill(demo.participants.join("\n"));
  await page.getByLabel("Transcript", { exact: true }).fill(demo.transcript);
  await page.getByLabel(/Everyone in this meeting agreed/).check();
  await page.getByRole("button", { name: "Create meeting check" }).click();
  await expect(page.getByRole("heading", { name: "Meeting check created" })).toBeVisible();

  // Links are listed in the order the names were entered.
  const links = page.getByRole("listitem").filter({ hasText: "/p/" }).getByRole("link");
  const hrefs = await links.evaluateAll((as) => as.map((a) => a.getAttribute("href")!));
  const tokens = new Map(
    (demo.participants as Person[]).map((name, i) => [name, hrefs[i]!.split("/p/")[1]!]),
  );
  const href = await page
    .getByRole("listitem")
    .filter({ hasText: "/m/" })
    .getByRole("link")
    .getAttribute("href");
  const id = new URL(href!, "http://x").pathname.split("/").at(-1)!;
  const token = new URLSearchParams(new URL(href!, "http://x").hash.slice(1)).get("k")!;
  return { id, token, href: href!, tokens };
}

test.skip(({ isMobile }) => isMobile, "The demo runs on one device");

for (const path of ["precise", "vague"] as const) {
  test(`Atlas launch sync, ${path} resolutions`, async ({ page, request }) => {
    test.setTimeout(LIVE ? 20 * 60_000 : 120_000);
    const m = await createFromPaste(page);
    const headers = { authorization: `Bearer ${m.token}` };
    const tok = (who: Person) => m.tokens.get(who)!;

    await page.goto(m.href);
    await page.getByRole("button", { name: "Draft questions" }).click();
    const publish = page.getByRole("button", { name: /^Publish \d+ questions?$/ });
    await expect(publish).toBeVisible(MODEL_WAIT);
    // Five questions fit in a round. The organizer swaps the screenshots question, which
    // nobody disagrees on, for the one asking who writes the help center page.
    const draft = (stem: RegExp) =>
      page.locator(".draft-list > li").filter({ hasText: stem }).getByLabel("Send this question");
    await draft(/Final screenshots/).uncheck();
    await draft(/help center page.*who does it/).check();
    await expect(publish).toHaveText("Publish 5 questions");
    await publish.click();
    await expect(page.getByRole("button", { name: "Reveal answers" })).toBeVisible();

    // Each person answers from their own brief, on their own device; here through their API.
    for (const who of ["Nadia", "Tomas", "June"] as const) {
      await answerAll(request, tok(who), (p) => {
        const t = topic(p);
        return t === null ? null : reads[who][t];
      });
    }
    await closeRound(request, m.id, m.token);

    // Both planted mismatches split; nothing the group agreed on does.
    const { revealed } = (await (
      await request.get(`/api/p/${tok("Nadia")}`)
    ).json()) as ParticipantState;
    const splits = revealed.filter((r) => r.split.outcome === "split");
    const topics = splits.map((r) => topic(r.probe)).sort();
    expect(topics).toEqual(["launch", "owner"]);

    for (const r of splits) {
      const mismatch = topic(r.probe) === "launch" ? 0 : 1;
      const text = demo.scriptedResolutions[mismatch]![path].text;
      const proposed = (await (
        await request.post(`/api/p/${tok("Nadia")}/resolutions`, {
          data: { splitId: r.split.id, text },
        })
      ).json()) as ProposeResolutionResponse;
      for (const who of ["Nadia", "Tomas", "June"] as const) {
        const ok = await request.post(`/api/p/${tok(who)}/resolutions/${proposed.id}/confirm`);
        expect(ok.ok()).toBe(true);
      }

      // The recheck asks about a consequence: precise wording leaves one reading, vague wording
      // leaves each person with their own.
      const sent = await request.post(`/api/splits/${r.split.id}/recheck`, {
        headers,
        timeout: MODEL_WAIT.timeout,
      });
      expect(sent.ok()).toBe(true);
      for (const who of ["Nadia", "Tomas", "June"] as const) {
        await answerAll(request, tok(who), () => {
          const t = mismatch === 0 ? "launch" : "owner";
          return path === "precise" ? settled[t] : reads[who].recheck[t];
        });
      }
      await closeRound(request, m.id, m.token);
    }

    const state = (await (
      await request.get(`/api/meetings/${m.id}`, { headers })
    ).json()) as OrganizerMeetingState;
    expect(state.rounds.every((r) => r.closedAt !== null)).toBe(true);

    await page.goto(`/m/${m.id}/record`);
    await expect(page.getByText("Every item passed the record checks.")).toBeVisible(MODEL_WAIT);
    const res = await request.get(`/api/meetings/${m.id}/record`, { headers });
    const { record } = (await res.json()) as RecordResponse;
    const confirmed = record.items.filter((i) => i.category === "confirmed").map((i) => i.text);
    if (path === "precise") {
      for (const r of demo.scriptedResolutions) expect(confirmed).toContain(r.precise.text);
    } else {
      expect(confirmed).toEqual([]);
    }
    if (LIVE) console.log(record.items.map((i) => `  [${i.category}] ${i.text}`).join("\n"));
  });
}
