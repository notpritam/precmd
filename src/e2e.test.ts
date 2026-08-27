// ABOUTME: End-to-end tests that exercise the built dist/cli.cjs as a subprocess.
// ABOUTME: Verifies real exit codes and stderr for the hook and check entry points.
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, expect, test } from "vitest";

const BUNDLE = join(process.cwd(), "dist", "cli.cjs");

beforeAll(() => {
  execFileSync("yarn", ["build"], { cwd: process.cwd(), stdio: "ignore" });
});

function errInfo(e: unknown): { code: number; stderr: string } {
  const err = e as { status?: number; stderr?: Buffer | string };
  return { code: err.status ?? 1, stderr: String(err.stderr ?? "") };
}

function setupRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "precmd-e2e-"));
  execFileSync("git", ["init", "-q"], { cwd: dir });
  writeFileSync(
    join(dir, "precmd.config.json"),
    JSON.stringify({ packs: ["git-conventions"], git: { commit: { denyNoVerify: true } } }),
  );
  return dir;
}

test("built bundle blocks --no-verify (exit 2)", () => {
  const dir = setupRepo();
  try {
    execFileSync("node", [BUNDLE, "check", "git commit --no-verify -m x", "--cwd", dir], {
      encoding: "utf8",
    });
    throw new Error("expected non-zero exit");
  } catch (e) {
    const { code, stderr } = errInfo(e);
    expect(code).toBe(2);
    expect(stderr).toMatch(/no-verify/);
  }
});

test("built bundle allows a clean command (exit 0)", () => {
  const dir = setupRepo();
  const out = execFileSync("node", [BUNDLE, "check", "git status", "--cwd", dir], { encoding: "utf8" });
  expect(out).toBe("");
});

test("hook subcommand blocks via stdin json (exit 2)", () => {
  const dir = setupRepo();
  const json = JSON.stringify({ tool_name: "Bash", tool_input: { command: "git commit -n" }, cwd: dir });
  try {
    execFileSync("node", [BUNDLE, "hook"], { input: json, encoding: "utf8" });
    throw new Error("expected non-zero exit");
  } catch (e) {
    const { code, stderr } = errInfo(e);
    expect(code).toBe(2);
    expect(stderr).toMatch(/no-verify/);
  }
});
