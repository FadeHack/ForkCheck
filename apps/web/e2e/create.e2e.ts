import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";

const demo = JSON.parse(
  readFileSync(new URL("../../../scenarios/demo/sso-pilot.json", import.meta.url), "utf8"),
) as { title: string; participants: string[]; transcript: string };

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

test("an empty form names each field and how to fix it", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Time zone").fill("Mars/Olympus");
  await page.getByRole("button", { name: "Create meeting check" }).click();

  const described = async (label: string | RegExp) => {
    const id = await page
      .getByLabel(label, { exact: typeof label === "string" })
      .getAttribute("aria-describedby");
    return page.locator(`#${id!.split(" ").at(-1)}`);
  };
  await expect(await described("Meeting title")).toHaveText("Enter a meeting title.");
  await expect(await described("Time zone")).toHaveText(
    "Enter a time zone name, such as America/New_York.",
  );
  await expect(await described("Participant names, one per line")).toHaveText(
    "Enter at least two participant names, one per line.",
  );
  await expect(await described("Transcript")).toHaveText("Paste the meeting transcript.");
  await expect(await described(/Everyone in this meeting agreed/)).toHaveText(
    "Confirm that everyone agreed to have this meeting checked.",
  );
  await expect(page.getByRole("heading", { name: "Meeting check created" })).toHaveCount(0);
});

test("creates a meeting from the demo transcript, warning about a missing participant first", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByLabel("Meeting title").fill(demo.title);
  await page.getByLabel("Meeting date and time").fill("2026-10-26T15:00");
  await page.getByLabel("Time zone").fill("America/New_York");
  const names = page.getByLabel("Participant names, one per line");
  await names.fill(demo.participants.filter((n) => n !== "Dana").join("\n"));
  await page.getByLabel("Transcript", { exact: true }).fill(demo.transcript);

  const warning = page.locator("#transcript-warning");
  await expect(warning).toContainText("in the participant list: Dana. Add it or fix the name.");
  await expect(page.getByLabel("Transcript", { exact: true })).toHaveAttribute(
    "aria-describedby",
    "transcript-hint transcript-warning",
  );

  await names.fill(demo.participants.join("\n"));
  await expect(warning).toHaveCount(0);

  await page.getByLabel(/Everyone in this meeting agreed/).check();
  await page.getByRole("button", { name: "Create meeting check" }).click();

  await expect(page.getByRole("heading", { name: "Meeting check created" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Copy link to your workspace" })).toBeVisible();
  for (const name of demo.participants) {
    await expect(page.getByRole("button", { name: `Copy link for ${name}` })).toBeVisible();
  }
});
