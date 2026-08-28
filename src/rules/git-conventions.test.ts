// ABOUTME: Red/green tests for the git-conventions rule pack.
// ABOUTME: Drives full command strings through parse → engine with a static context.
import { expect, test } from "vitest";
import { createStaticContext } from "../context";
import { evaluate } from "../engine";
import { parseCommand } from "../parse";
import type { GitConfig } from "../types";
import { buildGitConventionsPack } from "./git-conventions";

const cfg: GitConfig = {
  protectedBranches: ["staging", "main"],
  defaultBase: "staging",
  branch: { allowedPrefixes: ["feat", "fix", "bug"], reservedPrefixes: ["codex", "claude"] },
  commit: { denyNoVerify: true, denyOnProtected: true },
  push: { denyForceToProtected: true, denyDirectToProtected: true, denyNoVerify: true },
  pr: {
    requireBase: "staging",
    requireBodyMarker: "### React 19 / Compiler notes",
    branchTemplates: [{ branchPrefix: "bug", template: ".github/PULL_REQUEST_TEMPLATE/bug.md" }],
    pathSectionRules: [{ changedGlobs: ["**/checkout/**"], requireSection: "### Payment checkout notes" }],
  },
};
const rules = buildGitConventionsPack(cfg);
const ids = (cmd: string, ctxInit: Parameters<typeof createStaticContext>[0] = {}): string[] =>
  evaluate(parseCommand(cmd), rules, createStaticContext(ctxInit)).map((v) => v.ruleId);

test("pack builds all expected rule ids", () => {
  expect(rules.map((r) => r.id).sort()).toEqual(
    [
      "branch-name",
      "commit-no-verify",
      "commit-on-protected",
      "merge-no-verify",
      "pull-no-verify",
      "pr-base",
      "pr-edit-base",
      "pr-branch-template",
      "pr-marker",
      "pr-edit-marker",
      "pr-path-section",
      "pr-edit-path-section",
      "push-direct-protected",
      "push-force-protected",
      "push-no-verify",
    ].sort(),
  );
});

test("commit --no-verify blocks; clean commit passes", () => {
  expect(ids("git commit -m x --no-verify")).toContain("commit-no-verify");
  expect(ids("git commit -m x")).not.toContain("commit-no-verify");
});

test("branch: bad prefix blocks, reserved prefix has specific message, good passes", () => {
  expect(ids("git checkout -b feature/thing")).toContain("branch-name");
  const reserved = evaluate(parseCommand("git switch -c claude/x"), rules, createStaticContext({}));
  expect(reserved.find((v) => v.ruleId === "branch-name")!.message).toMatch(/reserved/i);
  expect(ids("git checkout -b feat/good-slug")).not.toContain("branch-name");
});

test("force push to protected blocks (explicit + implicit), feature branch allowed", () => {
  expect(ids("git push --force origin main")).toContain("push-force-protected");
  expect(ids("git push -f", { branch: "staging" })).toContain("push-force-protected");
  expect(ids("git push -f", { branch: "feat/x" })).not.toContain("push-force-protected");
});

test("pr base must be staging", () => {
  expect(ids(`gh pr create --base main --body "### React 19 / Compiler notes"`)).toContain("pr-base");
  expect(ids(`gh pr create --base staging --body "### React 19 / Compiler notes"`)).not.toContain("pr-base");
});

test("pr missing marker blocks", () => {
  expect(ids(`gh pr create --base staging --body "hello"`)).toContain("pr-marker");
});

test("bug branch must use --body-file template", () => {
  const inline = `gh pr create --base staging --body "### React 19 / Compiler notes"`;
  expect(ids(inline, { branch: "bug/thing" })).toContain("pr-branch-template");
  const withFile = `gh pr create --base staging --body-file /tmp/bug.md`;
  expect(ids(withFile, { branch: "bug/thing", files: { "/tmp/bug.md": "x" } })).not.toContain(
    "pr-branch-template",
  );
});

test("payment path requires payment section", () => {
  const cmd = `gh pr create --base staging --body "### React 19 / Compiler notes"`;
  expect(ids(cmd, { changedFiles: ["src/checkout/pay.ts"] })).toContain("pr-path-section");
  expect(ids(cmd, { changedFiles: ["src/home/x.ts"] })).not.toContain("pr-path-section");
});

test("strict kebab is opt-in; ticket-id slugs allowed when lenient", () => {
  const strict = buildGitConventionsPack({
    branch: { allowedPrefixes: ["feat"], reservedPrefixes: [], slug: "kebab-case" },
  });
  const lenient = buildGitConventionsPack({ branch: { allowedPrefixes: ["feat"], reservedPrefixes: [] } });
  const run = (rs: ReturnType<typeof buildGitConventionsPack>, cmd: string): string[] =>
    evaluate(parseCommand(cmd), rs, createStaticContext({})).map((v) => v.ruleId);
  expect(run(strict, "git checkout -b feat/BF-170-thing")).toContain("branch-name");
  expect(run(lenient, "git checkout -b feat/BF-170-thing")).not.toContain("branch-name");
  expect(run(lenient, "git checkout -b nope/x")).toContain("branch-name");
});

test("commit on a protected branch is blocked; feature branch is fine", () => {
  expect(ids("git commit -m x", { branch: "staging" })).toContain("commit-on-protected");
  expect(ids("git commit -m x", { branch: "feat/x" })).not.toContain("commit-on-protected");
});

test("direct push to protected blocked; force still separately blocked; feature push ok", () => {
  expect(ids("git push origin staging", { branch: "feat/x" })).toContain("push-direct-protected");
  expect(ids("git push --force origin staging", { branch: "feat/x" })).toContain("push-force-protected");
  expect(ids("git push --force origin staging", { branch: "feat/x" })).not.toContain("push-direct-protected");
  expect(ids("git push origin feat/x", { branch: "feat/x" })).not.toContain("push-direct-protected");
});

test("merge --no-verify is blocked", () => {
  expect(ids("git merge --no-verify main")).toContain("merge-no-verify");
});

test("git global options do not bypass subcommand rules", () => {
  expect(ids("git -C /x commit --no-verify -m y")).toContain("commit-no-verify");
  expect(ids("git -c core.hooksPath=/dev/null commit -n")).toContain("commit-no-verify");
});

test("shell wrappers and keywords are unwrapped before matching", () => {
  expect(ids("command git commit --no-verify")).toContain("commit-no-verify");
  expect(ids("if true; then git commit -n; fi")).toContain("commit-no-verify");
  expect(ids('bash -c "git commit --no-verify"')).toContain("commit-no-verify");
});

test("gh pr new alias is enforced like gh pr create", () => {
  expect(ids("gh pr new --base main --body hi")).toContain("pr-base");
});

test("git pull --no-verify is blocked", () => {
  expect(ids("git pull --no-verify")).toContain("pull-no-verify");
});

test("gh pr edit base + marker guards", () => {
  expect(ids("gh pr edit --base main")).toContain("pr-edit-base");
  expect(ids("gh pr edit --base staging")).not.toContain("pr-edit-base");
  expect(ids("gh pr edit --body nope")).toContain("pr-edit-marker");
  expect(ids("gh pr edit --add-label x")).not.toContain("pr-edit-marker");
});

test("bug-template check uses --head when supplied", () => {
  expect(
    ids('gh pr create --head bug/x --base staging --body "### React 19 / Compiler notes"'),
  ).toContain("pr-branch-template");
});

test("bulk push modes and short/orphan branch-creation flags", () => {
  expect(ids("git push --all origin", { branch: "feat/x" })).toContain("push-direct-protected");
  expect(ids("git switch --create feature/bad")).toContain("branch-name");
  expect(ids("git checkout --orphan feature/bad")).toContain("branch-name");
});

test("piped body via --body-file - (stdin) is not false-blocked", () => {
  expect(ids("gh pr create --base staging --body-file -")).not.toContain("pr-marker");
  expect(
    ids("gh pr create --base staging --body-file -", { changedFiles: ["src/checkout/pay.ts"] }),
  ).not.toContain("pr-path-section");
  expect(ids("gh pr edit --body-file -")).not.toContain("pr-edit-marker");
});

test("push origin HEAD/@ on a protected branch is blocked (review finding 2)", () => {
  expect(ids("git push origin HEAD", { branch: "staging" })).toContain("push-direct-protected");
  expect(ids("git push origin @", { branch: "main" })).toContain("push-direct-protected");
  expect(ids("git push origin HEAD", { branch: "feat/x" })).not.toContain("push-direct-protected");
});

test("commit-on-protected covers merge/cherry-pick/revert/rebase (review finding 3)", () => {
  expect(ids("git merge feat/x", { branch: "staging" })).toContain("commit-on-protected");
  expect(ids("git cherry-pick abc123", { branch: "main" })).toContain("commit-on-protected");
  expect(ids("git rebase feat/x", { branch: "staging" })).toContain("commit-on-protected");
  expect(ids("git merge feat/x", { branch: "feat/y" })).not.toContain("commit-on-protected");
});

test("payment section is enforced on gh pr edit too (review finding 4)", () => {
  const ctx = { changedFiles: ["src/checkout/pay.ts"] };
  expect(ids('gh pr edit --body "no section here"', ctx)).toContain("pr-edit-path-section");
  expect(ids("gh pr edit --add-label x", ctx)).not.toContain("pr-edit-path-section");
});

test("git rules are repo-scoped: a cross-repo push is not blocked", () => {
  const cross = createStaticContext({
    cwd: "/e1",
    repoRoot: "/e1",
    repoRoots: { "/e1": "/e1", "/other": "/other" },
  });
  expect(evaluate(parseCommand("git -C /other push origin main"), rules, cross).map((v) => v.ruleId)).not.toContain(
    "push-direct-protected",
  );
  const same = createStaticContext({ cwd: "/e1", repoRoot: "/e1", branch: "feat/x" });
  expect(evaluate(parseCommand("git push origin main"), rules, same).map((v) => v.ruleId)).toContain(
    "push-direct-protected",
  );
});
