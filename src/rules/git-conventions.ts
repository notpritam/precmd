// ABOUTME: Built-in git/gh/PR convention rule pack, assembled from GitConfig.
// ABOUTME: Combines declarative factories with context-aware programmatic rules.
import { flagValue, hasFlag, positionals } from "../argv";
import { gitArgv } from "../engine";
import { globMatch } from "../glob";
import type { Context, GitConfig, Invocation, Rule } from "../types";
import { denyFlag } from "./declarative";

const DEFAULT_ALLOWED_PREFIXES = [
  "feat",
  "fix",
  "bug",
  "chore",
  "refactor",
  "test",
  "docs",
  "ci",
  "exp",
  "hotfix",
  "revert",
];

const FORCE_FLAGS = ["--force", "-f", "--force-with-lease", "--force-if-includes"];

/** Build the git-conventions rules enabled by the given config. */
export function buildGitConventionsPack(git: GitConfig): Rule[] {
  const rules: Rule[] = [];

  if (git.commit?.denyNoVerify) {
    rules.push(
      denyFlag({
        id: "commit-no-verify",
        description: "git commit must not bypass hooks",
        command: "git",
        subcommand: "commit",
        flags: ["--no-verify"],
        shortChars: ["n"],
        message: "git commit --no-verify is banned — commits must pass the pre-commit hook.",
        fix: "remove --no-verify / -n and fix what the hook reports",
      }),
    );
    rules.push(
      denyFlag({
        id: "merge-no-verify",
        description: "git merge must not bypass hooks",
        command: "git",
        subcommand: "merge",
        flags: ["--no-verify"],
        message: "git merge --no-verify is banned — merge commits must pass the hooks too.",
        fix: "remove --no-verify",
      }),
    );
    rules.push(
      denyFlag({
        id: "pull-no-verify",
        description: "git pull (merge) must not bypass hooks",
        command: "git",
        subcommand: "pull",
        flags: ["--no-verify"],
        message: "git pull --no-verify is banned — a pull that merges must pass the hooks too.",
        fix: "remove --no-verify",
      }),
    );
  }

  if (git.commit?.denyOnProtected) {
    rules.push(commitOnProtectedRule(git.protectedBranches ?? ["main"]));
  }

  if (git.push?.denyNoVerify) {
    rules.push(
      denyFlag({
        id: "push-no-verify",
        description: "git push must not bypass the pre-push hook",
        command: "git",
        subcommand: "push",
        flags: ["--no-verify"],
        message: "git push --no-verify is banned — pushes must pass the pre-push hook.",
        fix: "remove --no-verify",
      }),
    );
  }

  if (git.branch) {
    rules.push(
      branchNameRule(
        git.branch.allowedPrefixes ?? DEFAULT_ALLOWED_PREFIXES,
        git.branch.reservedPrefixes ?? [],
        git.branch.slug === "kebab-case",
      ),
    );
  }

  if (git.push?.denyForceToProtected) {
    rules.push(pushForceRule(git.protectedBranches ?? ["main"]));
  }

  if (git.push?.denyDirectToProtected) {
    rules.push(pushDirectRule(git.protectedBranches ?? ["main"]));
  }

  if (git.pr?.requireBase) {
    rules.push(prBaseRule(git.pr.requireBase));
    rules.push(prEditBaseRule(git.pr.requireBase));
  }

  const markers = normalizeMarkers(git.pr?.requireBodyMarker);
  if (markers.length) {
    rules.push(prMarkerRule(markers));
    rules.push(prEditMarkerRule(markers));
  }

  if (git.pr?.branchTemplates?.length) rules.push(prTemplateRule(git.pr.branchTemplates));

  if (git.pr?.pathSectionRules?.length) {
    const base = git.pr.requireBase ?? git.defaultBase ?? git.protectedBranches?.[0] ?? "main";
    rules.push(prPathSectionRule(git.pr.pathSectionRules, base));
  }

  // Scope git rules to this repo by default so cross-repo commands aren't false-blocked.
  if (git.scopeToRepo === false) return rules;
  return rules.map((r) => ({ ...r, scoped: true }));
}

function normalizeMarkers(m?: string | string[]): string[] {
  if (!m) return [];
  return Array.isArray(m) ? m : [m];
}

/** Resolve the PR body text from --body/-b and --body-file/-F (file read via context). */
function prBody(inv: Invocation, ctx: Context): string {
  const direct = flagValue(inv.argv, "--body") ?? flagValue(inv.argv, "-b");
  const file = flagValue(inv.argv, "--body-file") ?? flagValue(inv.argv, "-F");
  let text = direct ?? "";
  if (file) text += "\n" + (ctx.readRepoFile(file) ?? "");
  return text;
}

/** The PR's head branch: --head/-H when supplied, else the current branch. */
function prHeadBranch(inv: Invocation, ctx: Context): string | null {
  return flagValue(inv.argv, "--head") ?? flagValue(inv.argv, "-H") ?? ctx.branch();
}

/** The requested PR base from --base/-B. */
function prBaseValue(inv: Invocation): string | null {
  return flagValue(inv.argv, "--base") ?? flagValue(inv.argv, "-B");
}

/** Whether a gh pr command sets a body (any of --body/-b/--body-file/-F). */
function prSetsBody(inv: Invocation): boolean {
  return (
    flagValue(inv.argv, "--body") !== null ||
    flagValue(inv.argv, "-b") !== null ||
    flagValue(inv.argv, "--body-file") !== null ||
    flagValue(inv.argv, "-F") !== null
  );
}

/** True when the body is piped via `--body-file -` / `-F -` (stdin) with no inline body — unverifiable. */
function prBodyFromStdin(inv: Invocation): boolean {
  const file = flagValue(inv.argv, "--body-file") ?? flagValue(inv.argv, "-F");
  const inline = flagValue(inv.argv, "--body") ?? flagValue(inv.argv, "-b");
  return file === "-" && inline === null;
}

function prBaseRule(requireBase: string): Rule {
  return {
    id: "pr-base",
    description: "PRs must target the integration branch",
    appliesTo: { command: "gh", subcommand: ["pr", "create"] },
    evaluate(inv) {
      const base = prBaseValue(inv);
      if (base === requireBase) return null;
      const detail = base === null ? "it was omitted" : `got "${base}"`;
      return {
        ruleId: "pr-base",
        message: `gh pr create must target "${requireBase}" (${detail}).`,
        fix: `--base ${requireBase}`,
      };
    },
  };
}

function prEditBaseRule(requireBase: string): Rule {
  return {
    id: "pr-edit-base",
    description: "gh pr edit must not retarget the base to a non-integration branch",
    appliesTo: { command: "gh", subcommand: ["pr", "edit"] },
    evaluate(inv) {
      const base = prBaseValue(inv);
      if (base === null || base === requireBase) return null; // only fires when the base is explicitly changed
      return {
        ruleId: "pr-edit-base",
        message: `gh pr edit must not change the base to "${base}" — it must stay "${requireBase}".`,
        fix: `--base ${requireBase}`,
      };
    },
  };
}

function prEditMarkerRule(markers: string[]): Rule {
  return {
    id: "pr-edit-marker",
    description: "a gh pr edit that sets a body must keep the required marker(s)",
    appliesTo: { command: "gh", subcommand: ["pr", "edit"] },
    evaluate(inv, ctx) {
      if (!prSetsBody(inv)) return null;
      if (prBodyFromStdin(inv)) return null; // body piped via stdin — cannot verify
      const body = prBody(inv, ctx);
      const missing = markers.filter((m) => !body.includes(m));
      if (missing.length === 0) return null;
      const list = missing.map((m) => `"${m}"`).join(", ");
      return {
        ruleId: "pr-edit-marker",
        message: `gh pr edit sets a body missing required section(s): ${list}.`,
        fix: `include ${list} in the new body`,
      };
    },
  };
}

/** The name of a branch being created, across checkout/switch/branch (incl. --orphan/--create). */
function newBranchName(inv: Invocation): string | null {
  const argv = gitArgv(inv);
  const sub = argv[1];
  if (sub === "checkout") {
    return flagValue(argv, "--orphan") ?? flagValue(argv, "-b") ?? flagValue(argv, "-B");
  }
  if (sub === "switch") {
    return (
      flagValue(argv, "--orphan") ??
      flagValue(argv, "-c") ??
      flagValue(argv, "-C") ??
      flagValue(argv, "--create") ??
      flagValue(argv, "--force-create")
    );
  }
  if (sub === "branch") {
    if (hasFlag(argv, ["-d", "-D", "--delete", "-m", "-M", "--move", "-a", "--list", "-r", "--all"])) {
      return null;
    }
    return positionals(argv)[1] ?? null; // positionals = ["branch", <name>, ...]
  }
  return null;
}

function branchNameRule(allowed: string[], reserved: string[], strictKebab: boolean): Rule {
  const kebab = /^[a-z0-9]+(-[a-z0-9]+)*$/;
  return {
    id: "branch-name",
    description: "new branches must use an allowed <type>/ prefix (kebab slug when configured)",
    appliesTo: { command: "git" },
    evaluate(inv) {
      const name = newBranchName(inv);
      if (!name) return null;
      if (inv.uncertain) return null; // structural rule skips on ambiguous parse
      const slashIdx = name.indexOf("/");
      const prefix = slashIdx >= 0 ? name.slice(0, slashIdx) : name;
      const slug = slashIdx >= 0 ? name.slice(slashIdx + 1) : "";
      if (reserved.includes(prefix)) {
        return {
          ruleId: "branch-name",
          message: `Branch prefix "${prefix}/" is reserved for its tool and must not be hand-created.`,
          fix: `use an allowed prefix instead: ${allowed.join(", ")}`,
        };
      }
      if (!allowed.includes(prefix) || slug.length === 0) {
        return {
          ruleId: "branch-name",
          message: `Branch "${name}" must be <type>/<slug> with type one of: ${allowed.join(", ")}.`,
          fix: `e.g. ${allowed[0]}/short-descriptive-slug`,
        };
      }
      if (strictKebab && !kebab.test(slug)) {
        return {
          ruleId: "branch-name",
          message: `Branch slug "${slug}" must be kebab-case (lowercase letters, digits, single dashes).`,
          fix: `e.g. ${allowed[0]}/short-descriptive-slug`,
        };
      }
      return null;
    },
  };
}

function stripRef(t: string): string {
  return t.replace(/^refs\/heads\//, "");
}

/** True when a `git push` targets a protected branch (explicit refspec, bulk mode, or implicit current branch). */
function pushTargetsProtected(inv: Invocation, ctx: Context, protectedBranches: string[]): boolean {
  const argv = gitArgv(inv);
  if (hasFlag(argv, ["--all", "--mirror"])) return true; // bulk push includes protected refs
  const after = positionals(argv).slice(1); // drop "push"; may be [remote, refspec...]
  const targets = after.map((p) => stripRef(p.includes(":") ? p.slice(p.indexOf(":") + 1) : p));
  const explicitHit = targets.some((t) => protectedBranches.includes(t));
  const current = ctx.branch();
  const implicitHit = after.length <= 1 && current !== null && protectedBranches.includes(current);
  return explicitHit || implicitHit;
}

function pushForceRule(protectedBranches: string[]): Rule {
  return {
    id: "push-force-protected",
    description: "no force-push to protected branches",
    appliesTo: { command: "git", subcommand: "push" },
    evaluate(inv, ctx) {
      if (!hasFlag(inv.argv, FORCE_FLAGS)) return null;
      if (!pushTargetsProtected(inv, ctx, protectedBranches)) return null;
      return {
        ruleId: "push-force-protected",
        message: `Force-pushing to a protected branch (${protectedBranches.join(", ")}) is banned.`,
        fix: "drop --force, or push a feature branch and open a PR",
      };
    },
  };
}

function pushDirectRule(protectedBranches: string[]): Rule {
  return {
    id: "push-direct-protected",
    description: "protected-branch changes must land via PR, not a direct push",
    appliesTo: { command: "git", subcommand: "push" },
    evaluate(inv, ctx) {
      if (hasFlag(inv.argv, FORCE_FLAGS)) return null; // force is handled by push-force-protected
      if (!pushTargetsProtected(inv, ctx, protectedBranches)) return null;
      return {
        ruleId: "push-direct-protected",
        message: `Pushing directly to a protected branch (${protectedBranches.join(", ")}) is banned — land changes via a PR.`,
        fix: "push a feature branch and open a PR to the protected branch",
      };
    },
  };
}

function commitOnProtectedRule(protectedBranches: string[]): Rule {
  return {
    id: "commit-on-protected",
    description: "never commit directly on a protected branch — branch first",
    appliesTo: { command: "git", subcommand: "commit" },
    evaluate(inv, ctx) {
      const current = ctx.branch();
      if (current === null || !protectedBranches.includes(current)) return null;
      return {
        ruleId: "commit-on-protected",
        message: `You are on protected branch "${current}" — never commit here; create a feature branch first.`,
        fix: "git checkout -b <type>/<slug>, then commit on that branch",
      };
    },
  };
}

function prMarkerRule(markers: string[]): Rule {
  return {
    id: "pr-marker",
    description: "PR body must contain required marker section(s)",
    appliesTo: { command: "gh", subcommand: ["pr", "create"] },
    evaluate(inv, ctx) {
      if (prBodyFromStdin(inv)) return null; // body piped via stdin — cannot verify, don't false-block
      const body = prBody(inv, ctx);
      const missing = markers.filter((m) => !body.includes(m));
      if (missing.length === 0) return null;
      const list = missing.map((m) => `"${m}"`).join(", ");
      return {
        ruleId: "pr-marker",
        message: `PR body is missing required section(s): ${list}.`,
        fix: `include ${list} in --body / --body-file`,
      };
    },
  };
}

function prTemplateRule(entries: { branchPrefix: string; template: string; requireMarker?: string }[]): Rule {
  return {
    id: "pr-branch-template",
    description: "certain branch classes must use a specific PR template",
    appliesTo: { command: "gh", subcommand: ["pr", "create"] },
    evaluate(inv, ctx) {
      const branch = prHeadBranch(inv, ctx);
      if (!branch) return null;
      for (const e of entries) {
        if (!branch.startsWith(e.branchPrefix + "/")) continue;
        const file = flagValue(inv.argv, "--body-file") ?? flagValue(inv.argv, "-F");
        if (!file) {
          return {
            ruleId: "pr-branch-template",
            message: `${e.branchPrefix}/* PRs must use the ${e.template} template via --body-file (complete a copy; never submit blank prompts).`,
            fix: `copy ${e.template} to a temp file, fill it in, then pass --body-file <that file>`,
          };
        }
        if (e.requireMarker && !prBodyFromStdin(inv)) {
          const body = prBody(inv, ctx);
          if (!body.includes(e.requireMarker)) {
            return {
              ruleId: "pr-branch-template",
              message: `${e.branchPrefix}/* PR body must come from ${e.template} (missing "${e.requireMarker}").`,
              fix: `use the ${e.template} template content and complete its sections`,
            };
          }
        }
      }
      return null;
    },
  };
}

function prPathSectionRule(
  entries: { changedGlobs: string[]; requireSection: string }[],
  base: string,
): Rule {
  return {
    id: "pr-path-section",
    description: "changed paths require a corresponding PR body section",
    appliesTo: { command: "gh", subcommand: ["pr", "create"] },
    evaluate(inv, ctx) {
      if (prBodyFromStdin(inv)) return null; // body piped via stdin — cannot verify the section
      const changed = ctx.filesChangedVsBase(base);
      if (changed.length === 0) return null;
      const body = prBody(inv, ctx);
      for (const e of entries) {
        const hit = changed.some((f) => e.changedGlobs.some((g) => globMatch(g, f)));
        if (hit && !body.includes(e.requireSection)) {
          return {
            ruleId: "pr-path-section",
            message: `Changed files match ${e.changedGlobs.join(", ")} — PR body must contain "${e.requireSection}".`,
            fix: `add the "${e.requireSection}" section to the PR body`,
          };
        }
      }
      return null;
    },
  };
}
