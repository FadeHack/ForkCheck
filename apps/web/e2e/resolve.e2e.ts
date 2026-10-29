import { expect, test, type APIRequestContext, type Browser, type Page } from "@playwright/test";
import type { ParticipantState } from "../src/contracts/api";
import { noAxeViolations } from "./axe";
import { answerOpen, closeRound, openRound, seedAnalyzedMeeting } from "./seed";

const where = "Where does single sign-on run on Friday?";
const DRAFT = "Single sign-on runs on staging on Friday.";
const POLL = { timeout: 10_000 };

/** A revealed meeting where Priya and Marco differ on one question; Dana didn't answer. */
async function revealedSplit(browser: Browser, request: APIRequestContext, baseURL: string) {
  const m = await seedAnalyzedMeeting(baseURL);
  await openRound(request, m.meetingId, m.organizerToken);
  const [priya, marco, dana] = m.participantLinks;
  const same = "Designs or a mock-up";
  await answerOpen(request, priya!.token, (s) => (s === where ? "In production" : same));
  await answerOpen(request, marco!.token, (s) => (s === where ? "On staging only" : same));
  await closeRound(request, m.meetingId, m.organizerToken);

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
  const proposals = async () => {
    const state = (await (await request.get(`/api/p/${marco!.token}`)).json()) as ParticipantState;
    return state.revealed.flatMap((r) => r.resolutions);
  };
  return { m, dana: dana!, pPage: pPage!, mPage: mPage!, contexts, errors, proposals };
}

/** The wording section under the difference. */
const resolve = (page: Page) =>
  page.locator('.reveal-item:has(.fork[data-outcome="split"]) .resolve');

test("a model draft is only proposed once a participant submits it, and confirmations reach everyone", async ({
  browser,
  request,
  baseURL,
}) => {
  const { m, dana, pPage, mPage, contexts, errors, proposals } = await revealedSplit(
    browser,
    request,
    baseURL!,
  );
  // The model isn't called in tests; this stands in for its reply to Priya's request.
  await pPage.route("**/resolutions?draft=1", (route) =>
    route.fulfill({ json: { text: DRAFT, draftedByModel: true } }),
  );

  const mine = resolve(pPage);
  await mine.getByRole("button", { name: "Draft wording for me" }).click();
  await expect(mine.getByText("Drafted by the model. Edit it or write your own.")).toBeVisible();
  await expect(mine.getByText(DRAFT)).toBeVisible();
  // Shown, not placed: the field is still empty and nothing is proposed.
  const field = mine.getByLabel("Your wording");
  await expect(field).toHaveValue("");
  expect(await proposals()).toEqual([]);
  await noAxeViolations(pPage);

  await mine.getByRole("button", { name: "Use this draft" }).click();
  await expect(field).toHaveValue(DRAFT);
  await expect(field).toBeFocused();
  expect(await proposals()).toEqual([]);
  await expect(resolve(mPage).getByText(DRAFT)).toHaveCount(0);

  // Marco starts writing his own wording at the same time.
  const theirs = resolve(mPage);
  await theirs.getByLabel("Your wording").fill("Staging first");
  await field.fill(`${DRAFT} Production follows on Monday.`);
  await mine.getByRole("button", { name: "Propose wording" }).click();
  await expect(mine.getByRole("button", { name: "Confirm this wording" })).toBeVisible();
  expect((await proposals()).map((r) => [r.text, r.draftedByModel])).toEqual([
    [`${DRAFT} Production follows on Monday.`, true],
  ]);

  // Marco's page picks up the proposal and who wrote it.
  await expect(theirs.getByText("Production follows on Monday.")).toBeVisible(POLL);
  // The refresh that brought Priya's proposal kept what Marco was typing.
  await expect(theirs.getByLabel("Your wording")).toHaveValue("Staging first");
  await theirs.getByRole("button", { name: "Cancel" }).click();
  await expect(theirs.getByText("Drafted by the model, then submitted by Priya")).toBeVisible();
  await theirs.getByRole("button", { name: "Confirm this wording" }).click();
  await expect(theirs.getByRole("button", { name: "Confirm this wording" })).toHaveCount(0);

  // Priya sees Marco's confirmation without reloading, then confirms too.
  const marcoLine = mine.locator("li", { hasText: "Marco" });
  await expect(marcoLine).toContainText("Confirmed", POLL);
  await mine.getByRole("button", { name: "Confirm this wording" }).click();
  await expect(mine.locator("li", { hasText: "Dana" })).toContainText("Not yet");

  // Dana never answered; once she is marked absent, the wording is confirmed by everyone asked.
  const headers = { authorization: `Bearer ${m.organizerToken}` };
  const danaId = dana.participantId;
  const marked = await request.patch(`/api/meetings/${m.meetingId}/participants/${danaId}`, {
    headers,
    data: { status: "absent" },
  });
  expect(marked.ok()).toBe(true);
  await expect(theirs.locator("li", { hasText: "Dana" })).toContainText("Absent, not asked", POLL);

  // The organizer sees the same wording and list, with nothing to press.
  const org = await contexts[0]!.newPage();
  await org.goto(`/m/${m.meetingId}?stage=resolve#k=${m.organizerToken}`);
  const watched = resolve(org);
  await expect(watched.getByText("Production follows on Monday.")).toBeVisible();
  await expect(watched.locator("li", { hasText: "Priya" })).toContainText("Confirmed");
  await expect(watched.getByRole("button")).toHaveCount(0);

  expect(errors).toEqual([]);
  await Promise.all(contexts.map((c) => c.close()));
});

test("agree to disagree asks first, then records the difference as unresolved for everyone", async ({
  browser,
  request,
  baseURL,
}) => {
  const { pPage, mPage, contexts, errors } = await revealedSplit(browser, request, baseURL!);
  const theirs = resolve(mPage);
  await theirs.getByRole("button", { name: "Agree to disagree" }).click();
  const dialog = mPage.getByRole("dialog");
  await expect(dialog).toContainText("Record this difference as unresolved?");
  await dialog.getByRole("button", { name: "Keep working on it" }).click();
  await expect(dialog).toBeHidden();
  await expect(theirs.getByLabel("Your wording")).toBeVisible();

  await theirs.getByRole("button", { name: "Agree to disagree" }).click();
  await dialog.getByRole("button", { name: "Record as unresolved" }).click();
  await expect(theirs.getByText("Recorded as unresolved")).toBeVisible();
  await expect(resolve(pPage).getByText("Recorded as unresolved")).toBeVisible(POLL);
  await expect(resolve(pPage).getByRole("button")).toHaveCount(0);

  expect(errors).toEqual([]);
  await Promise.all(contexts.map((c) => c.close()));
});
