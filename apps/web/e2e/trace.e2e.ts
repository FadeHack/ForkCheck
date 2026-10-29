import { expect, test } from "@playwright/test";
import { noAxeViolations } from "./axe";
import { answerOpen, openRound, seedAnalyzedMeeting } from "./seed";

const where = "Where does single sign-on run on Friday?";

test("the organizer's trace panel lists the logged calls and no answers before the reveal", async ({
  page,
  request,
  baseURL,
}) => {
  const m = await seedAnalyzedMeeting(baseURL!);
  await openRound(request, m.meetingId, m.organizerToken);
  const [priya] = m.participantLinks;
  await answerOpen(request, priya!.token, (s) => (s === where ? "In production" : null));

  await page.goto(`/m/${m.meetingId}#k=${m.organizerToken}`);
  const panel = page.getByRole("complementary", { name: "What the model did" });
  await expect(panel).toBeVisible();
  // Closed by default: only its heading shows.
  await expect(panel.getByRole("table")).toBeHidden();

  await panel.getByText("What the model did").click();
  const table = panel.getByRole("table");
  await expect(table).toBeVisible();
  // The seeded analysis ran through the app's own stages; each call is a row.
  for (const stage of ["Find decisions", "Find what could be read two ways", "Draft questions"]) {
    await expect(table.getByRole("rowheader", { name: new RegExp(stage) }).first()).toBeVisible();
  }
  await expect(table.getByRole("cell", { name: "Replay" }).first()).toBeVisible();
  await expect(
    panel.getByText("Nothing yet. Code compares the answers once a round closes."),
  ).toBeVisible();
  // Priya has answered, but nothing of it reaches the panel before the reveal.
  await expect(panel.getByText("In production")).toHaveCount(0);
  await noAxeViolations(page);

  // The table scrolls in its own box; the page doesn't scroll sideways on a narrow phone.
  await page.setViewportSize({ width: 320, height: 700 });
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBe(0);
});

test("participants never see the trace panel and can't read the log", async ({
  page,
  request,
  baseURL,
}) => {
  const m = await seedAnalyzedMeeting(baseURL!);
  await openRound(request, m.meetingId, m.organizerToken);
  const [priya] = m.participantLinks;

  await page.goto(`/p/${priya!.token}`);
  await expect(page.getByRole("group", { name: where })).toBeVisible();
  await expect(page.getByText("What the model did")).toHaveCount(0);
  await page.goto(`/p/${priya!.token}/record`);
  await expect(page.getByRole("heading", { name: "Record checks" })).toBeVisible();
  await expect(page.getByText("What the model did")).toHaveCount(0);

  const asParticipant = await request.get(`/api/meetings/${m.meetingId}/trace`, {
    headers: { authorization: `Bearer ${priya!.token}` },
  });
  expect(asParticipant.status()).toBe(401);
  const asOrganizer = await request.get(`/api/meetings/${m.meetingId}/trace`, {
    headers: { authorization: `Bearer ${m.organizerToken}` },
  });
  expect(asOrganizer.status()).toBe(200);
});
