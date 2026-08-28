// ABOUTME: Tests config discovery (walk-up) and pack resolution.
// ABOUTME: Uses a temp directory tree with a JSON config.
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import type { RuleSpec } from "./types";
import { findConfigPath, loadConfig, resolveRules, validateConfig } from "./config";

test("findConfigPath walks up to the config", () => {
  const root = mkdtempSync(join(tmpdir(), "precmd-"));
  writeFileSync(join(root, "precmd.config.json"), JSON.stringify({ packs: ["git-conventions"] }));
  const sub = join(root, "a", "b");
  mkdirSync(sub, { recursive: true });
  expect(findConfigPath(sub)).toBe(join(root, "precmd.config.json"));
});

test("loadConfig reads json + resolveRules expands packs", async () => {
  const root = mkdtempSync(join(tmpdir(), "precmd-"));
  writeFileSync(
    join(root, "precmd.config.json"),
    JSON.stringify({ packs: ["git-conventions"], git: { commit: { denyNoVerify: true } } }),
  );
  const cfg = await loadConfig(root);
  expect(resolveRules(cfg).map((r) => r.id)).toContain("commit-no-verify");
});

test("absent config → defaults → no rules", async () => {
  const root = mkdtempSync(join(tmpdir(), "precmd-empty-"));
  const cfg = await loadConfig(root);
  expect(resolveRules(cfg)).toEqual([]);
});

test("safety pack + a custom declarative rule resolve together", () => {
  const rules = resolveRules({
    packs: ["safety"],
    rules: [{ id: "no-sudo", command: "*", when: { commandMatches: "^sudo$" }, message: "no" }],
  });
  const ids = rules.map((r) => r.id);
  expect(ids).toContain("no-curl-pipe-shell");
  expect(ids).toContain("no-sudo");
});

test("validateConfig surfaces bad custom specs", () => {
  const errors = validateConfig({
    rules: [{ id: "bad", command: "x", when: { argMatches: "(" }, message: "m" } as RuleSpec],
  });
  expect(errors.length).toBe(1);
});
