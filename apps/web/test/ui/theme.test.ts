import { describe, expect, it } from "vitest";
import { parseTheme, THEME_KEY, THEME_SCRIPT } from "../../src/ui/theme-script";

/** Runs the inline script against a stand-in document and storage. */
function runScript(stored: string | null, storageThrows = false) {
  const root = { dataset: {} as Record<string, string> };
  const localStorage = {
    getItem: (key: string) => {
      if (storageThrows) throw new Error("blocked");
      return key === THEME_KEY ? stored : null;
    },
  };
  new Function("localStorage", "document", THEME_SCRIPT)(localStorage, { documentElement: root });
  return root.dataset.theme;
}

describe("theme", () => {
  it("treats anything but light or dark as following the system", () => {
    expect(parseTheme("dark")).toBe("dark");
    expect(parseTheme("light")).toBe("light");
    expect(parseTheme(null)).toBe("system");
    expect(parseTheme("sepia")).toBe("system");
  });

  it("applies a stored choice before paint and otherwise leaves the system setting", () => {
    expect(runScript("dark")).toBe("dark");
    expect(runScript("light")).toBe("light");
    expect(runScript(null)).toBeUndefined();
    expect(runScript("<script>")).toBeUndefined();
  });

  it("survives blocked storage", () => {
    expect(runScript("dark", true)).toBeUndefined();
  });
});
