import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import type {
  CreateMeetingResponse,
  ParticipantState,
  ProposeResolutionResponse,
} from "../src/contracts/api";
import { noAxeViolations } from "./axe";
import { answerOpen, closeRound, openRound, seedAnalyzedMeeting } from "./seed";

const where = "Where does single sign-on run on Friday?";
const same = "Designs or a mock-up";
const WIDTHS = [320, 768, 1280];

/** Controls that must be at least 44 px tall. Links inside running text are exempt. */
const TARGETS =
  'button, select, summary, textarea, input:not([type="radio"]):not([type="checkbox"]), .choice, .record-sources a';

async function smallTargets(page: Page): Promise<string[]> {
  return page.evaluate((selector) => {
    return [...document.querySelectorAll<HTMLElement>(selector)]
      .filter((el) => el.offsetParent !== null && !el.closest("nextjs-portal"))
      .filter((el) => el.getBoundingClientRect().height < 43.5)
      .map((el) => `${el.tagName.toLowerCase()} "${el.textContent?.trim().slice(0, 30)}"`);
  }, TARGETS);
}

/** Tabs through the page; every stop must show a solid ring at least 2 px wide. */
async function focusStops(page: Page): Promise<{ seen: string[]; bad: string[] }> {
  const seen: string[] = [];
  const bad: string[] = [];
  // Focusing the body moves the tab starting point back to the top of the page, wherever the
  // previous pass ended.
  await page.evaluate(() => {
    document.body.tabIndex = -1;
    document.body.focus();
    document.body.removeAttribute("tabindex");
  });
  for (let i = 0; i < 80; i++) {
    await page.keyboard.press("Tab");
    const stop = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      // The dev server's tools overlay sits after the page in tab order; it isn't ours.
      if (!el || el === document.body || el.tagName === "NEXTJS-PORTAL") return null;
      const s = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      return {
        name: `${el.tagName.toLowerCase()} ${(el.getAttribute("aria-label") || el.textContent || "").trim().slice(0, 30)} @${Math.round(r.top + window.scrollY)}`,
        ok: s.outlineStyle === "solid" && parseFloat(s.outlineWidth) >= 2,
      };
    });
    if (stop === null || stop.name === seen[0]) break;
    if (stop.name === seen.at(-1)) continue;
    seen.push(stop.name);
    if (!stop.ok) bad.push(stop.name);
  }
  return { seen, bad };
}

/** Waits until the page has loaded its data: a heading or an error is showing. */
async function settled(page: Page) {
  await expect(page.locator(".loading")).toHaveCount(0, { timeout: 10_000 });
  await expect(page.locator("h1, .notice-error").first()).toBeVisible();
}

/** Tab stops per page, printed with the run as evidence for the gate report. */
const stopCounts: string[] = [];

async function check(page: Page, url: string, label: string) {
  for (const theme of ["light", "dark"] as const) {
    // Set before loading, so color checks never run halfway through a transition.
    await page.emulateMedia({ colorScheme: theme });
    await page.setViewportSize({ width: WIDTHS[0]!, height: 800 });
    await page.goto(url);
    await settled(page);
    for (const width of WIDTHS) {
      await test.step(`${label}, ${theme}, ${width}px`, async () => {
        await page.setViewportSize({ width, height: 800 });
        const overflow = await page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        );
        expect(overflow, "page scrolls sideways").toBe(0);
        expect(await smallTargets(page), "targets under 44 px").toEqual([]);
        const stops = await focusStops(page);
        // Every page has at least the wordmark and the theme control to tab to.
        expect(stops.seen.length).toBeGreaterThanOrEqual(2);
        expect(stops.bad, "focus stops without a ring").toEqual([]);
        stopCounts.push(`${label} ${theme} ${width}: ${stops.seen.length}`);
        // Tabbing leaves color transitions running; axe must read the settled colors.
        await page.evaluate(async () => {
          (document.activeElement as HTMLElement | null)?.blur();
          await Promise.all(document.getAnimations().map((a) => a.finished));
        });
        await noAxeViolations(page);
      });
    }
  }
}

async function split(request: APIRequestContext, m: CreateMeetingResponse) {
  const [priya, marco] = m.participantLinks;
  await openRound(request, m.meetingId, m.organizerToken);
  await answerOpen(request, priya!.token, (s) => (s === where ? "In production" : same));
  await answerOpen(request, marco!.token, (s) => (s === where ? "On staging only" : same));
  await closeRound(request, m.meetingId, m.organizerToken);
  const state = (await (await request.get(`/api/p/${priya!.token}`)).json()) as ParticipantState;
  return state.revealed.find((r) => r.probe.stem === where)!.split.id;
}

test("every route passes the accessibility, overflow, target and focus checks", async ({
  page,
  request,
  baseURL,
}, info) => {
  // Widths are set per step, so the phone project would only repeat this run.
  test.skip(info.project.name !== "desktop", "runs its own widths");
  test.setTimeout(600_000);
  const errors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });

  // Drafted questions: the organizer reviews; participants haven't been sent anything.
  const drafted = await seedAnalyzedMeeting(baseURL!);
  // An open round: Priya has answered and waits; Marco still has questions to answer.
  const open = await seedAnalyzedMeeting(baseURL!);
  await openRound(request, open.meetingId, open.organizerToken);
  await answerOpen(request, open.participantLinks[0]!.token, (s) =>
    s === where ? "In production" : same,
  );
  // Revealed with a difference to settle.
  const revealed = await seedAnalyzedMeeting(baseURL!);
  await split(request, revealed);
  // Confirmed wording waiting for a recheck; Dana marked absent.
  const confirmed = await seedAnalyzedMeeting(baseURL!);
  const splitId = await split(request, confirmed);
  const [cp, cm, cd] = confirmed.participantLinks;
  const proposed = (await (
    await request.post(`/api/p/${cp!.token}/resolutions`, {
      data: { splitId, text: "Single sign-on runs on staging on Friday." },
    })
  ).json()) as ProposeResolutionResponse;
  for (const who of [cp!, cm!]) {
    await request.post(`/api/p/${who.token}/resolutions/${proposed.id}/confirm`);
  }
  await request.patch(`/api/meetings/${confirmed.meetingId}/participants/${cd!.participantId}`, {
    headers: { authorization: `Bearer ${confirmed.organizerToken}` },
    data: { status: "absent" },
  });
  // Left open by agreement, so the meeting check reaches its record.
  const done = await seedAnalyzedMeeting(baseURL!);
  const doneSplit = await split(request, done);
  expect(
    (
      await request.post(`/api/p/${done.participantLinks[0]!.token}/splits/${doneSplit}/unresolved`)
    ).ok(),
  ).toBe(true);

  const org = (m: CreateMeetingResponse) => `/m/${m.meetingId}#k=${m.organizerToken}`;
  const p = (m: CreateMeetingResponse, i = 0) => `/p/${m.participantLinks[i]!.token}`;

  await check(page, "/", "start");
  await check(page, org(drafted), "organizer: questions");
  await check(page, org(open), "organizer: round");
  await check(page, org(revealed), "organizer: reveal");
  await check(page, org(confirmed), "organizer: recheck");
  await check(page, org(done), "organizer: record stage");
  // The record reads the organizer key this tab stored when the workspace opened.
  await check(page, `/m/${done.meetingId}/record`, "organizer record");
  await check(page, p(drafted), "participant: nothing sent yet");
  await check(page, p(open, 1), "participant: answering");
  await check(page, p(open, 0), "participant: answered, waiting");
  await check(page, p(revealed), "participant: reveal and resolve");
  await check(page, p(confirmed, 2), "participant: absent");
  await check(page, p(done), "participant: record stage");
  await check(page, `${p(done)}/record`, "participant record");
  await check(page, "/m/not-a-meeting", "organizer link without its key");
  await check(page, "/p/not-a-token", "participant link that doesn't work");
  console.log(stopCounts.join("\n"));
  // A bad link is expected to log the failed request; nothing else may.
  expect(errors.filter((e) => !/401|Failed to load resource/.test(e))).toEqual([]);
});
