import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { findWorkspaceRoot, loadLocalEnvFile, type EnvSource } from "../src/index";

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "forkcheck-env-"));
  writeFileSync(join(root, "pnpm-workspace.yaml"), "packages: []\n");
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("findWorkspaceRoot", () => {
  it("walks up from a nested directory", () => {
    const nested = join(root, "packages", "config", "src");
    mkdirSync(nested, { recursive: true });
    expect(findWorkspaceRoot(nested)).toBe(root);
  });
});

describe("loadLocalEnvFile", () => {
  it("fills unset variables and keeps ones already set", () => {
    writeFileSync(join(root, ".env.local"), "MODEL_API_KEY=from-file\nAUDIO_DIR=from-file\n");
    const target: EnvSource = { AUDIO_DIR: "from-shell" };

    expect(loadLocalEnvFile(target, root)).toBe(join(root, ".env.local"));
    expect(target).toEqual({ MODEL_API_KEY: "from-file", AUDIO_DIR: "from-shell" });
  });

  it("does nothing when the file is absent", () => {
    const target: EnvSource = {};
    expect(loadLocalEnvFile(target, root)).toBeUndefined();
    expect(target).toEqual({});
  });
});
