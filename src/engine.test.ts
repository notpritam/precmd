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

test("subcommandTokens skips git global options", () => {
  expect(subcommandTokens(inv(["git", "-C", "/x", "commit", "-m", "y"]))).toEqual(["commit"]);
  expect(subcommandTokens(inv(["git", "-c", "a.b=c", "commit"]))).toEqual(["commit"]);
  expect(subcommandTokens(inv(["git", "--git-dir=/x", "push"]))).toEqual(["push"]);
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
  const echo: Rule = {
    id: "w",
    description: "w",
    appliesTo: { command: "*" },
    evaluate: (i) => ({ ruleId: "w", message: i.argv[0]! }),
  };
  const out = evaluate([inv(["foo"]), inv(["bar"])], [echo], {} as never);
  expect(out.map((v) => v.message)).toEqual(["foo", "bar"]);
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

test("a throwing rule is skipped, other rules still fire (finding R1)", () => {
  const boom: Rule = {
    id: "boom",
    description: "boom",
    appliesTo: { command: "git" },
    evaluate: () => {
      throw new Error("kaboom");
    },
  };
  const good = mk("ok", { command: "git", subcommand: "commit" });
  const out = evaluate([inv(["git", "commit"])], [boom, good], {} as never);
  expect(out.map((v) => v.ruleId)).toEqual(["ok"]);
});
