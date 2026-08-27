// ABOUTME: Compile/shape smoke test for shared types.
// ABOUTME: Guards against accidental breaking edits to the type contracts.
import { expect, test } from "vitest";
import type { Rule, Violation } from "./types";

test("Rule/Violation shapes are usable", () => {
  const r: Rule = {
    id: "x",
    description: "d",
    appliesTo: { command: "git" },
    evaluate: () => null,
  };
  const v: Violation = { ruleId: "x", message: "m" };
  expect(
    r.evaluate({ argv: ["git"], env: {}, raw: "git", uncertain: false }, {} as never),
  ).toBeNull();
  expect(v.ruleId).toBe("x");
});
