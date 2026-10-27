import type { NextConfig } from "next";

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
