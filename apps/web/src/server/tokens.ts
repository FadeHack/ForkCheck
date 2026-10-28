import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/** 128 random bits, URL-safe. Shown once; only the hash is stored. */
export function newToken(): string {
  return randomBytes(16).toString("base64url");
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Compares SHA-256 digests, so both sides always have the same length. */
export function tokenMatches(token: string, storedHash: string): boolean {
  const given = Buffer.from(hashToken(token), "hex");
  const stored = Buffer.from(storedHash, "hex");
  return given.length === stored.length && timingSafeEqual(given, stored);
}
