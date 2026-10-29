import { expect, test, type Page } from "@playwright/test";
import type { ParticipantState, ProposeResolutionResponse } from "../src/contracts/api";
import { noAxeViolations } from "./axe";
import { answerOpen, closeRound, openRound, seedAnalyzedMeeting } from "./seed";

const where = "Where does single sign-on run on Friday?";
const WORDING = "Single sign-on runs on staging on Friday.";

/** Follows every source link on the record and checks it lands on a visible element. */
async function followEverySource(page: Page) {
  const links = page.getByRole("list", { name: "Sources" }).getByRole("link");
  const count = await links.count();
  expect(count).toBeGreaterThan(0);
  for (let i = 0; i < count; i++) {
    const href = await links.nth(i).getAttribute("href");
    expect(href).toMatch(/^#.+/);
    await links.nth(i).click();
    await expect(page).toHaveURL(new RegExp(`${href}$`));
    const target = page.locator(`[id="${href!.slice(1)}"]`);
    await expect(target).toHaveCount(1);
    await expect(target).toBeVisible();
    await expect(target).toBeInViewport();
  }
  return count;
}

test("every record item links to its sources, for the organizer and for participants", async ({
  page,
  request,
  baseURL,
}) => {
  const m = await seedAnalyzedMeeting(baseURL!);
  await openRound(request, m.meetingId, m.organizerToken);
  const [priya, marco, dana] = m.participantLinks;
  const same = "Designs or a mock-up";
  await answerOpen(request, priya!.token, (s) => (s === where ? "In production" : same));
  await answerOpen(request, marco!.token, (s) => (s === where ? "On staging only" : same));
  await closeRound(request, m.meetingId, m.organizerToken);

  // Priya proposes wording, both she and Marco confirm it, and Dana is marked absent.
  const state = (await (await request.get(`/api/p/${priya!.token}`)).json()) as ParticipantState;
  const splitId = state.revealed.find((r) => r.probe.stem === where)!.split.id;
  const proposed = (await (
    await request.post(`/api/p/${priya!.token}/resolutions`, { data: { splitId, text: WORDING } })
  ).json()) as ProposeResolutionResponse;
  for (const who of [priya!, marco!]) {
    expect(
      (await request.post(`/api/p/${who.token}/resolutions/${proposed.id}/confirm`)).ok(),
    ).toBe(true);
  }
  const headers = { authorization: `Bearer ${m.organizerToken}` };
  const absent = await request.patch(
    `/api/meetings/${m.meetingId}/participants/${dana!.participantId}`,
    { headers, data: { status: "absent" } },
  );
  expect(absent.ok()).toBe(true);

  const errors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });

  // The token stays in this tab's sessionStorage once the workspace has read it.
  await page.goto(`/m/${m.meetingId}#k=${m.organizerToken}`);
  await expect(page.getByRole("heading", { name: "Pilot customer check-in" })).toBeVisible();
  await page.goto(`/m/${m.meetingId}/record`);
  const confirmed = page.getByRole("region", { name: "Confirmed by participants" });
  await expect(confirmed.getByText(WORDING)).toBeVisible();
  await expect(confirmed.getByText("Absent, not asked")).toBeVisible();
  await expect(page.getByText("No split found on 1 of 2 questions.")).toBeVisible();
  await expect(page.getByText("aligned", { exact: false })).toHaveCount(0);
  await expect(page.getByText("Every item passed the record checks.")).toBeVisible();
  const organizerLinks = await followEverySource(page);
  await noAxeViolations(page);

  // A participant sees the same record and the same links, read-only.
  await page.goto(`/p/${marco!.token}/record`);
  await expect(page.getByRole("region", { name: "Confirmed by participants" })).toContainText(
    WORDING,
  );
  expect(await followEverySource(page)).toBe(organizerLinks);
  await expect(page.getByRole("button", { name: /confirm|propose/i })).toHaveCount(0);

  // Set before loading, so axe doesn't read colors halfway through their transition.
  await page.emulateMedia({ colorScheme: "dark" });
  await page.reload();
  await expect(page.getByRole("heading", { name: "Record checks" })).toBeVisible();
  await noAxeViolations(page);

  // Print: the page chrome goes, the record stays, and colors are the light theme's.
  await page.emulateMedia({ media: "print", colorScheme: "dark" });
  await expect(page.locator(".site-header")).toBeHidden();
  await expect(page.getByRole("button", { name: "Print record" })).toBeHidden();
  const paper = await page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue("--paper").trim(),
  );
  expect(paper.toLowerCase()).toBe("#fbf8f3");
  await expect(page.locator("main")).toMatchAriaSnapshot(`
    - article:
      - heading /Decision record. Pilot customer check-in/ [level=1]
      - region "Confirmed by participants":
        - heading "Confirmed by participants" [level=2]
      - region "Unresolved":
        - heading "Unresolved" [level=2]
      - region "Stated in meeting":
        - heading "Stated in meeting" [level=2]
      - region "Questions asked":
        - heading "Questions asked" [level=2]
      - region "Where it was said":
        - heading "Where it was said" [level=2]
      - paragraph: No split found on 1 of 2 questions. That doesn't prove everyone understood the same thing.
      - heading "Record checks" [level=2]
  `);
  expect((await page.pdf()).byteLength).toBeGreaterThan(0);
  expect(errors).toEqual([]);
});
