// ABOUTME: Renders violations into the corrective stderr message shown to the agent.
// ABOUTME: This text is what the agent reads to self-correct after a block.
import type { Violation } from "./types";

/** Build the multi-line block printed to stderr when a command is blocked. */
export function formatViolations(violations: Violation[]): string {
  const n = violations.length;
  const header = `precmd blocked this command (${n} rule violation${n === 1 ? "" : "s"}):`;
  const lines = violations.map((v) => {
    const base = `  • [${v.ruleId}] ${v.message}`;
    return v.fix ? `${base}\n    ↳ fix: ${v.fix}` : base;
  });
  return [header, ...lines].join("\n");
}
