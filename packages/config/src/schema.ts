import { z } from "zod";

const secret = z.string().min(1);
const usd = (fallback: number) => z.coerce.number().positive().default(fallback);
const flag = z
  .enum(["0", "1"])
  .default("0")
  .transform((value) => value === "1");

export const envSchema = z.object({
  LIVE: flag,
  RECORD_FIXTURES: flag,
  MODEL_API_KEY: secret.optional(),
  BASETEN_API_KEY: secret.optional(),
  DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }).optional(),
  STORAGE_DRIVER: z.enum(["local", "blob"]).default("local"),
  BLOB_READ_WRITE_TOKEN: secret.optional(),
  AUDIO_DIR: z.string().min(1).default("var/audio"),
  FFMPEG_PATH: z.string().min(1).default("ffmpeg"),
  SPEND_CAP_USD: usd(100),
  BASETEN_SPEND_CAP_USD: usd(60),
});

export type Env = z.infer<typeof envSchema>;
export type EnvName = keyof Env;

export const envNames = Object.keys(envSchema.shape) as EnvName[];

/** Variables whose values must never be printed. */
export const secretNames: ReadonlySet<EnvName> = new Set([
  "MODEL_API_KEY",
  "BASETEN_API_KEY",
  "DATABASE_URL",
  "BLOB_READ_WRITE_TOKEN",
]);
