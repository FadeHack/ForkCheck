import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { EnvError, loadEnv, type EnvSource } from "../src/index";

const loadError = (source: EnvSource, options?: Parameters<typeof loadEnv>[1]): EnvError => {
  try {
    loadEnv(source, options);
  } catch (error) {
    if (error instanceof EnvError) return error;
    throw error;
  }
  throw new Error("expected loadEnv to throw");
};

describe("loadEnv", () => {
  it("parses a complete environment", () => {
    const env = loadEnv({
      LIVE: "1",
      MODEL_API_KEY: "test-model-key",
      BASETEN_API_KEY: "bt-secret",
      DATABASE_URL: "postgres://forkcheck:forkcheck@localhost:5433/forkcheck",
      STORAGE_DRIVER: "blob",
      BLOB_READ_WRITE_TOKEN: "blob-secret",
      AUDIO_DIR: "/data/audio",
      SPEND_CAP_USD: "40",
      BASETEN_SPEND_CAP_USD: "12.5",
    });
    expect(env).toEqual({
      LIVE: true,
      RECORD_FIXTURES: false,
      MODEL_API_KEY: "test-model-key",
      BASETEN_API_KEY: "bt-secret",
      DATABASE_URL: "postgres://forkcheck:forkcheck@localhost:5433/forkcheck",
      STORAGE_DRIVER: "blob",
      BLOB_READ_WRITE_TOKEN: "blob-secret",
      AUDIO_DIR: "/data/audio",
      SPEND_CAP_USD: 40,
      BASETEN_SPEND_CAP_USD: 12.5,
    });
  });

  it("applies defaults and needs no keys when not live", () => {
    expect(loadEnv({})).toEqual({
      LIVE: false,
      RECORD_FIXTURES: false,
      STORAGE_DRIVER: "local",
      AUDIO_DIR: "var/audio",
      SPEND_CAP_USD: 100,
      BASETEN_SPEND_CAP_USD: 60,
    });
  });

  it("treats blank values as unset", () => {
    const error = loadError({ LIVE: "1", MODEL_API_KEY: "" });
    expect(error.problems).toEqual([
      { name: "MODEL_API_KEY", issue: "is missing (required when LIVE=1)" },
    ]);
  });

  it("refuses RECORD_FIXTURES=1 without LIVE=1", () => {
    expect(loadError({ RECORD_FIXTURES: "1" }).problems).toEqual([
      { name: "LIVE", issue: "must be 1 when RECORD_FIXTURES=1" },
    ]);
    expect(loadEnv({ RECORD_FIXTURES: "1", LIVE: "1", MODEL_API_KEY: "k" }).RECORD_FIXTURES).toBe(
      true,
    );
  });

  it("gives a one-line error naming MODEL_API_KEY when LIVE=1 and the key is missing", () => {
    const error = loadError({ LIVE: "1" });
    expect(error.message).toBe("Environment: MODEL_API_KEY is missing (required when LIVE=1)");
    expect(error.message).not.toContain("\n");
  });

  it("requires the blob token only for blob storage", () => {
    expect(loadError({ STORAGE_DRIVER: "blob" }).problems.map((p) => p.name)).toEqual([
      "BLOB_READ_WRITE_TOKEN",
    ]);
  });

  it("reports variables a caller requires", () => {
    const error = loadError({}, { require: ["DATABASE_URL", "BASETEN_API_KEY"] });
    expect(error.problems.map((p) => p.name)).toEqual(["BASETEN_API_KEY", "DATABASE_URL"]);
  });

  it("reports every problem at once, sorted by name", () => {
    const error = loadError({ LIVE: "1", SPEND_CAP_USD: "-5", STORAGE_DRIVER: "s3" });
    expect(error.problems.map((p) => p.name)).toEqual([
      "MODEL_API_KEY",
      "SPEND_CAP_USD",
      "STORAGE_DRIVER",
    ]);
  });

  it("rejects a non-Postgres database URL", () => {
    expect(loadError({ DATABASE_URL: "mysql://localhost/db" }).problems[0]?.name).toBe(
      "DATABASE_URL",
    );
  });

  it("ignores variables outside the schema", () => {
    expect(loadEnv({ PATH: "/usr/bin", HOME: "/home/x" })).not.toHaveProperty("PATH");
  });
});

describe("EnvError messages", () => {
  it("never contain the values of invalid variables", () => {
    const values = {
      LIVE: "bad_live_value_9f2c",
      DATABASE_URL: "bad_db_value_4b7e",
      STORAGE_DRIVER: "bad_driver_value_1a8d",
      SPEND_CAP_USD: "bad_cap_value_6c3f",
      BASETEN_SPEND_CAP_USD: "bad_bcap_value_2e9a",
    };
    const error = loadError(values);
    expect(error.problems).toHaveLength(Object.keys(values).length);
    for (const value of Object.values(values)) expect(error.message).not.toContain(value);
  });

  it("never contain an arbitrary invalid value (property)", () => {
    fc.assert(
      fc.property(
        fc.stringMatching(/^[a-z]{16}$/),
        fc.constantFrom("LIVE", "DATABASE_URL", "STORAGE_DRIVER", "SPEND_CAP_USD"),
        (value, name) => {
          const error = loadError({ [name]: value });
          return error.problems.some((p) => p.name === name) && !error.message.includes(value);
        },
      ),
    );
  });
});
