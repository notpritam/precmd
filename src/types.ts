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
  /** paths changed vs HEAD (staged + unstaged + untracked), repo-relative. Memoized. */
  changedFiles(): string[];
  /** absolute repo root, or null. Memoized. */
  repoRoot(): string | null;
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
  evaluate(inv: Invocation, ctx: Context): Violation | null;
}

/** git-conventions rule pack parameters. */
export interface GitConfig {
  protectedBranches?: string[];
  defaultBase?: string;
  branch?: {
    allowedPrefixes?: string[];
    reservedPrefixes?: string[];
    slug?: "kebab-case";
  };
  commit?: { denyNoVerify?: boolean };
  push?: { denyForceToProtected?: boolean; denyNoVerify?: boolean };
  pr?: {
    requireBase?: string;
    requireBodyMarker?: string | string[];
    branchTemplates?: { branchPrefix: string; template: string }[];
    pathSectionRules?: { changedGlobs: string[]; requireSection: string }[];
  };
}

/** Top-level precmd configuration. */
export interface Config {
  packs?: string[];
  git?: GitConfig;
  rules?: Rule[];
}
