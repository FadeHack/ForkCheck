/** Runs once as the server starts: expired meetings are swept now and then hourly. */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { getDeps } = await import("./server/deps");
  const { logError } = await import("./server/log");
  const { startSweeper } = await import("./server/retention");
  try {
    startSweeper(getDeps());
  } catch (error) {
    // Without a database every request fails anyway, and says why; startup shouldn't.
    logError("retention sweeper", error);
  }
}
