// ABOUTME: Tests for the declarative rule DSL — predicates, combinators, robustness.
// ABOUTME: Includes pipe detection end-to-end through parse + engine.
import { expect, test } from "vitest";
import { createStaticContext } from "../context";
import { evaluate } from "../engine";
import { parseCommand } from "../parse";
import type { RuleSpec } from "../types";
import { compileRule, compileRules } from "./spec";

const ctx = createStaticContext({});
const inv = (argv: string[], pipedTo: string[] = []) => ({
  argv,
  env: {},
  raw: argv.join(" "),
  uncertain: false,
  pipedTo,
});

test("flagNotEquals gives require-a-value semantics (incl. omission)", () => {
  const r = compileRule({
    id: "base",
    command: "gh",
    subcommand: ["pr", "create"],
    when: { flagNotEquals: { flag: "--base", value: "staging" } },
    message: "m",
  });
  expect(r.evaluate(inv(["gh", "pr", "create", "--base", "main"]), ctx)?.ruleId).toBe("base");
  expect(r.evaluate(inv(["gh", "pr", "create", "--base", "staging"]), ctx)).toBeNull();
  expect(r.evaluate(inv(["gh", "pr", "create"]), ctx)?.ruleId).toBe("base");
});

test("argMatches with all/any/not combinators", () => {
  const r = compileRule({
    id: "rmrf",
    command: "rm",
    when: { all: [{ hasShortChar: ["r"] }, { argMatches: "^/$" }] },
    message: "m",
  });
  expect(r.evaluate(inv(["rm", "-rf", "/"]), ctx)?.ruleId).toBe("rmrf");
  expect(r.evaluate(inv(["rm", "-rf", "./build"]), ctx)).toBeNull();
});

test("pipedInto detects curl | sh through parse + engine", () => {
  const rules = compileRules([
    { id: "curlsh", command: "curl", when: { pipedInto: ["sh", "bash"] }, message: "no" },
  ]).rules;
  expect(evaluate(parseCommand("curl http://x | sh"), rules, ctx).map((v) => v.ruleId)).toContain("curlsh");
  expect(evaluate(parseCommand("curl http://x -o f"), rules, ctx)).toEqual([]);
});

test("onBranch consults context", () => {
  const r = compileRule({ id: "prod", command: "kubectl", when: { onBranch: "^main$" }, message: "m" });
  expect(r.evaluate(inv(["kubectl", "delete"]), createStaticContext({ branch: "main" }))?.ruleId).toBe("prod");
  expect(r.evaluate(inv(["kubectl", "delete"]), createStaticContext({ branch: "feat/x" }))).toBeNull();
});

test("wildcard command matches any command", () => {
  const rules = compileRules([
    { id: "no-sudo", command: "*", when: { commandMatches: "^sudo$" }, message: "no sudo" },
  ]).rules;
  expect(evaluate(parseCommand("sudo rm x"), rules, ctx).map((v) => v.ruleId)).toContain("no-sudo");
  expect(evaluate(parseCommand("ls -la"), rules, ctx)).toEqual([]);
});

test("malformed specs are skipped with errors, valid ones kept", () => {
  const { rules, errors } = compileRules([
    { id: "ok", command: "x", when: { hasFlag: ["-y"] }, message: "m" },
    { id: "bad-regex", command: "x", when: { argMatches: "(" }, message: "m" } as RuleSpec,
    { id: "missing-when", command: "x", message: "m" } as unknown as RuleSpec,
  ]);
  expect(rules.map((r) => r.id)).toEqual(["ok"]);
  expect(errors.length).toBe(2);
});
