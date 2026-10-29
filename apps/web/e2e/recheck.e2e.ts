import { expect, test, type Page } from "@playwright/test";
import type { ParticipantState, ProposeResolutionResponse } from "../src/contracts/api";
import { noAxeViolations } from "./axe";
import { answerOpen, closeRound, openRound, recheckWithScript, seedAnalyzedMeeting } from "./seed";

const where = "Where does single sign-on run on Friday?";
const VAGUE = "Single sign-on is ready soon.";
const recheck = {
  consequence: "Where pilot admins sign in on Monday.",
  stem: "On Monday morning, which system do the pilot admins sign in to?",
  options: [{ text: "The staging system" }, { text: "The production system" }],
};
const POLL = { timeout: 10_000 };

const answerRecheck = async (page: Page, option: string) => {
  await expect(
    page.getByRole("heading", { name: "One more question about what happens next" }),
  ).toBeVisible(POLL);
  await page.getByRole("group", { name: recheck.stem }).getByLabel(option).check();
  await page.getByRole("button", { name: "Send my answers" }).click();
  await expect(page.getByText("Sent.", { exact: false })).toBeVisible();
};

test("vague wording everyone confirmed is reopened when the recheck answers differ", async ({
  browser,
  request,
  baseURL,
}) => {
  const m = await seedAnalyzedMeeting(baseURL!);
  await openRound(request, m.meetingId, m.organizerToken);
  const [priya, marco, dana] = m.participantLinks;
  const same = "Designs or a mock-up";
  await answerOpen(request, priya!.token, (s) => (s === where ? "In production" : same));
  await answerOpen(request, marco!.token, (s) => (s === where ? "On staging only" : same));
  await closeRound(request, m.meetingId, m.organizerToken);

  // Priya proposes vague wording; she and Marco confirm it, and Dana is marked absent.
  const state = (await (await request.get(`/api/p/${priya!.token}`)).json()) as ParticipantState;
  const splitId = state.revealed.find((r) => r.probe.stem === where)!.split.id;
  const proposed = (await (
    await request.post(`/api/p/${priya!.token}/resolutions`, { data: { splitId, text: VAGUE } })
  ).json()) as ProposeResolutionResponse;
  for (const who of [priya!, marco!]) {
    const ok = await request.post(`/api/p/${who.token}/resolutions/${proposed.id}/confirm`);
    expect(ok.ok()).toBe(true);
  }
  const headers = { authorization: `Bearer ${m.organizerToken}` };
  const absent = await request.patch(
    `/api/meetings/${m.meetingId}/participants/${dana!.participantId}`,
    { headers, data: { status: "absent" } },
  );
  expect(absent.ok()).toBe(true);

  const contexts = await Promise.all([1, 2, 3].map(() => browser.newContext()));
  const [org, pPage, mPage] = await Promise.all(contexts.map((c) => c.newPage()));
  const errors: string[] = [];
  for (const page of [org!, pPage!, mPage!]) {
    page.on("console", (msg) => {
      if (msg.type() === "error") errors.push(msg.text());
    });
  }
  // The model isn't called in tests: the request runs the server's own code with a scripted reply.
  await org!.route("**/api/splits/*/recheck", async (route) => {
    const { status, body } = await recheckWithScript(m.meetingId, splitId, recheck);
    await route.fulfill({ status, json: body });
  });
  await pPage!.goto(`/p/${priya!.token}`);
  await mPage!.goto(`/p/${marco!.token}`);

  await org!.goto(`/m/${m.meetingId}#k=${m.organizerToken}`);
  await expect(org!.getByRole("heading", { name: "Ready for a recheck" })).toBeVisible();
  await expect(org!.getByText(VAGUE)).toBeVisible();
  await org!.getByRole("button", { name: "Send a recheck question" }).click();
  await expect(org!.getByText("Sent to everyone as a new question.")).toBeVisible();
  await expect(org!.getByText(recheck.stem)).toBeVisible();

  // Each participant gets it as a new question: no earlier answers, question or wording.
  await answerRecheck(pPage!, "The staging system");
  for (const page of [pPage!, mPage!]) {
    await expect(page.getByText(where)).toHaveCount(0);
    await expect(page.getByText(/Chosen by/)).toHaveCount(0);
  }
  await expect(mPage!.getByText(VAGUE)).toHaveCount(0);
  await answerRecheck(mPage!, "The production system");

  await expect(org!.getByText("2 of 2 have answered.")).toBeVisible(POLL);
  await org!.getByRole("button", { name: "Reveal answers" }).click();

  // The difference is back on the reveal with the recheck's answers under it, for everyone.
  for (const page of [pPage!, mPage!, org!]) {
    const reopened = page.locator(".reveal-item", { hasText: where });
    await expect(
      reopened.getByText("answers differed, so the wording didn't settle it."),
    ).toBeVisible(POLL);
    const result = reopened.locator(".recheck-result");
    await expect(result).toContainText(recheck.stem);
    await expect(result).toContainText("Chosen by Priya");
    await expect(result).toContainText("Chosen by Marco");
  }
  const mine = pPage!.locator(".reveal-item", { hasText: where }).locator(".resolve");
  await expect(mine.getByText("the recheck answers differed")).toBeVisible();
  await expect(mine.getByRole("button", { name: "Propose a change" })).toBeVisible();
  await expect(org!.locator('[aria-current="step"]')).toContainText("Resolve");

  await noAxeViolations(pPage!);
  expect(errors).toEqual([]);
  await Promise.all(contexts.map((c) => c.close()));
});
