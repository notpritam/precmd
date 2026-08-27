// ABOUTME: Tests for rule matching and multi-violation evaluation.
// ABOUTME: Uses trivial always-fire rules to isolate matching semantics.
import { expect, test } from "vitest";
import { evaluate, ruleApplies, subcommandTokens } from "./engine";
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
