import { describe, expect, it } from "vitest";
import { wallTimeToInstant } from "../../src/ui/time";

describe("wallTimeToInstant", () => {
  it("reads the wall time in the given zone", () => {
    expect(wallTimeToInstant("2026-10-26T15:00", "America/New_York")).toBe(
      "2026-10-26T19:00:00.000Z",
    );
    expect(wallTimeToInstant("2026-07-01T09:30", "Asia/Kolkata")).toBe("2026-07-01T04:00:00.000Z");
  });

  it("uses the offset in force on that date, across a DST change", () => {
    expect(wallTimeToInstant("2026-11-02T09:00", "America/New_York")).toBe(
      "2026-11-02T14:00:00.000Z",
    );
  });

  it("returns null for a bad value or an unknown zone", () => {
    expect(wallTimeToInstant("", "UTC")).toBeNull();
    expect(wallTimeToInstant("2026-10-26T15:00", "Mars/Olympus")).toBeNull();
  });
});
