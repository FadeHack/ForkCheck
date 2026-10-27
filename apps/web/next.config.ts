import { loadLocalEnvFile } from "@forkcheck/config";
import type { NextConfig } from "next";

// Next reads env files only from apps/web; the shared .env.local sits at the repo root.
loadLocalEnvFile();

const nextConfig: NextConfig = {
  transpilePackages: [
    "@forkcheck/ai",
    "@forkcheck/asr",
    "@forkcheck/config",
    "@forkcheck/core",
    "@forkcheck/db",
    "@forkcheck/engine",
  ],
};

export default nextConfig;
