// ABOUTME: precmd CLI — `hook` (PreToolUse enforcement) and `check` (test/debug).
// ABOUTME: Blocking is exit code 2 with the corrective message on stderr.
import { loadConfig, resolveRules } from "./config";
import { createGitContext, createStaticContext } from "./context";
import { evaluate } from "./engine";
import { formatViolations } from "./format";
import { parseCommand } from "./parse";
import type { Config, Context, HookInput } from "./types";

export interface Result {
  code: 0 | 2;
  message: string;
}

async function evaluateCommand(command: string, ctx: Context, config?: Config): Promise<Result> {
  const cfg = config ?? (await loadConfig(ctx.cwd));
  const violations = evaluate(parseCommand(command), resolveRules(cfg), ctx);
  if (violations.length === 0) return { code: 0, message: "" };
  return { code: 2, message: formatViolations(violations) };
}

/** Evaluate a PreToolUse hook payload (stdin JSON). Non-Bash / malformed = allow. */
export async function runHook(stdin: string, config?: Config): Promise<Result> {
  let input: HookInput;
  try {
    input = JSON.parse(stdin) as HookInput;
  } catch {
    return { code: 0, message: "" };
  }
  if (input.tool_name && input.tool_name !== "Bash") return { code: 0, message: "" };
  const command = input.tool_input?.command;
  if (!command) return { code: 0, message: "" };
  return evaluateCommand(command, createGitContext(input.cwd || process.cwd()), config);
}

/** Evaluate a `check "<command>" [--branch b] [--changed a,b] [--cwd d]` invocation. */
export async function runCheck(argv: string[], config?: Config): Promise<Result> {
  let command: string | undefined;
  let branch: string | undefined;
  let changed: string[] | undefined;
  let cwd: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--branch") branch = argv[++i];
    else if (a === "--changed")
      changed = (argv[++i] ?? "").split(",").map((s) => s.trim()).filter(Boolean);
    else if (a === "--cwd") cwd = argv[++i];
    else if (!a.startsWith("--") && command === undefined) command = a;
  }
  if (!command) return { code: 0, message: "" };
  const dir = cwd ?? process.cwd();
  const ctx =
    branch !== undefined || changed !== undefined
      ? createStaticContext({ cwd: dir, branch: branch ?? null, changedFiles: changed ?? [] })
      : createGitContext(dir);
  return evaluateCommand(command, ctx, config);
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

async function main(): Promise<void> {
  const [sub, ...rest] = process.argv.slice(2);
  try {
    let result: Result;
    if (sub === "hook") result = await runHook(await readStdin());
    else if (sub === "check") result = await runCheck(rest);
    else {
      process.stderr.write("usage: precmd <hook|check> [...]\n");
      process.exit(0);
    }
    if (result.code === 2) {
      process.stderr.write(result.message + "\n");
      process.exit(2);
    }
    process.exit(0);
  } catch {
    // Fail open on an internal error: a bug in the gate must not brick the agent.
    process.exit(0);
  }
}

// Only run the CLI when executed directly, not when imported by tests.
if (process.argv[1] && /(?:^|[/\\])(cli\.(?:ts|cjs|js)|precmd(?:\.cjs)?)$/.test(process.argv[1])) {
  void main();
}
