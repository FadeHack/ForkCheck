import { expect, test, type Page } from "@playwright/test";
import { noAxeViolations } from "./axe";

/**
 * Three seconds of silent 24 kHz mono 16-bit WAV. Its transcription is replayed from
 * packages/asr/fixtures/replay, keyed by the converted file, so no live call is made.
 */
function silentWav(ms = 3000): Buffer {
  const dataBytes = Math.round((24_000 * ms) / 1000) * 2;
  const bytes = Buffer.alloc(44 + dataBytes);
  bytes.write("RIFF", 0, "ascii");
  bytes.writeUInt32LE(bytes.length - 8, 4);
  bytes.write("WAVE", 8, "ascii");
  bytes.write("fmt ", 12, "ascii");
  bytes.writeUInt32LE(16, 16);
  bytes.writeUInt16LE(1, 20);
  bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(24_000, 24);
  bytes.writeUInt32LE(48_000, 28);
  bytes.writeUInt16LE(2, 32);
  bytes.writeUInt16LE(16, 34);
  bytes.write("data", 36, "ascii");
  bytes.writeUInt32LE(dataBytes, 40);
  return bytes;
}

let consoleErrors: string[] = [];

test.beforeEach(async ({ page }) => {
  // Buttons re-enabled by a reply change color over 120 ms; axe must read the settled colors.
  await page.emulateMedia({ reducedMotion: "reduce" });
  consoleErrors = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
});

test.afterEach(() => {
  expect(consoleErrors).toEqual([]);
});

async function fillAudioForm(page: Page, file: { name: string; mimeType: string; buffer: Buffer }) {
  await page.goto("/");
  await page.getByLabel("Meeting title").fill("SSO pilot, recorded");
  await page.getByLabel("Meeting date and time").fill("2026-10-26T15:00");
  await page.getByLabel("Time zone").fill("America/New_York");
  await page.getByLabel("Participant names, one per line").fill("Priya\nMarco");
  await page.getByRole("radio", { name: "Upload a recording" }).check();
  await page.getByLabel("Recording", { exact: true }).setInputFiles(file);
  await page.getByLabel("Project terms, one per line (optional)").fill("SSO");
  await page.getByLabel(/Everyone in this recording agreed/).check();
}

async function createAndOpen(page: Page) {
  await page.getByRole("button", { name: "Create meeting check" }).click();
  await expect(page.getByRole("heading", { name: "Meeting check created" })).toBeVisible();
  await expect(page.getByText("The recording is being transcribed.")).toBeVisible();
  const href = await page
    .getByRole("listitem")
    .filter({ hasText: "/m/" })
    .getByRole("link")
    .getAttribute("href");
  await page.goto(href!);
}

test("uploads a recording, transcribes it and opens the Speakers stage", async ({ page }) => {
  await fillAudioForm(page, { name: "sync.wav", mimeType: "audio/wav", buffer: silentWav() });
  await expect(page.getByLabel("Transcript", { exact: true })).toHaveCount(0);
  await noAxeViolations(page);
  await createAndOpen(page);

  const rail = page.getByRole("navigation", { name: "Meeting check stages" });
  await expect(rail.locator('[aria-current="step"]')).toHaveText("Speakers");
  await expect(rail).toContainText("Transcript review, not yet");
  await expect(page.getByText("3 turns from 2 voices.")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText("Transcribed 3 s of audio:")).toBeVisible();
  await noAxeViolations(page);
});

test("maps two voices to one person after playing their turns", async ({ page }) => {
  await fillAudioForm(page, { name: "sync.wav", mimeType: "audio/wav", buffer: silentWav() });
  await createAndOpen(page);
  const speakerA = page.getByRole("group", { name: /Speaker A/ });
  const speakerB = page.getByRole("group", { name: /Speaker B/ });
  await expect(speakerA).toContainText("(2 turns)", { timeout: 20_000 });

  // Saving with a voice still open names what is missing and goes back to it.
  await page.getByRole("button", { name: "Save speakers" }).click();
  await expect(page.getByText("Map every speaker or mark them Unknown to continue.")).toBeVisible();
  await expect(page.getByLabel("Who is Speaker A?")).toBeFocused();
  await expect(speakerB.locator(".field-error")).toHaveText("Choose who Speaker B is, or Unknown.");

  // Playing a turn fetches the recording once and starts at the turn.
  const player = page.getByTestId("turn-player");
  await speakerB.getByRole("button", { name: "Play from 00:01" }).click();
  await expect(speakerB.getByRole("button", { name: "Stop playing" })).toBeVisible();
  await expect
    .poll(() => player.evaluate((a: HTMLAudioElement) => a.currentTime))
    .toBeGreaterThanOrEqual(1.1);
  // It stops at the end of the turn by itself.
  await expect(speakerB.getByRole("button", { name: "Play from 00:01" })).toBeVisible({
    timeout: 5_000,
  });
  expect(await player.evaluate((a: HTMLAudioElement) => a.paused)).toBe(true);
  await noAxeViolations(page);

  await page.getByLabel("Who is Speaker A?").selectOption({ label: "Priya" });
  await page.getByLabel("Who is Speaker B?").selectOption({ label: "Priya" });
  await page.getByRole("button", { name: "Save speakers" }).click();

  const rail = page.getByRole("navigation", { name: "Meeting check stages" });
  await expect(rail.locator('[aria-current="step"]')).toHaveText("Transcript review");
  const turns = page.locator(".turns li");
  await expect(turns).toHaveCount(3);
  await expect(turns.nth(1)).toContainText("Priya at 00:01");
  await expect(turns.nth(1)).toContainText("I'll own the rollout.");
  await noAxeViolations(page);

  // The mapping can be reopened, with the saved choices in place.
  await rail.getByRole("link", { name: /Speakers/ }).click();
  await expect(page.getByLabel("Who is Speaker B?")).toHaveValue(/:p:0$/);
});

test("refuses a file over 32 MB before uploading it", async ({ page }) => {
  await fillAudioForm(page, {
    name: "long.wav",
    mimeType: "audio/wav",
    buffer: Buffer.alloc(33_000_000),
  });
  const error = page.locator("#recording-error");
  await expect(error).toHaveText(
    "This file is 33.0 MB. ForkCheck can take files up to 32 MB. Trim it, or export it as mono WAV, and upload again.",
  );
  await page.getByRole("button", { name: "Create meeting check" }).click();
  await expect(page.getByRole("heading", { name: "Meeting check created" })).toHaveCount(0);
  await expect(error).toBeVisible();
});

test("shows why transcription failed and recovers with another upload", async ({ page }) => {
  await fillAudioForm(page, {
    name: "notes.wav",
    mimeType: "audio/wav",
    buffer: Buffer.from("these are not audio bytes"),
  });
  await createAndOpen(page);

  const alert = page.getByRole("region", { name: "Speakers" }).getByRole("alert");
  await expect(alert).toContainText("Transcription failed.", { timeout: 20_000 });
  await page.getByRole("button", { name: "Start transcription again" }).click();
  await expect(alert).toContainText("Transcription failed.", { timeout: 20_000 });
  await noAxeViolations(page);

  await page
    .getByLabel("Recording", { exact: true })
    .setInputFiles({ name: "sync.wav", mimeType: "audio/wav", buffer: silentWav() });
  await page.getByRole("button", { name: "Upload and transcribe" }).click();
  await expect(page.getByText("3 turns from 2 voices.")).toBeVisible({ timeout: 20_000 });
});
