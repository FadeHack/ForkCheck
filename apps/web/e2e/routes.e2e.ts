import { expect, test, type APIRequestContext } from "@playwright/test";
import type { CreateMeetingResponse } from "../src/contracts/api";

const transcript = [
  "[00:00] Priya: Where are we on single sign-on for the pilot customer?",
  "[00:06] Marco: Login works on staging. I still need to wire up the admin roles.",
  "[00:20] Priya: OK, so SSO is ready by Friday. Marco, that's yours?",
  "[00:25] Marco: Yep, I'll have it ready by Friday.",
].join("\n");

let consoleErrors: string[] = [];

// Hydration and nesting problems surface only as console errors; a rejected token's 401 is expected.
test.beforeEach(({ page }) => {
  consoleErrors = [];
  page.on("console", (msg) => {
    if (msg.type() === "error" && !msg.text().startsWith("Failed to load resource")) {
      consoleErrors.push(msg.text());
    }
  });
});

test.afterEach(() => {
  expect(consoleErrors).toEqual([]);
});

async function createMeeting(request: APIRequestContext): Promise<CreateMeetingResponse> {
  const res = await request.post("/api/meetings", {
    data: {
      title: "Pilot customer check-in",
      heldAt: "2026-10-26T15:00:00-04:00",
      timezone: "America/New_York",
      participants: ["Priya", "Marco"],
      transcript,
    },
  });
  expect(res.status()).toBe(201);
  return (await res.json()) as CreateMeetingResponse;
}

test("start page creates a meeting check and shows its links", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Check what your meeting decided", level: 1 }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Create meeting check" }).click();
  await expect(page.getByText("Confirm that everyone agreed")).toBeVisible();

  await page.getByLabel("Meeting title").fill("Pilot customer check-in");
  await page.getByLabel("Meeting date and time").fill("2026-10-26T15:00");
  await page.getByLabel("Time zone").fill("America/New_York");
  await page.getByLabel("Participant names, one per line").fill("Priya\nMarco");
  await page.getByLabel("Transcript", { exact: true }).fill(transcript);
  await page.getByLabel(/Everyone in this meeting agreed/).check();
  await page.getByRole("button", { name: "Create meeting check" }).click();

  await expect(page.getByRole("heading", { name: "Meeting check created" })).toBeVisible();
  await expect(page.getByRole("link", { name: /\/m\/.+#k=/ })).toBeVisible();
  await expect(
    page.getByRole("listitem").filter({ hasText: "Marco" }).filter({ hasText: "/p/" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Copy link for Marco" }).click();
  await expect(page.getByRole("status")).toHaveText("Link copied");
  expect(await page.evaluate(() => navigator.clipboard.readText())).toMatch(/^http.*\/p\/.+/);
  // Links carry long tokens: they must wrap rather than widen the page on the narrowest phone.
  await page.setViewportSize({ width: 320, height: 640 });
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBe(0);
});

test("organizer workspace and record render for a new meeting", async ({ page, request }) => {
  const created = await createMeeting(request);
  await page.goto(`/m/${created.meetingId}#k=${created.organizerToken}`);
  await expect(page.getByRole("heading", { name: "Pilot customer check-in" })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Meeting check stages" })).toContainText(
    "Reveal, not yet",
  );
  await expect(page.getByText("Questions haven't been drafted")).toBeVisible();

  // The token stays in this tab's sessionStorage, so the record link needs no fragment.
  await page.goto(`/m/${created.meetingId}/record`);
  await expect(page.getByRole("heading", { name: "Unresolved" })).toBeVisible();
  await expect(page.getByText("Nothing unresolved.")).toBeVisible();
});

test("participant view and record render for a new meeting", async ({ page, request }) => {
  const created = await createMeeting(request);
  const link = created.participantLinks[0]!;
  await page.goto(`/p/${link.token}`);
  await expect(page.getByText("You are answering as Priya.")).toBeVisible();
  await expect(page.getByText("The organizer hasn't sent any questions yet.")).toBeVisible();

  await page.goto(`/p/${link.token}/record`);
  await expect(page.getByRole("heading", { name: "Confirmed by participants" })).toBeVisible();
});

test("bad or missing credentials show what to do next", async ({ page, request }) => {
  const created = await createMeeting(request);
  await page.goto(`/m/${created.meetingId}`);
  await expect(page.getByRole("main").getByRole("alert")).toContainText("missing its key");
  await page.goto("/p/not-a-token");
  await expect(page.getByRole("main").getByRole("alert")).toContainText(
    "Ask the organizer for a new link.",
  );
  // Loaded from another path: a hash-only change would not reload the page.
  await page.goto(`/m/${created.meetingId}#k=not-the-token`);
  await expect(page.getByRole("main").getByRole("alert")).toContainText(
    "Ask the organizer for a new link.",
  );
});
