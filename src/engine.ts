// ABOUTME: Matches parsed invocations against rules and collects violations.
// ABOUTME: Rules are indexed by command word; scoped rules only fire for the config's repo.
import { resolve } from "node:path";
import type { Context, Invocation, Rule, Violation } from "./types";

/** The directory a git command operates on, honoring any `-C <path>` options. */
export function gitEffectiveDir(inv: Invocation, baseCwd: string): string {
  let dir = baseCwd;
  for (let i = 1; i < inv.argv.length; i++) {
    if (inv.argv[i] === "-C" && inv.argv[i + 1]) {
      dir = resolve(dir, inv.argv[i + 1]!);
      i++;
    }
  }
  return dir;
}

/** The command word of an invocation, or null. */
export function commandOf(inv: Invocation): string | null {
  return inv.argv[0] ?? null;
}

/** Leading positional args after the command word, up to the first flag. */
export function subcommandTokens(inv: Invocation): string[] {
  const out: string[] = [];
  for (let i = 1; i < inv.argv.length; i++) {
    const t = inv.argv[i]!;
    if (t.startsWith("-")) break;
    out.push(t);
  }
  return out;
}

/** Whether a rule targets this invocation (command or `*`, plus ordered subcommand prefix). */
export function ruleApplies(rule: Rule, inv: Invocation): boolean {
  const cmd = commandOf(inv);
  if (rule.appliesTo.command !== "*" && cmd !== rule.appliesTo.command) return false;
  const sub = rule.appliesTo.subcommand;
  if (sub === undefined) return true;
  const want = Array.isArray(sub) ? sub : [sub];
  const got = subcommandTokens(inv);
  return want.every((w, i) => got[i] === w);
}

export interface RuleIndex {
  byCommand: Map<string, Rule[]>;
  wildcard: Rule[];
}

/** Bucket rules by their target command so evaluation touches only relevant rules. */
export function indexRules(rules: Rule[]): RuleIndex {
  const byCommand = new Map<string, Rule[]>();
  const wildcard: Rule[] = [];
  for (const rule of rules) {
    if (rule.appliesTo.command === "*") {
      wildcard.push(rule);
      continue;
    }
    const list = byCommand.get(rule.appliesTo.command);
    if (list) list.push(rule);
    else byCommand.set(rule.appliesTo.command, [rule]);
  }
  return { byCommand, wildcard };
}

/** Run every matching rule against every invocation; collect all violations. */
export function evaluate(invocations: Invocation[], rules: Rule[], ctx: Context): Violation[] {
  if (rules.length === 0) return [];
  const index = indexRules(rules);
  const hasScoped = rules.some((r) => r.scoped);
  const configRepo = hasScoped ? ctx.repoRoot() : null;
  let runningCwd = ctx.cwd;
  const violations: Violation[] = [];
  for (const inv of invocations) {
    // Track cwd across sequential stages so `cd other && git …` targets the right repo.
    if (inv.argv[0] === "cd" && inv.argv[1]) runningCwd = resolve(runningCwd, inv.argv[1]!);
    const cmd = commandOf(inv);
    if (cmd === null) continue;
    const direct = index.byCommand.get(cmd);
    const buckets = direct ? [direct, index.wildcard] : [index.wildcard];
    let targetRepo: string | null | undefined; // resolved lazily, once per invocation
    for (const bucket of buckets) {
      for (const rule of bucket) {
        if (!ruleApplies(rule, inv)) continue;
        if (rule.scoped && configRepo) {
          if (targetRepo === undefined) targetRepo = ctx.repoRootFor(gitEffectiveDir(inv, runningCwd));
          if (targetRepo && targetRepo !== configRepo) continue; // command targets another repo
        }
        const v = rule.evaluate(inv, ctx);
        if (v) violations.push(v);
      }
    }
  }
  return violations;
}
