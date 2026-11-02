import { expect, test } from "@playwright/test";
import { noAxeViolations } from "./axe";
import { seedAnalyzedMeeting } from "./seed";

test("the organizer deletes a meeting check, and every link to it stops working", async ({
  page,
  request,
  baseURL,
}) => {
  const m = await seedAnalyzedMeeting(baseURL!);
  await page.goto(`/m/${m.meetingId}#k=${m.organizerToken}`);
  const section = page.getByRole("region", { name: "Delete this meeting check" });
  await expect(
    section.getByText(/It is deleted automatically on \w{3} \d{1,2}, \d{4}\./),
  ).toBeVisible();

  // Changing your mind leaves everything as it was.
  await section.getByRole("button", { name: "Delete now" }).click();
  await expect(section.getByText("This can't be undone.")).toBeVisible();
  await noAxeViolations(page);
  await section.getByRole("button", { name: "Keep it" }).click();
  await expect(section.getByRole("button", { name: "Delete everything" })).toHaveCount(0);

  await section.getByRole("button", { name: "Delete now" }).click();
  await section.getByRole("button", { name: "Delete everything" }).click();
  await expect(page.getByRole("heading", { name: "Meeting check deleted" })).toBeVisible();
  await noAxeViolations(page);

  const headers = { authorization: `Bearer ${m.organizerToken}` };
  expect((await request.get(`/api/meetings/${m.meetingId}`, { headers })).status()).toBe(401);
  const participant = m.participantLinks[0]!.token;
  expect((await request.get(`/api/p/${participant}`)).status()).toBe(401);
});
