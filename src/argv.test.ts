// ABOUTME: Tests for pure argv flag/value/positional helpers.
// ABOUTME: These underpin every rule's flag inspection.
import { expect, test } from "vitest";
import { hasFlag, flagValue, positionals, hasShortFlagChar } from "./argv";

test("hasFlag exact + equals form", () => {
  expect(hasFlag(["git", "commit", "--no-verify"], ["--no-verify", "-n"])).toBe(true);
  expect(hasFlag(["git", "commit", "-n"], ["--no-verify", "-n"])).toBe(true);
  expect(hasFlag(["gh", "pr", "create", "--base=main"], ["--base"])).toBe(true);
  expect(hasFlag(["git", "commit", "-m", "x"], ["--no-verify", "-n"])).toBe(false);
});

test("flagValue space + equals + missing", () => {
  expect(flagValue(["gh", "pr", "create", "--base", "staging"], "--base")).toBe("staging");
  expect(flagValue(["gh", "pr", "create", "--base=main"], "--base")).toBe("main");
  expect(flagValue(["gh", "pr", "create"], "--base")).toBeNull();
});

test("positionals skip flags and command word", () => {
  expect(positionals(["git", "checkout", "-b", "feat/x"])).toEqual(["checkout", "feat/x"]);
});

test("hasShortFlagChar matches cluster, ignores long flags", () => {
  expect(hasShortFlagChar(["git", "commit", "-vn"], "n")).toBe(true);
  expect(hasShortFlagChar(["git", "commit", "-v"], "n")).toBe(false);
  expect(hasShortFlagChar(["git", "commit", "--no-verify"], "n")).toBe(false);
});
