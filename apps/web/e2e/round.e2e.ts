import { expect, test } from "@playwright/test";
import { answerOpen, openRound, seedAnalyzedMeeting } from "./seed";

let consoleErrors: string[] = [];

test.beforeEach(({ page }) => {
  consoleErrors = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
});

test.afterEach(() => {
  expect(consoleErrors).toEqual([]);
});

test("reveal waits for 2 people, asks first when someone hasn't answered, and skips the absent", async ({
  page,
  request,
  baseURL,
}) => {
  const m = await seedAnalyzedMeeting(baseURL!);
  await openRound(request, m.meetingId, m.organizerToken);
  const [priya, marco] = m.participantLinks;
  await page.goto(`/m/${m.meetingId}#k=${m.organizerToken}`);

  const reveal = page.getByRole("button", { name: "Reveal answers" });
  const people = page.getByRole("region", { name: "Participants" });
  await expect(page.getByText("0 of 3 have answered.")).toBeVisible();
  await expect(reveal).toBeDisabled();
  await expect(reveal).toHaveAccessibleDescription(
    "Nobody has answered yet. At least 2 people need to answer first.",
  );

  const where = "Where does single sign-on run on Friday?";
  await answerOpen(request, priya!.token, (stem) => (stem === where ? "In production" : null));
  // The monitor refreshes itself while the round is open.
  await expect(page.getByText("1 of 3 have answered.")).toBeVisible({ timeout: 10_000 });
  await expect(reveal).toBeDisabled();
  await expect(reveal).toHaveAccessibleDescription(
    "Only 1 person has answered. At least 2 people need to answer first.",
  );

  // Marco answers only the question where his reading differs from Priya's.
  await answerOpen(request, marco!.token, (stem) =>
    stem === where ? "On staging only" : undefined,
  );
  await expect(people.getByText("Answered 1 of 2 questions")).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText("1 of 3 have answered.")).toBeVisible();
  await expect(reveal).toBeEnabled();

  await reveal.click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText(
    "Dana and Marco haven't answered. Reveal now? Their questions will show as no response.",
  );
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await reveal.click();
  await dialog.getByRole("button", { name: "Keep waiting" }).click();
  await expect(dialog).toBeHidden();

  await page.getByRole("button", { name: "Mark absent: Dana" }).click();
  await expect(people.getByText("Absent, not asked")).toBeVisible();
  await expect(page.getByText("1 of 2 have answered.")).toBeVisible();

  await reveal.click();
  await expect(dialog).toContainText(
    "Marco hasn't answered. Reveal now? Marco's questions will show as no response.",
  );
  await dialog.getByRole("button", { name: "Reveal now" }).click();
  await expect(page.getByRole("heading", { name: "Revealed answers" })).toBeVisible();
});
