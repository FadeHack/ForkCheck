// Participant tokens travel in the path and organizer tokens in headers; neither may reach a log.
const participantPath = /(\/(?:api\/)?p\/)[^/?#\s]+/g;
const bearer = /(Bearer\s+)\S+/gi;

export function redact(text: string): string {
  return text.replace(participantPath, "$1[token]").replace(bearer, "$1[token]");
}

export function logError(context: string, error: unknown): void {
  const detail = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  console.error(`[api] ${redact(context)}: ${redact(detail)}`);
}
