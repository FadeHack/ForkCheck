export const META_BASE_URL = "https://api.meta.ai/v1";

export const META_CHAT_MODEL = "muse-spark-1.3";
export const META_TRANSCRIBE_MODEL = "muse-voice-transcribe-1.0";

/** USD per million tokens. */
export const META_CHAT_PRICE = { input: 1.25, cachedInput: 0.15, output: 4.25 } as const;
