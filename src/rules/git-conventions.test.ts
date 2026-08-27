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
  commit: { denyNoVerify: true },
  push: { denyForceToProtected: true, denyNoVerify: true },
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
      "pr-base",
      "pr-branch-template",
      "pr-marker",
      "pr-path-section",
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
