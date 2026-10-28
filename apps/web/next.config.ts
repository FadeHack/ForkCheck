import { loadLocalEnvFile } from "@forkcheck/config";
import type { NextConfig } from "next";

// Next reads env files only from apps/web; the shared .env.local sits at the repo root.
loadLocalEnvFile();

const nextConfig: NextConfig = {
  // Participant pages carry their token in the path.
  async headers() {
    return [
      {
        source: "/p/:path*",
        headers: [
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "Cache-Control", value: "no-store" },
        ],
      },
    ];
  },
  // The dev request log prints paths, and these paths contain participant tokens.
  logging: { incomingRequests: { ignore: [/^\/(?:api\/)?p\//] } },
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
