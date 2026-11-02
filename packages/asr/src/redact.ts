/** Upstream error text with the API key taken out, in case the service echoes it. */
export function withoutKey(text: string, apiKey: string): string {
  const cut = apiKey.length >= 8 ? text.split(apiKey).join("[key]") : text;
  return cut.replace(/\bLLM_[A-Za-z0-9_-]{8,}/g, "[key]");
}
