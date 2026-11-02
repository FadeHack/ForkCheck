import { expect, test } from "@playwright/test";
import type { CreateMeetingResponse } from "../src/contracts/api";

test("the sample meeting fills the form, and the check it creates is listed under Your meetings", async ({
  page,
}) => {
  await page.goto("/meetings");
  await expect(page.getByText("No meeting checks in this browser yet.")).toBeVisible();

  await page.goto("/");
  await page.getByRole("link", { name: "Try the sample meeting" }).click();
  await expect(page).toHaveURL(/\/new\?sample$/);
  await expect(page.getByLabel("Meeting title")).toHaveValue("Atlas launch sync");

  // Filling it from the button on a blank form gives the same values.
  await page.goto("/new");
  await expect(page.getByLabel("Meeting title")).toHaveValue("");
  await page.getByRole("button", { name: "Fill in the sample meeting" }).click();
  await expect(page.getByLabel("Meeting title")).toHaveValue("Atlas launch sync");
  await expect(page.getByLabel("Meeting date and time")).toHaveValue("2026-11-03T10:00");
  await expect(page.getByLabel("Time zone")).toHaveValue("America/New_York");
  await expect(page.getByLabel("Participant names, one per line")).toHaveValue(
    "Nadia\nTomas\nJune",
  );
  await page.getByLabel(/Everyone in this meeting agreed/).check();
  await page.getByRole("button", { name: "Create meeting check" }).click();
  await expect(page.getByRole("heading", { name: "Meeting check created" })).toBeVisible();

  await page
    .getByRole("navigation", { name: "Main" })
    .getByRole("link", { name: "Your meetings" })
    .click();
  await expect(page.getByRole("link", { name: "Your meetings" })).toHaveAttribute(
    "aria-current",
    "page",
  );
  const row = page.getByRole("listitem").filter({ hasText: "Atlas launch sync" });
  await expect(row.getByRole("status")).toHaveText(/^(At \w+|Record ready)$/);
  await row.getByRole("link", { name: "Atlas launch sync" }).click();
  await expect(page.getByRole("heading", { name: "Atlas launch sync", level: 1 })).toBeVisible();

  await page.goto("/meetings");
  await page.getByRole("button", { name: 'Remove "Atlas launch sync" from this list' }).click();
  await expect(page.getByText("No meeting checks in this browser yet.")).toBeVisible();
});

test("a listed meeting that was deleted elsewhere shows as gone, with no link", async ({
  page,
  request,
}) => {
  const res = await request.post("/api/meetings", {
    data: {
      title: "Pilot customer check-in",
      heldAt: "2026-10-26T15:00:00-04:00",
      timezone: "America/New_York",
      participants: ["Priya", "Marco"],
      transcript: "[00:00] Priya: SSO is ready by Friday.\n[00:05] Marco: Yep, Friday.",
    },
  });
  const created = (await res.json()) as CreateMeetingResponse;
  // Opening the workspace saves it to this browser's list.
  await page.goto(`/m/${created.meetingId}#k=${created.organizerToken}`);
  await expect(page.getByRole("heading", { name: "Pilot customer check-in" })).toBeVisible();
  const deleted = await request.delete(`/api/meetings/${created.meetingId}`, {
    headers: { authorization: `Bearer ${created.organizerToken}` },
  });
  expect(deleted.ok()).toBe(true);

  await page.goto("/meetings");
  const row = page.getByRole("listitem").filter({ hasText: "Pilot customer check-in" });
  await expect(row.getByRole("status")).toHaveText("Deleted, or its 7 days ran out");
  await expect(row.getByRole("link")).toHaveCount(0);
});

test("participant pages carry no site navigation", async ({ page, request }) => {
  const res = await request.post("/api/meetings", {
    data: {
      title: "Pilot customer check-in",
      heldAt: "2026-10-26T15:00:00-04:00",
      timezone: "America/New_York",
      participants: ["Priya", "Marco"],
      transcript: "[00:00] Priya: SSO is ready by Friday.\n[00:05] Marco: Yep, Friday.",
    },
  });
  const created = (await res.json()) as CreateMeetingResponse;
  await page.goto(`/p/${created.participantLinks[0]!.token}`);
  await expect(page.getByText("You are answering as Priya.")).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Main" })).toHaveCount(0);
});
