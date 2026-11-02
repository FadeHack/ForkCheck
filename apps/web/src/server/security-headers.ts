import { tokenRouteHeaders } from "./http";

/**
 * Headers for every page and API response. Everything the app loads comes from its own origin;
 * recordings play from blob: URLs. Next's inline bootstrap scripts need 'unsafe-inline', and its
 * dev server also needs eval and a websocket for hot reload.
 */
export function securityHeaders(dev: boolean): { key: string; value: string }[] {
  const csp = [
    "default-src 'self'",
    `script-src 'self' 'unsafe-inline'${dev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "media-src 'self' blob:",
    "font-src 'self'",
    `connect-src 'self'${dev ? " ws: wss:" : ""}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join("; ");
  return [
    { key: "Content-Security-Policy", value: csp },
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "X-Frame-Options", value: "DENY" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
    { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  ];
}

/**
 * For participant pages, which carry their token in the path, and the API, which carries
 * tokens in paths and headers: no referrer, no caching.
 */
export const tokenPathHeaders = Object.entries(tokenRouteHeaders).map(([key, value]) => ({
  key,
  value,
}));
