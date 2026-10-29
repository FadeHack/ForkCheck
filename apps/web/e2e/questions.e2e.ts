import { expect, test, type Page } from "@playwright/test";
import { seedAnalyzedMeeting } from "./seed";

let consoleErrors: string[] = [];

test.beforeEach(({ page }) => {
  consoleErrors = [];
  page.on("console", (msg) => {
    // The failed drafting run below answers 502 on purpose.
    if (msg.type() === "error" && !msg.text().startsWith("Failed to load resource")) {
      consoleErrors.push(msg.text());
    }
  });
});

test.afterEach(() => {
  expect(consoleErrors).toEqual([]);
});

const draft = (page: Page, stem: string | RegExp) =>
  page.locator("li.draft").filter({ has: page.getByRole("heading", { name: stem }) });

test('a draft edited to say "disagree" fails its check and can\'t be published', async ({
  page,
  baseURL,
}) => {
  const m = await seedAnalyzedMeeting(baseURL!);
  await page.goto(`/m/${m.meetingId}#k=${m.organizerToken}`);

  await expect(page.getByRole("heading", { name: "Decisions found" })).toBeVisible();
  await expect(page.getByText("Open to more than one reading")).toBeVisible();
  const publish = page.getByRole("button", { name: /^Publish \d questions?$/ });
  await expect(publish).toHaveText("Publish 2 questions");

  // Leave one draft, so the edited one is the only candidate for publishing.
  await page.getByRole("button", { name: /^Withdraw "For / }).click();
  await expect(publish).toHaveText("Publish 1 question");
  await expect(page.getByRole("button", { name: /^Restore "For / })).toBeVisible();

  const stem = "Where does single sign-on run on Friday?";
  await page.getByRole("button", { name: `Edit "${stem}"` }).click();
  await page.getByLabel("Question", { exact: true }).fill("Do you disagree about where SSO runs?");
  await page.getByRole("button", { name: "Save and check" }).click();

  const edited = draft(page, "Do you disagree about where SSO runs?");
  await expect(edited).toContainText('Uses the word "disagree", which presumes the answer.');
  await expect(page.getByRole("status").filter({ hasText: "Saved" })).toHaveText(
    "Saved. It fails a check.",
  );
  await expect(edited.getByLabel("Send this question")).toBeDisabled();
  await expect(publish).toHaveText("Publish 0 questions");
  await expect(publish).toBeDisabled();
  await expect(
    page.getByText("Choose at least one question that passes every check."),
  ).toBeVisible();
});

test("publishing sends the chosen drafts and opens the round", async ({ page, baseURL }) => {
  const m = await seedAnalyzedMeeting(baseURL!);
  await page.goto(`/m/${m.meetingId}#k=${m.organizerToken}`);

  const first = page.locator("li.draft").first();
  await first.getByLabel("Send this question").uncheck();
  await page.getByRole("button", { name: "Publish 1 question" }).click();

  await expect(page.getByRole("heading", { name: "Answers so far" })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Meeting check stages" })).toContainText(
    "Reveal, not yet",
  );
  await expect(page.getByText("0 of 3 have answered.")).toBeVisible();
});

test("drafting starts from the workspace and offers a retry when a step fails", async ({
  page,
  request,
}) => {
  // Without LIVE=1 a new meeting has no recorded model replies, so the first step fails.
  const res = await request.post("/api/meetings", {
    data: {
      title: "Unrecorded meeting",
      heldAt: "2026-10-26T15:00:00-04:00",
      timezone: "America/New_York",
      participants: ["Priya", "Marco"],
      transcript: "Priya: Ready by Friday?\nMarco: Yes, by Friday.",
    },
  });
  const m = (await res.json()) as { meetingId: string; organizerToken: string };
  await page.goto(`/m/${m.meetingId}#k=${m.organizerToken}`);

  await page.getByRole("button", { name: "Draft questions" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Drafting stopped at" })).toContainText(
    "Retry from that step.",
  );
  await expect(page.getByRole("button", { name: "Retry from that step" })).toBeVisible();
});
