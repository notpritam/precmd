// ABOUTME: Built-in git/gh/PR convention rule pack, assembled from GitConfig.
// ABOUTME: Combines declarative factories with context-aware programmatic rules.
import { flagValue, hasFlag, positionals } from "../argv";
import { globMatch } from "../glob";
import type { Context, GitConfig, Invocation, Rule } from "../types";
import { denyFlag, requireFlagValue } from "./declarative";

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
      ),
    );
  }

  if (git.push?.denyForceToProtected) {
    rules.push(pushForceRule(git.protectedBranches ?? ["main"]));
  }

  if (git.pr?.requireBase) {
    const base = git.pr.requireBase;
    rules.push(
      requireFlagValue({
        id: "pr-base",
        description: "PRs must target the integration branch",
        command: "gh",
        subcommand: ["pr", "create"],
        flag: "--base",
        equals: base,
        message: `gh pr create must target "${base}" — pass --base ${base}.`,
      }),
    );
  }

  const markers = normalizeMarkers(git.pr?.requireBodyMarker);
  if (markers.length) rules.push(prMarkerRule(markers));

  if (git.pr?.branchTemplates?.length) rules.push(prTemplateRule(git.pr.branchTemplates));

  if (git.pr?.pathSectionRules?.length) {
    const base = git.pr.requireBase ?? git.defaultBase ?? git.protectedBranches?.[0] ?? "main";
    rules.push(prPathSectionRule(git.pr.pathSectionRules, base));
  }

  return rules;
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

/** The name of a branch being created, across checkout -b / switch -c / branch <name>. */
function newBranchName(inv: Invocation): string | null {
  const sub = inv.argv[1];
  if (sub === "checkout") return flagValue(inv.argv, "-b") ?? flagValue(inv.argv, "-B");
  if (sub === "switch") return flagValue(inv.argv, "-c") ?? flagValue(inv.argv, "-C");
  if (sub === "branch") {
    if (hasFlag(inv.argv, ["-d", "-D", "--delete", "-m", "-M", "--move", "-a", "--list", "-r", "--all"])) {
      return null;
    }
    return positionals(inv.argv)[1] ?? null; // positionals = ["branch", <name>, ...]
  }
  return null;
}

function branchNameRule(allowed: string[], reserved: string[]): Rule {
  const pattern = new RegExp(`^(${allowed.join("|")})/[a-z0-9]+(-[a-z0-9]+)*$`);
  return {
    id: "branch-name",
    description: "new branches must be <type>/<kebab-case-slug> with an allowed prefix",
    appliesTo: { command: "git" },
    evaluate(inv) {
      const name = newBranchName(inv);
      if (!name) return null;
      if (inv.uncertain) return null; // structural rule skips on ambiguous parse
      const prefix = name.includes("/") ? name.slice(0, name.indexOf("/")) : name;
      if (reserved.includes(prefix)) {
        return {
          ruleId: "branch-name",
          message: `Branch prefix "${prefix}/" is reserved for its tool and must not be hand-created.`,
          fix: `use an allowed prefix instead: ${allowed.join(", ")}`,
        };
      }
      if (!pattern.test(name)) {
        return {
          ruleId: "branch-name",
          message: `Branch "${name}" must be <type>/<kebab-case-slug>; type must be one of: ${allowed.join(", ")}.`,
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

function pushForceRule(protectedBranches: string[]): Rule {
  return {
    id: "push-force-protected",
    description: "no force-push to protected branches",
    appliesTo: { command: "git", subcommand: "push" },
    evaluate(inv, ctx) {
      if (!hasFlag(inv.argv, FORCE_FLAGS)) return null;
      const after = positionals(inv.argv).slice(1); // drop "push"; may be [remote, refspec...]
      const targets = after.map((p) => stripRef(p.includes(":") ? p.slice(p.indexOf(":") + 1) : p));
      const explicitHit = targets.some((t) => protectedBranches.includes(t));
      const current = ctx.branch();
      const implicitHit = after.length <= 1 && current !== null && protectedBranches.includes(current);
      if (!explicitHit && !implicitHit) return null;
      return {
        ruleId: "push-force-protected",
        message: `Force-pushing to a protected branch (${protectedBranches.join(", ")}) is banned.`,
        fix: "drop --force, or push a feature branch and open a PR",
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
      const branch = ctx.branch();
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
        if (e.requireMarker) {
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
