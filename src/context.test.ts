// ABOUTME: Tests for the static test-context and the real git-backed context.
// ABOUTME: The git-context test runs against precmd's own repository.
import { expect, test } from "vitest";
import { createGitContext, createStaticContext } from "./context";

test("static context returns injected facts", () => {
  const ctx = createStaticContext({
    branch: "bug/x",
    changedFiles: ["src/checkout/pay.ts"],
    files: { "a.md": "hi" },
  });
  expect(ctx.branch()).toBe("bug/x");
  expect(ctx.changedFiles()).toEqual(["src/checkout/pay.ts"]);
  expect(ctx.readRepoFile("a.md")).toBe("hi");
  expect(ctx.readRepoFile("missing")).toBeNull();
});

test("git context reads the real repo without throwing", () => {
  const ctx = createGitContext(process.cwd());
  const root = ctx.repoRoot();
  expect(root === null || root.endsWith("precmd")).toBe(true);
  expect(() => ctx.changedFiles()).not.toThrow();
});
