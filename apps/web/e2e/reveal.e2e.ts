import { expect, test, type Page } from "@playwright/test";
import { noAxeViolations } from "./axe";
import { answerOpen, closeRound, openRound, seedAnalyzedMeeting } from "./seed";

const where = "Where does single sign-on run on Friday?";

const forks = (page: Page) => page.locator(".reveal article").allInnerTexts();

test("answers stay sealed until the reveal, then every viewer sees the same forks", async ({
  browser,
  request,
  baseURL,
}) => {
  const m = await seedAnalyzedMeeting(baseURL!);
  await openRound(request, m.meetingId, m.organizerToken);
  const [priya, marco] = m.participantLinks;
  // They differ on where SSO runs and agree on the other question.
  const same = "Designs or a mock-up";
  await answerOpen(request, priya!.token, (s) => (s === where ? "In production" : same));
  await answerOpen(request, marco!.token, (s) => (s === where ? "On staging only" : same));

  const contexts = await Promise.all([browser.newContext(), browser.newContext()]);
  const [pPage, mPage] = await Promise.all(contexts.map((c) => c.newPage()));
  const errors: string[] = [];
  for (const page of [pPage!, mPage!]) {
    page.on("console", (msg) => {
      if (msg.type() === "error") errors.push(msg.text());
    });
  }
  await pPage!.goto(`/p/${priya!.token}`);
  await mPage!.goto(`/p/${marco!.token}`);

  // Sealed: each page shows its own answer and never the other person's.
  await expect(pPage!.getByText("Waiting for Dana.")).toBeVisible();
  await expect(pPage!.locator("dd").filter({ hasText: "In production" })).toBeVisible();
  await expect(pPage!.getByText("On staging only")).toHaveCount(0);
  await expect(mPage!.locator("dd").filter({ hasText: "On staging only" })).toBeVisible();
  await expect(mPage!.getByText("In production")).toHaveCount(0);
  await expect(pPage!.getByText(/Chosen by/)).toHaveCount(0);

  await closeRound(request, m.meetingId, m.organizerToken);

  // Both pages pick up the reveal on their own.
  for (const page of [pPage!, mPage!]) {
    await expect(page.getByRole("heading", { name: "Revealed answers" })).toBeVisible({
      timeout: 10_000,
    });
  }
  const shown = await forks(pPage!);
  expect(shown).toEqual(await forks(mPage!));
  // The difference comes first, named and drawn as branches.
  // Each fork starts from what was said in the meeting.
  expect(shown[0]).toContain("I'll tell them Friday.");
  expect(shown[0]).toContain("Dana at 00:31");
  expect(shown[0]).toContain(where);
  expect(shown[0]).toContain("Different answers: a difference to discuss.");
  expect(shown[0]).toContain("Chosen by Priya");
  expect(shown[0]).toContain("Chosen by Marco");
  expect(shown[0]).toContain("Dana didn't answer.");
  await expect(pPage!.locator('.reveal .fork[data-outcome="split"] .fork-branch')).toHaveCount(2);

  const label = pPage!.getByRole("group", { name: "Is this a real difference?" }).first();
  await label.getByLabel("Real difference").check();
  await expect(label.getByText("Saved.")).toBeVisible();
  await expect(mPage!.getByText("Real difference: Priya")).toBeVisible({ timeout: 10_000 });

  // The organizer sees the same forks and the tally, without a label control.
  const org = await contexts[0]!.newPage();
  await org.goto(`/m/${m.meetingId}?stage=reveal#k=${m.organizerToken}`);
  await expect(org.getByRole("heading", { name: "Revealed answers" })).toBeVisible();
  expect(await forks(org)).toEqual(shown);
  await expect(org.getByText("Real difference: Priya")).toBeVisible();
  await expect(org.getByRole("group", { name: "Is this a real difference?" })).toHaveCount(0);

  await noAxeViolations(pPage!);
  await noAxeViolations(org);
  expect(errors).toEqual([]);
  await Promise.all(contexts.map((c) => c.close()));
});
