// ABOUTME: Tests for the violation message formatter.
// ABOUTME: Verifies rule id, fix line, and pluralized count.
import { expect, test } from "vitest";
import { formatViolations } from "./format";

test("formats id + fix line", () => {
  const msg = formatViolations([{ ruleId: "commit-no-verify", message: "banned", fix: "remove -n" }]);
  expect(msg).toMatch(/\[commit-no-verify\]/);
  expect(msg).toMatch(/fix: remove -n/);
  expect(msg).toMatch(/1 rule violation\b/);
});

test("counts multiple violations", () => {
  const msg = formatViolations([
    { ruleId: "a", message: "x" },
    { ruleId: "b", message: "y" },
  ]);
  expect(msg).toMatch(/2 rule violations/);
});
