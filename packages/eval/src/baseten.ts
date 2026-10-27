export const BASETEN_BASE_URL = "https://inference.baseten.co/v1";

/** The exact Baseten model ID. Never substitute a generic slug. */
export const BASETEN_MODEL = "meta-models/muse-spark-open-1026";

/** USD per million tokens, from baseten.co/pricing ("Muse Spark Open"), 2026-10-27. */
export const BASETEN_CHAT_PRICE = { input: 1.25, cachedInput: 0.15, output: 4.25 } as const;
