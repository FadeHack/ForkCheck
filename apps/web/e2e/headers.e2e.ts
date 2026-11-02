import { expect, test } from "@playwright/test";

test.skip(({ isMobile }) => isMobile, "Headers don't depend on the device");

test("every page and API response carries the security headers", async ({ request }) => {
  for (const path of ["/", "/p/not-a-real-token", "/api/p/not-a-real-token"]) {
    const res = await request.get(path);
    const h = res.headers();
    expect(h["x-content-type-options"], path).toBe("nosniff");
    expect(h["x-frame-options"], path).toBe("DENY");
    expect(h["content-security-policy"], path).toContain("frame-ancestors 'none'");
    expect(h["x-powered-by"], path).toBeUndefined();
  }
});

test("participant pages and their API send no referrer and are not cached", async ({ request }) => {
  for (const path of ["/p/not-a-real-token", "/api/p/not-a-real-token"]) {
    const h = (await request.get(path)).headers();
    expect(h["referrer-policy"], path).toBe("no-referrer");
    expect(h["cache-control"], path).toContain("no-store");
  }
  expect((await request.get("/")).headers()["referrer-policy"]).toBe(
    "strict-origin-when-cross-origin",
  );
});
