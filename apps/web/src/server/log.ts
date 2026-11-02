// Participant tokens travel in the path and organizer tokens in headers; neither may reach a log.
const participantPath = /(\/(?:api\/)?p\/)[^/?#\s]+/g;
const bearer = /(Bearer\s+)\S+/gi;
// Meta API keys look like LLM_<id>_<secret>.
const metaKey = /\bLLM_[A-Za-z0-9_-]{8,}/g;

/** The configured keys themselves, wherever they appear, whatever their shape. */
function configuredKeys(): string[] {
  return [process.env.MODEL_API_KEY, process.env.BASETEN_API_KEY].filter(
    (k): k is string => k !== undefined && k.length >= 8,
  );
}

export function redact(text: string): string {
  let out = text
    .replace(participantPath, "$1[token]")
    .replace(bearer, "$1[token]")
    .replace(metaKey, "[key]");
  for (const key of configuredKeys()) out = out.split(key).join("[key]");
  return out;
}

export function logError(context: string, error: unknown): void {
  const detail = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  console.error(`[api] ${redact(context)}: ${redact(detail)}`);
}
