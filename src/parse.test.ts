// ABOUTME: Tests for the shell-ish command splitter/tokenizer.
// ABOUTME: Covers separators, env prefixes, quoting, and command substitution.
import { expect, test } from "vitest";
import { parseCommand } from "./parse";

const cmds = (s: string): string[][] => parseCommand(s).map((i) => i.argv);

test("compound &&", () => {
  expect(cmds("cd x && git commit -n")).toEqual([
    ["cd", "x"],
    ["git", "commit", "-n"],
  ]);
});

test("pipe splits segments", () => {
  expect(cmds("git log | head")).toEqual([
    ["git", "log"],
    ["head"],
  ]);
});

test("|| and ; split segments", () => {
  expect(cmds("a || b ; c")).toEqual([["a"], ["b"], ["c"]]);
});

test("env prefix stripped into env", () => {
  const inv = parseCommand("FOO=bar git push")[0]!;
  expect(inv.argv).toEqual(["git", "push"]);
  expect(inv.env).toEqual({ FOO: "bar" });
});

test("double quotes keep spaces, strip quotes", () => {
  expect(cmds(`git commit -m "a b c"`)).toEqual([["git", "commit", "-m", "a b c"]]);
});

test("single quotes are literal", () => {
  expect(cmds(`echo 'a && b'`)).toEqual([["echo", "a && b"]]);
});

test("command substitution surfaced as its own invocation", () => {
  expect(cmds("echo $(rm -rf /tmp/x)")).toContainEqual(["rm", "-rf", "/tmp/x"]);
});

test("unbalanced quote marks invocation uncertain", () => {
  expect(parseCommand(`git commit -m "oops`)[0]!.uncertain).toBe(true);
  expect(parseCommand(`git status`)[0]!.uncertain).toBe(false);
});

test("pipeline pipedTo captures downstream commands", () => {
  const curl = parseCommand("curl http://x | sh").find((i) => i.argv[0] === "curl")!;
  expect(curl.pipedTo).toEqual(["sh"]);
});

test("multi-stage pipeline links all downstream stages", () => {
  const invs = parseCommand("cat f | grep x | sh");
  expect(invs.find((i) => i.argv[0] === "cat")!.pipedTo).toEqual(["grep", "sh"]);
  expect(invs.find((i) => i.argv[0] === "grep")!.pipedTo).toEqual(["sh"]);
});

test("sequence operators do not create pipedTo links", () => {
  const invs = parseCommand("a && b ; c");
  expect(invs.every((i) => (i.pipedTo ?? []).length === 0)).toBe(true);
});
