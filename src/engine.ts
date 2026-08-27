// ABOUTME: Matches parsed invocations against rules and collects violations.
// ABOUTME: Pure — all repo IO is behind the injected Context.
import type { Context, Invocation, Rule, Violation } from "./types";

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

/** Whether a rule targets this invocation (command + ordered subcommand prefix). */
export function ruleApplies(rule: Rule, inv: Invocation): boolean {
  if (commandOf(inv) !== rule.appliesTo.command) return false;
  const sub = rule.appliesTo.subcommand;
  if (sub === undefined) return true;
  const want = Array.isArray(sub) ? sub : [sub];
  const got = subcommandTokens(inv);
  return want.every((w, i) => got[i] === w);
}

/** Run every matching rule against every invocation; collect all violations. */
export function evaluate(invocations: Invocation[], rules: Rule[], ctx: Context): Violation[] {
  const violations: Violation[] = [];
  for (const inv of invocations) {
    for (const rule of rules) {
      if (!ruleApplies(rule, inv)) continue;
      const v = rule.evaluate(inv, ctx);
      if (v) violations.push(v);
    }
  }
  return violations;
}
