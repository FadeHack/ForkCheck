import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, rename, rm, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";

/** Stored audio, keyed `<meetingId>/<fileId>`. Local disk now; Vercel Blob if the app is deployed. */
export interface Storage {
  /** Streams `body` to `key`. Past `maxBytes` it throws `TooLargeError` and keeps nothing. */
  put(
    key: string,
    body: ReadableStream<Uint8Array>,
    options: { maxBytes: number },
  ): Promise<{ bytes: number }>;
  /** `null` when nothing is stored under `key`. */
  get(key: string): Promise<ReadableStream<Uint8Array> | null>;
  /** Deleting a missing key is not an error. */
  delete(key: string): Promise<void>;
}

export class TooLargeError extends Error {
  constructor(readonly maxBytes: number) {
    super(`Upload exceeds ${maxBytes} bytes`);
    this.name = "TooLargeError";
  }
}

// Keys can come back from the client (`POST /audio {storageKey}`), so they never hold `.` or `/` beyond the one separator.
const KEY = /^[\w-]+\/[\w-]+$/;

export function audioKey(meetingId: string, fileId: string): string {
  const key = `${meetingId}/${fileId}`;
  if (!KEY.test(key)) throw new Error(`Not a valid storage key: ${key}`);
  return key;
}

export class LocalDiskStorage implements Storage {
  private readonly root: string;

  constructor(root: string) {
    this.root = resolve(root);
  }

  private path(key: string): string {
    if (!KEY.test(key)) throw new Error(`Not a valid storage key: ${key}`);
    return join(this.root, key);
  }

  async put(
    key: string,
    body: ReadableStream<Uint8Array>,
    { maxBytes }: { maxBytes: number },
  ): Promise<{ bytes: number }> {
    const path = this.path(key);
    // Written under a temporary name, so an aborted or oversize upload never shows up under `key`.
    const part = `${path}.part`;
    await mkdir(dirname(path), { recursive: true });
    let bytes = 0;
    const limit = new Transform({
      transform(chunk: Buffer, _encoding, done) {
        bytes += chunk.length;
        if (bytes > maxBytes) done(new TooLargeError(maxBytes));
        else done(null, chunk);
      },
    });
    try {
      await pipeline(
        Readable.fromWeb(body as NodeReadableStream<Uint8Array>),
        limit,
        createWriteStream(part),
      );
      await rename(part, path);
    } catch (error) {
      await rm(part, { force: true });
      throw error;
    }
    return { bytes };
  }

  async get(key: string): Promise<ReadableStream<Uint8Array> | null> {
    const path = this.path(key);
    try {
      await stat(path);
    } catch {
      return null;
    }
    return Readable.toWeb(createReadStream(path)) as ReadableStream<Uint8Array>;
  }

  async delete(key: string): Promise<void> {
    await rm(this.path(key), { force: true });
  }
}
