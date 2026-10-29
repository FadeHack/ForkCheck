import { expect, test } from "@playwright/test";
import { answerOpen, closeRound, openRound, seedAnalyzedMeeting } from "./seed";

const where = "Where does single sign-on run on Friday?";
const same = "Designs or a mock-up";
const POLL = { timeout: 10_000 };

test("the trace panel and the agree-to-disagree dialog work from the keyboard alone", async ({
  browser,
  request,
  baseURL,
}) => {
  const m = await seedAnalyzedMeeting(baseURL!);
  await openRound(request, m.meetingId, m.organizerToken);
  const [priya, marco] = m.participantLinks;
  await answerOpen(request, priya!.token, (s) => (s === where ? "In production" : same));
  await answerOpen(request, marco!.token, (s) => (s === where ? "On staging only" : same));
  await closeRound(request, m.meetingId, m.organizerToken);

  const org = await (await browser.newContext()).newPage();
  await org.goto(`/m/${m.meetingId}#k=${m.organizerToken}`);
  const panel = org.getByRole("complementary", { name: "What the model did" });
  const summary = panel.locator("summary");
  await summary.focus();
  await org.keyboard.press("Enter");
  await expect(panel.getByRole("table")).toBeVisible();
  // Escape works from inside the panel too, and focus goes back to its heading.
  await panel.getByRole("region", { name: "Model calls" }).focus();
  await org.keyboard.press("Escape");
  await expect(panel.getByRole("table")).toBeHidden();
  await expect(summary).toBeFocused();

  const p = await (await browser.newContext()).newPage();
  await p.goto(`/p/${marco!.token}`);
  const button = p.getByRole("button", { name: "Agree to disagree" });
  await button.focus();
  await p.keyboard.press("Enter");
  const dialog = p.getByRole("dialog");
  await expect(dialog).toBeVisible();
  // Focus starts inside the dialog, and Escape closes it without recording anything.
  await expect(dialog.locator(":focus")).toHaveCount(1);
  await p.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(button).toBeFocused();
  await expect(p.getByText("Recorded as unresolved")).toHaveCount(0);
});

test("a participant waiting on others hears when the answers are revealed", async ({
  page,
  request,
  baseURL,
}) => {
  const m = await seedAnalyzedMeeting(baseURL!);
  await openRound(request, m.meetingId, m.organizerToken);
  // Dana hasn't answered, so Priya waits; two answers are enough to close the round.
  const [priya, marco] = m.participantLinks;
  await answerOpen(request, priya!.token, (s) => (s === where ? "In production" : same));
  await answerOpen(request, marco!.token, (s) => (s === where ? "On staging only" : same));

  await page.goto(`/p/${priya!.token}`);
  await expect(page.getByRole("heading", { name: "Your answers" })).toBeVisible();
  // Opening the page announces nothing: the content already says where things stand.
  const announced = page.getByRole("status").filter({ hasText: "answers are now shown" });
  await expect(announced).toHaveCount(0);
  await expect(page.getByRole("status").filter({ hasText: /Waiting for/ })).toBeVisible();

  await closeRound(request, m.meetingId, m.organizerToken);
  await expect(announced).toHaveText("Everyone's answers are now shown on this page.", POLL);
  await expect(page.getByText(where)).toBeVisible();
});
