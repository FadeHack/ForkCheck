/**
 * Package boundaries. Workspace imports resolve through node_modules symlinks
 * to packages/<name>/src, so every rule matches on source paths.
 * @type {import('dependency-cruiser').IConfiguration}
 */
const pkg = (names) => `^packages/(${names.join("|")})/`;
const all = ["core", "config", "ai", "engine", "asr", "db", "eval"];
const except = (...allowed) => all.filter((name) => !allowed.includes(name));

/** A package may import only itself and the listed packages. */
const onlyImports = (from, allowed) => ({
  name: `${from}-boundary`,
  comment: `${from} may import only: ${allowed.length ? allowed.join(", ") : "nothing internal"}`,
  severity: "error",
  from: { path: pkg([from]) },
  to: { path: [pkg(except(from, ...allowed)), "^apps/"] },
});

module.exports = {
  forbidden: [
    {
      name: "no-circular",
      severity: "error",
      from: {},
      to: { circular: true },
    },
    onlyImports("core", []),
    onlyImports("config", []),
    onlyImports("ai", ["core", "config"]),
    onlyImports("engine", ["core", "ai"]),
    onlyImports("asr", ["config"]),
    onlyImports("db", ["core", "config"]),
    onlyImports("eval", ["core", "config", "ai", "engine", "asr"]),
    {
      name: "web-no-eval",
      severity: "error",
      from: { path: "^apps/web/" },
      to: { path: pkg(["eval"]) },
    },
    {
      name: "core-no-io",
      comment: "core is pure: no filesystem, network, process or OS access",
      severity: "error",
      from: { path: pkg(["core"]) },
      to: {
        dependencyTypes: ["core"],
        path: "^(node:)?(fs|fs/promises|net|http|https|http2|child_process|dgram|dns|tls|os|worker_threads|cluster|process)$",
      },
    },
    {
      name: "baseten-eval-only",
      comment: "The Baseten provider is for the eval comparison only",
      severity: "error",
      from: {
        pathNot: ["^packages/eval/", "^packages/ai/src/providers/baseten", "^packages/ai/test/"],
      },
      to: { path: "^packages/ai/src/providers/baseten" },
    },
    {
      name: "not-to-unresolvable",
      severity: "error",
      from: {},
      to: { couldNotResolve: true },
    },
  ],
  options: {
    doNotFollow: { path: "node_modules" },
    exclude: { path: ["(^|/)(\\.next|node_modules)/", "next-env\\.d\\.ts$"] },
    tsPreCompilationDeps: true,
    combinedDependencies: true,
    enhancedResolveOptions: {
      exportsFields: ["exports"],
      conditionNames: ["import", "types", "default"],
      extensions: [".ts", ".tsx", ".js", ".mjs", ".cjs", ".json"],
    },
    reporterOptions: {
      text: { highlightFocused: true },
    },
  },
};
