import type { Deps } from "./deps";
import { logError } from "./log";

/** Transcripts and everything derived from them are kept this long unless deleted sooner. */
export const RETENTION_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;
const SWEEP_EVERY_MS = 60 * 60 * 1000;

export function deleteAfter(createdAt: Date): string {
  return new Date(createdAt.getTime() + RETENTION_DAYS * DAY_MS).toISOString();
}

/** Removes stored audio first, then the meeting; rows cascade. */
export async function deleteMeeting(deps: Deps, meetingId: string): Promise<void> {
  for (const key of await deps.meetings.audioKeys(meetingId)) await deps.storage.delete(key);
  await deps.meetings.delete(meetingId);
}

/** Deletes every meeting past its retention, stored audio first. Returns how many went. */
export async function sweepExpired(deps: Deps): Promise<number> {
  const ids = await deps.meetings.expired(deps.now());
  for (const id of ids) await deleteMeeting(deps, id);
  return ids.length;
}

/**
 * Sweeps now and then hourly for as long as the server runs. A meeting that expires while the
 * server is down goes at the next start.
 */
export function startSweeper(deps: Deps): void {
  const sweep = () => void sweepExpired(deps).catch((error: unknown) => logError("sweep", error));
  sweep();
  setInterval(sweep, SWEEP_EVERY_MS).unref();
}
