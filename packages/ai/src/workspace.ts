import { findWorkspaceRoot } from "@forkcheck/config";

// From the working directory, not import.meta.url: the app bundler moves this module.
export const workspaceRoot = findWorkspaceRoot() ?? process.cwd();
