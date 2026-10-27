import { z } from "zod";

/** Meta strict-mode limits (R§4.2). */
export const MAX_DEPTH = 10;
export const MAX_PROPERTIES = 5000;

export type JsonSchema = { [key: string]: unknown };

export interface StrictIssue {
  path: string;
  problem: string;
}

export class StrictSchemaError extends Error {
  constructor(
    readonly schemaName: string,
    readonly issues: readonly StrictIssue[],
  ) {
    super(
      `${schemaName} breaks Meta strict mode: ` +
        issues.map((i) => `${i.path || "(root)"}: ${i.problem}`).join("; "),
    );
  }
}

const isSchema = (value: unknown): value is JsonSchema =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * Checks a JSON Schema against Meta's strict rules: every object lists all its keys as required
 * and sets `additionalProperties: false`, nesting is at most MAX_DEPTH, and nothing recurses.
 * Depth counts object and array levels on the deepest path; the root object is level 1.
 */
export function checkStrictRules(root: JsonSchema): StrictIssue[] {
  const issues: StrictIssue[] = [];
  let properties = 0;

  const resolve = (ref: string): JsonSchema | undefined => {
    if (ref === "#") return root;
    if (!ref.startsWith("#/")) return undefined;
    let node: unknown = root;
    for (const part of ref.slice(2).split("/")) {
      node = isSchema(node) ? node[part.replaceAll("~1", "/").replaceAll("~0", "~")] : undefined;
    }
    return isSchema(node) ? node : undefined;
  };

  const walk = (node: JsonSchema, path: string, depth: number, refs: readonly string[]) => {
    if (typeof node.$ref === "string") {
      const ref = node.$ref;
      if (refs.includes(ref)) {
        issues.push({ path, problem: `recursive $ref ${ref}` });
        return;
      }
      const target = resolve(ref);
      if (!target) {
        issues.push({ path, problem: `unresolvable $ref ${ref}` });
        return;
      }
      walk(target, path, depth, [...refs, ref]);
      return;
    }

    const types = Array.isArray(node.type) ? node.type : [node.type];
    const level = types.includes("object") || types.includes("array") ? depth + 1 : depth;
    if (level > MAX_DEPTH) {
      issues.push({ path, problem: `nesting depth ${level} exceeds ${MAX_DEPTH}` });
      return;
    }

    if (types.includes("object")) {
      const props = isSchema(node.properties) ? node.properties : {};
      const keys = Object.keys(props);
      properties += keys.length;
      const required = Array.isArray(node.required) ? node.required : [];
      const optional = keys.filter((k) => !required.includes(k));
      if (optional.length) {
        issues.push({ path, problem: `optional keys ${optional.join(", ")} (use nullable)` });
      }
      if (node.additionalProperties !== false) {
        issues.push({ path, problem: "additionalProperties is not false" });
      }
      for (const key of keys) {
        const child = props[key];
        if (isSchema(child)) walk(child, `${path}.${key}`, level, refs);
      }
    }
    if (isSchema(node.items)) walk(node.items, `${path}[]`, level, refs);
    for (const keyword of ["anyOf", "oneOf", "allOf"] as const) {
      const branches = node[keyword];
      if (Array.isArray(branches)) {
        branches.forEach((b, i) => {
          if (isSchema(b)) walk(b, `${path}<${keyword}${i}>`, depth, refs);
        });
      }
    }
  };

  walk(root, "", 0, ["#"]);
  if (properties > MAX_PROPERTIES) {
    issues.push({ path: "", problem: `${properties} properties exceed ${MAX_PROPERTIES}` });
  }
  return issues;
}

/** The `response_format` schema for a Zod output schema; throws if Meta strict mode would reject it. */
export function toStrictJsonSchema(name: string, schema: z.ZodType): JsonSchema {
  const { $schema: _dialect, ...json } = z.toJSONSchema(schema, { io: "output" }) as JsonSchema;
  const issues = checkStrictRules(json);
  if (issues.length) throw new StrictSchemaError(name, issues);
  return json;
}
