// ABOUTME: Tests for the runHook/runCheck entry points with injected config.
// ABOUTME: Avoids subprocess spawning; the built-bundle path is covered in e2e.
import { expect, test } from "vitest";
import { runCheck, runHook } from "./cli";
import type { Config } from "./types";

const cfg: Config = {
  packs: ["git-conventions"],
  git: { commit: { denyNoVerify: true }, branch: { allowedPrefixes: ["feat"], reservedPrefixes: [] } },
};

test("hook blocks --no-verify via injected config", async () => {
  const res = await runHook(
    JSON.stringify({ tool_name: "Bash", tool_input: { command: "git commit --no-verify" }, cwd: process.cwd() }),
    cfg,
  );
  expect(res.code).toBe(2);
  expect(res.message).toMatch(/no-verify/);
});

test("hook allows a clean command", async () => {
  const res = await runHook(
    JSON.stringify({ tool_name: "Bash", tool_input: { command: "git status" }, cwd: process.cwd() }),
    cfg,
  );
  expect(res.code).toBe(0);
});

test("hook ignores non-Bash and malformed json", async () => {
  expect((await runHook(JSON.stringify({ tool_name: "Read", tool_input: {} }), cfg)).code).toBe(0);
  expect((await runHook("not json", cfg)).code).toBe(0);
});

test("check drives branch rule via --branch flag", async () => {
  const res = await runCheck(["git checkout -b feature/x", "--branch", "main"], cfg);
  expect(res.code).toBe(2);
  expect(res.message).toMatch(/branch/i);
});
