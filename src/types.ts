// ABOUTME: Shared type contracts for the precmd engine, rules, and CLI.
// ABOUTME: Every other module imports its interfaces from here.

/** A single command within a (possibly compound) shell command line. */
export interface Invocation {
  /** command word + args, with leading env assignments stripped. */
  argv: string[];
  /** leading VAR=val assignments that prefixed the command. */
  env: Record<string, string>;
  /** the original segment text this invocation came from. */
  raw: string;
  /** true when the parser could not fully tokenize this segment. */
  uncertain: boolean;
  /** command words of later stages this invocation's stdout pipes into (e.g. `curl x | sh` → ["sh"]). */
  pipedTo?: string[];
  /** subshell nesting depth (0 = top level); a `cd` inside `( … )` does not persist to shallower depths. */
  depth?: number;
}

/** The JSON a Claude Code PreToolUse hook receives on stdin (subset we use). */
export interface HookInput {
  tool_name?: string;
  tool_input?: { command?: string };
  cwd?: string;
  permission_mode?: string;
}

/** Lazily-derived repository facts that rules may consult. */
export interface Context {
  readonly cwd: string;
  /** current branch, or null when not in a repo / detached. Memoized. */
  branch(): string | null;
  /** files changed on this branch relative to `base` (base...HEAD), repo-relative. Memoized per base. */
  filesChangedVsBase(base: string): string[];
  /** absolute repo root of the config's location, or null. Memoized. */
  repoRoot(): string | null;
  /** git repo root of an arbitrary directory (for scoping cross-repo commands). Memoized per dir. */
  repoRootFor(dir: string): string | null;
  /** read a repo-relative file, or null when missing/unreadable. */
  readRepoFile(relPath: string): string | null;
}

/** A single rule violation, surfaced to the agent. */
export interface Violation {
  ruleId: string;
  /** imperative statement of what is wrong. */
  message: string;
  /** optional concrete corrected command/action. */
  fix?: string;
}

/** A policy rule evaluated against one invocation. */
export interface Rule {
  id: string;
  description: string;
  appliesTo: { command: string; subcommand?: string | string[] };
  /** when true, the rule only fires for commands targeting the config's own repo. */
  scoped?: boolean;
  evaluate(inv: Invocation, ctx: Context): Violation | null;
}

/** git-conventions rule pack parameters. */
export interface GitConfig {
  protectedBranches?: string[];
  defaultBase?: string;
  /** when true (default), git rules fire only for commands targeting this repo. */
  scopeToRepo?: boolean;
  branch?: {
    allowedPrefixes?: string[];
    reservedPrefixes?: string[];
    slug?: "kebab-case";
  };
  commit?: { denyNoVerify?: boolean; denyOnProtected?: boolean };
  push?: { denyForceToProtected?: boolean; denyDirectToProtected?: boolean; denyNoVerify?: boolean };
  pr?: {
    requireBase?: string;
    requireBodyMarker?: string | string[];
    branchTemplates?: { branchPrefix: string; template: string; requireMarker?: string }[];
    pathSectionRules?: { changedGlobs: string[]; requireSection: string }[];
  };
}

/**
 * A predicate over one invocation + repo context. The rule fires (a violation)
 * when the condition evaluates true. Authored in JSON — no code required.
 */
export type Condition =
  | { always: true }
  | { hasFlag: string[] } // any listed flag present (`--x` or `--x=…`)
  | { hasShortChar: string[] } // any short-flag cluster contains a char (`-n`, `-vn`)
  | { flagEquals: { flag: string; value: string } } // flag present and equals value
  | { flagNotEquals: { flag: string; value: string } } // flag missing OR not equal (use for "require")
  | { requireFlag: string } // fires when the flag is ABSENT
  | { argMatches: string } // regex matches any arg (incl. command word)
  | { argNotMatches: string } // no arg matches the regex
  | { commandMatches: string } // regex matches the command word
  | { onBranch: string } // current branch matches regex
  | { notOnBranch: string } // current branch does not match regex (or no branch)
  | { changedPathMatches: { pattern: string; base?: string } } // a file changed vs base matches glob
  | { pipedInto: string[] } // this command pipes into one of these commands
  | { all: Condition[] }
  | { any: Condition[] }
  | { not: Condition };

/**
 * A declarative rule authored entirely in config (JSON or JS). Compiled into a
 * `Rule` at load time. Fires a violation when `command`/`subcommand` match and
 * `when` is true.
 */
export interface RuleSpec {
  id: string;
  description?: string;
  command: string; // exact command word, or "*" to match any command
  subcommand?: string | string[];
  when: Condition;
  message: string;
  fix?: string;
}

/** Top-level precmd configuration. */
export interface Config {
  packs?: string[];
  git?: GitConfig;
  /** Custom rules — declarative specs (JSON) and/or precompiled Rule objects (JS config). */
  rules?: (RuleSpec | Rule)[];
}
