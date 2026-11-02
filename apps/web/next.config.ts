import { loadLocalEnvFile } from "@forkcheck/config";
import type { NextConfig } from "next";
import { securityHeaders, tokenPathHeaders } from "./src/server/security-headers";

// Next reads env files only from apps/web; the shared .env.local sits at the repo root.
loadLocalEnvFile();

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // The dev badge sits over the page and ends up in screenshots and the demo video.
  devIndicators: false,
  // When two entries set the same header, the later one wins, and it also beats a header the
  // route sets itself: token paths keep no-referrer.
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders(process.env.NODE_ENV !== "production") },
      { source: "/p/:path*", headers: tokenPathHeaders },
      { source: "/api/:path*", headers: tokenPathHeaders },
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
