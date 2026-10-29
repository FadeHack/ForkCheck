import { expect, test, type APIRequestContext } from "@playwright/test";
import type { OrganizerMeetingState, ParticipantState } from "../src/contracts/api";
import { seedAnalyzedMeeting } from "./seed";

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

/** Publishes every passing draft, as the organizer's "Publish" button would. */
async function openRound(request: APIRequestContext, meetingId: string, token: string) {
  const headers = { authorization: `Bearer ${token}` };
  const res = await request.get(`/api/meetings/${meetingId}`, { headers });
  const state = (await res.json()) as OrganizerMeetingState;
  const probeIds = state.probes.filter((p) => p.status === "draft").map((p) => p.id);
  const opened = await request.post(`/api/meetings/${meetingId}/rounds`, {
    headers,
    data: { probeIds },
  });
  expect(opened.ok()).toBe(true);
}

test.use({ viewport: { width: 320, height: 720 } });

test("a participant answers every question and sees only their own answers", async ({
  page,
  request,
  baseURL,
}) => {
  const m = await seedAnalyzedMeeting(baseURL!);
  await openRound(request, m.meetingId, m.organizerToken);
  const [priya, marco] = m.participantLinks;

  const where = "Where does single sign-on run on Friday?";
  const marcoState = await request.get(`/api/p/${marco!.token}`);
  const { openProbes } = (await marcoState.json()) as ParticipantState;
  const marcoQuestion = openProbes.find((p) => p.stem === where)!;
  const staging = marcoQuestion.options.find((o) => o.text === "On staging only")!;
  const sent = await request.post(`/api/p/${marco!.token}/answers`, {
    data: { probeId: marcoQuestion.id, choice: "option", optionId: staging.id },
  });
  expect(sent.ok()).toBe(true);

  await page.goto(`/p/${priya!.token}`);
  await expect(page.getByRole("heading", { name: "Your questions" })).toBeVisible();
  await expect(page.getByText("Answer on your own.")).toBeVisible();

  const send = page.getByRole("button", { name: "Send my answers" });
  await send.click();
  await expect(page.getByText("Choose an answer. If you don't know, choose Not sure.")).toHaveCount(
    2,
  );

  const first = page.getByRole("group", { name: where });
  await first.getByLabel("In production").check();
  const second = page.getByRole("group").filter({ hasNotText: where });
  await second.getByLabel("Write my own answer").check();
  await expect(second.getByText("The model will match this to the closest option")).toBeVisible();
  await send.click();
  await expect(second.getByText("Write your answer, or choose one of the options.")).toBeVisible();
  await second.getByLabel("Your answer").fill("Only once Marco says it's live");
  await send.click();

  await expect(
    page.getByText("Sent. You can change an answer until answers are revealed."),
  ).toBeVisible();
  await expect(page.getByText("Waiting for the others to answer.")).toBeVisible();
  await expect(
    page.getByText('In your own words: "Only once Marco says it\'s live"'),
  ).toBeVisible();
  await expect(page.locator("dd").filter({ hasText: "In production" })).toBeVisible();
  // Marco chose staging; nothing on Priya's page may show that.
  await expect(page.getByText("On staging only")).toHaveCount(0);

  await page.getByRole("button", { name: "Change an answer" }).click();
  await expect(first.getByLabel("In production")).toBeChecked();
  await first.getByLabel("Not sure").check();
  for (const row of await page.locator(".choice").all()) {
    expect((await row.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  }
  await send.click();
  await expect(page.locator("dd").filter({ hasText: "Not sure" })).toBeVisible();

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBe(0);
});
