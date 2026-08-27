// ABOUTME: Red/green tests for the declarative rule factories.
// ABOUTME: Exercises each factory's evaluate directly with a static context.
import { expect, test } from "vitest";
import { createStaticContext } from "../context";
import { denyFlag, requireFlagValue } from "./declarative";

const ctx = createStaticContext({});
const inv = (argv: string[]) => ({ argv, env: {}, raw: argv.join(" "), uncertain: false });

test("denyFlag blocks banned flag + short cluster, allows clean", () => {
  const r = denyFlag({
    id: "nv",
    description: "",
    command: "git",
    subcommand: "commit",
    flags: ["--no-verify"],
    shortChars: ["n"],
    message: "no --no-verify",
  });
  expect(r.evaluate(inv(["git", "commit", "--no-verify"]), ctx)?.ruleId).toBe("nv");
  expect(r.evaluate(inv(["git", "commit", "-n"]), ctx)?.ruleId).toBe("nv");
  expect(r.evaluate(inv(["git", "commit", "-vn"]), ctx)?.ruleId).toBe("nv");
  expect(r.evaluate(inv(["git", "commit", "-m", "x"]), ctx)).toBeNull();
});

test("requireFlagValue enforces exact value incl. omission", () => {
  const r = requireFlagValue({
    id: "base",
    description: "",
    command: "gh",
    subcommand: ["pr", "create"],
    flag: "--base",
    equals: "staging",
  });
  expect(r.evaluate(inv(["gh", "pr", "create", "--base", "staging"]), ctx)).toBeNull();
  expect(r.evaluate(inv(["gh", "pr", "create", "--base", "main"]), ctx)?.ruleId).toBe("base");
  expect(r.evaluate(inv(["gh", "pr", "create"]), ctx)?.ruleId).toBe("base");
});
