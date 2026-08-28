// ABOUTME: Compiles declarative JSON rule specs into executable Rule objects.
// ABOUTME: Regexes compile once; malformed specs throw and are skipped by callers.
import { flagValue, hasFlag, hasShortFlagChar } from "../argv";
import { globMatch } from "../glob";
import type { Condition, Context, Invocation, Rule, RuleSpec } from "../types";

type Pred = (inv: Invocation, ctx: Context) => boolean;

function assertStringArray(v: unknown, key: string): asserts v is string[] {
  if (!Array.isArray(v) || v.some((x) => typeof x !== "string")) {
    throw new Error(`${key} must be an array of strings`);
  }
}

function compileRegex(src: unknown, key: string): RegExp {
  if (typeof src !== "string") throw new Error(`${key} must be a string regex`);
  try {
    return new RegExp(src);
  } catch (e) {
    throw new Error(`${key} is not a valid regex: ${(e as Error).message}`);
  }
}

/** Compile a condition tree into a predicate. Throws on malformed input. */
export function compileCondition(cond: Condition): Pred {
  if (cond === null || typeof cond !== "object") throw new Error("condition must be an object");

  if ("always" in cond) return () => true;
  if ("hasFlag" in cond) {
    assertStringArray(cond.hasFlag, "hasFlag");
    const flags = cond.hasFlag;
    return (inv) => hasFlag(inv.argv, flags);
  }
  if ("hasShortChar" in cond) {
    assertStringArray(cond.hasShortChar, "hasShortChar");
    const chars = cond.hasShortChar;
    return (inv) => chars.some((c) => hasShortFlagChar(inv.argv, c));
  }
  if ("flagEquals" in cond) {
    const { flag, value } = cond.flagEquals;
    return (inv) => flagValue(inv.argv, flag) === value;
  }
  if ("flagNotEquals" in cond) {
    const { flag, value } = cond.flagNotEquals;
    return (inv) => flagValue(inv.argv, flag) !== value;
  }
  if ("requireFlag" in cond) {
    const flag = cond.requireFlag;
    return (inv) => !hasFlag(inv.argv, [flag]);
  }
  if ("argMatches" in cond) {
    const re = compileRegex(cond.argMatches, "argMatches");
    return (inv) => inv.argv.some((a) => re.test(a));
  }
  if ("argNotMatches" in cond) {
    const re = compileRegex(cond.argNotMatches, "argNotMatches");
    return (inv) => !inv.argv.some((a) => re.test(a));
  }
  if ("commandMatches" in cond) {
    const re = compileRegex(cond.commandMatches, "commandMatches");
    return (inv) => re.test(inv.argv[0] ?? "");
  }
  if ("onBranch" in cond) {
    const re = compileRegex(cond.onBranch, "onBranch");
    return (_inv, ctx) => {
      const b = ctx.branch();
      return b !== null && re.test(b);
    };
  }
  if ("notOnBranch" in cond) {
    const re = compileRegex(cond.notOnBranch, "notOnBranch");
    return (_inv, ctx) => {
      const b = ctx.branch();
      return b === null || !re.test(b);
    };
  }
  if ("changedPathMatches" in cond) {
    const { pattern, base } = cond.changedPathMatches;
    if (typeof pattern !== "string") throw new Error("changedPathMatches.pattern must be a string");
    return (_inv, ctx) => ctx.filesChangedVsBase(base ?? "main").some((f) => globMatch(pattern, f));
  }
  if ("pipedInto" in cond) {
    assertStringArray(cond.pipedInto, "pipedInto");
    const cmds = cond.pipedInto;
    return (inv) => (inv.pipedTo ?? []).some((c) => cmds.includes(c));
  }
  if ("all" in cond) {
    const preds = cond.all.map(compileCondition);
    return (inv, ctx) => preds.every((p) => p(inv, ctx));
  }
  if ("any" in cond) {
    const preds = cond.any.map(compileCondition);
    return (inv, ctx) => preds.some((p) => p(inv, ctx));
  }
  if ("not" in cond) {
    const pred = compileCondition(cond.not);
    return (inv, ctx) => !pred(inv, ctx);
  }

  throw new Error(`unknown condition: {${Object.keys(cond).join(", ")}}`);
}

/** Compile a single declarative rule spec into a Rule. Throws on invalid spec. */
export function compileRule(spec: RuleSpec): Rule {
  if (!spec || typeof spec !== "object") throw new Error("rule spec must be an object");
  if (typeof spec.id !== "string" || !spec.id) throw new Error("rule spec needs a string id");
  if (typeof spec.command !== "string" || !spec.command) {
    throw new Error(`rule "${spec.id}" needs a string command`);
  }
  if (typeof spec.message !== "string" || !spec.message) {
    throw new Error(`rule "${spec.id}" needs a message`);
  }
  if (!spec.when || typeof spec.when !== "object") {
    throw new Error(`rule "${spec.id}" needs a when condition`);
  }
  const pred = compileCondition(spec.when);
  return {
    id: spec.id,
    description: spec.description ?? spec.id,
    appliesTo: { command: spec.command, subcommand: spec.subcommand },
    evaluate(inv, ctx) {
      if (!pred(inv, ctx)) return null;
      return spec.fix
        ? { ruleId: spec.id, message: spec.message, fix: spec.fix }
        : { ruleId: spec.id, message: spec.message };
    },
  };
}

/** A pre-built Rule has an `evaluate` function; anything else is treated as a spec to compile. */
export function isRuleSpec(x: RuleSpec | Rule): x is RuleSpec {
  return typeof (x as Rule).evaluate !== "function";
}

/** Compile a mix of specs and Rules, collecting per-rule errors instead of throwing. */
export function compileRules(entries: (RuleSpec | Rule)[]): { rules: Rule[]; errors: string[] } {
  const rules: Rule[] = [];
  const errors: string[] = [];
  for (const entry of entries) {
    if (!isRuleSpec(entry)) {
      rules.push(entry as Rule);
      continue;
    }
    try {
      rules.push(compileRule(entry));
    } catch (e) {
      errors.push((e as Error).message);
    }
  }
  return { rules, errors };
}
