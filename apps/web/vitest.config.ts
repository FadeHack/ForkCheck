import { defineProject } from "vitest/config";

export default defineProject({
  // tsconfig keeps JSX for Next's compiler; tests compile it themselves.
  oxc: { jsx: { runtime: "automatic" } },
  test: {
    name: "web",
    include: ["test/**/*.test.{ts,tsx}"],
  },
});
