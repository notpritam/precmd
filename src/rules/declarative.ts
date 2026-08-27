// ABOUTME: Config-driven rule factories for common flag/value checks.
// ABOUTME: Context-aware checks (branch, force-push, PR body) live in the packs.
import { flagValue, hasFlag, hasShortFlagChar } from "../argv";
import type { Rule } from "../types";

/** Block when any banned flag (or short-flag char, fail-closed) is present. */
export function denyFlag(o: {
  id: string;
  description: string;
  command: string;
  subcommand?: string | string[];
  flags: string[];
  shortChars?: string[];
  message: string;
  fix?: string;
}): Rule {
  return {
    id: o.id,
    description: o.description,
    appliesTo: { command: o.command, subcommand: o.subcommand },
    evaluate(inv) {
      const present =
        hasFlag(inv.argv, o.flags) || (o.shortChars ?? []).some((c) => hasShortFlagChar(inv.argv, c));
      if (!present) return null;
      return o.fix ? { ruleId: o.id, message: o.message, fix: o.fix } : { ruleId: o.id, message: o.message };
    },
  };
}

/** Require a flag to equal an exact value; a missing flag also violates. */
export function requireFlagValue(o: {
  id: string;
  description: string;
  command: string;
  subcommand?: string | string[];
  flag: string;
  equals: string;
  message?: string;
}): Rule {
  return {
    id: o.id,
    description: o.description,
    appliesTo: { command: o.command, subcommand: o.subcommand },
    evaluate(inv) {
      const value = flagValue(inv.argv, o.flag);
      if (value === o.equals) return null;
      const detail = value === null ? "it was omitted" : `got "${value}"`;
      const message = o.message ?? `${o.flag} must be "${o.equals}" (${detail}).`;
      return { ruleId: o.id, message, fix: `${o.flag} ${o.equals}` };
    },
  };
}
