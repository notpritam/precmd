// ABOUTME: Tests for rule matching and multi-violation evaluation.
// ABOUTME: Uses trivial always-fire rules to isolate matching semantics.
import { expect, test } from "vitest";
import { createStaticContext } from "./context";
import { evaluate, ruleApplies, subcommandTokens } from "./engine";
import { parseCommand } from "./parse";
import type { Rule } from "./types";

const inv = (argv: string[]) => ({ argv, env: {}, raw: argv.join(" "), uncertain: false });
const mk = (id: string, applies: Rule["appliesTo"]): Rule => ({
  id,
  description: id,
  appliesTo: applies,
  evaluate: () => ({ ruleId: id, message: id }),
});

test("subcommandTokens stops at first flag", () => {
  expect(subcommandTokens(inv(["gh", "pr", "create", "--base", "x"]))).toEqual(["pr", "create"]);
});

test("array subcommand is an ordered prefix", () => {
  expect(ruleApplies(mk("r", { command: "gh", subcommand: ["pr", "create"] }), inv(["gh", "pr", "create"]))).toBe(
    true,
  );
  expect(ruleApplies(mk("r", { command: "gh", subcommand: ["pr", "create"] }), inv(["gh", "pr", "list"]))).toBe(
    false,
  );
});

test("string subcommand matches first token", () => {
  expect(ruleApplies(mk("r", { command: "git", subcommand: "commit" }), inv(["git", "commit", "-m", "x"]))).toBe(
    true,
  );
});

test("evaluate collects all violations across invocations", () => {
  const rules = [mk("a", { command: "git", subcommand: "commit" }), mk("b", { command: "git", subcommand: "push" })];
  const out = evaluate([inv(["git", "commit"]), inv(["git", "push"])], rules, {} as never);
  expect(out.map((v) => v.ruleId)).toEqual(["a", "b"]);
});

test("wildcard command rule applies to any command", () => {
  const r = mk("w", { command: "*" });
  expect(ruleApplies(r, inv(["anything", "x"]))).toBe(true);
  const out = evaluate([inv(["foo"]), inv(["bar"])], [r], {} as never);
  expect(out.map((v) => v.ruleId)).toEqual(["w", "w"]);
});

test("scoped rules skip commands targeting another repo (via cd or -C)", () => {
  const scopedRule: Rule = {
    id: "s",
    description: "s",
    appliesTo: { command: "git", subcommand: "push" },
    scoped: true,
    evaluate: () => ({ ruleId: "s", message: "s" }),
  };
  const ctx = createStaticContext({
    cwd: "/repoA",
    repoRoot: "/repoA",
    repoRoots: { "/repoA": "/repoA", "/repoB": "/repoB" },
  });
  expect(evaluate(parseCommand("git push origin main"), [scopedRule], ctx).map((v) => v.ruleId)).toEqual(["s"]);
  expect(evaluate(parseCommand("git -C /repoB push origin main"), [scopedRule], ctx)).toEqual([]);
  expect(evaluate(parseCommand("cd /repoB && git push origin main"), [scopedRule], ctx)).toEqual([]);
});
