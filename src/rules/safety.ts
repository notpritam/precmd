// ABOUTME: Opt-in "safety" pack — example rules for dangerous non-git commands.
// ABOUTME: Built entirely from the declarative DSL; enable via packs: ["safety"].
import type { Rule } from "../types";
import { compileRule } from "./spec";

/** A small set of dangerous-command guards. Enable with `packs: ["safety"]`; override freely. */
export function buildSafetyPack(): Rule[] {
  return [
    compileRule({
      id: "no-rm-rf-dangerous",
      description: "recursive rm targeting a root-ish path",
      command: "rm",
      when: {
        all: [
          { any: [{ hasShortChar: ["r"] }, { hasFlag: ["--recursive"] }] },
          { argMatches: "^(/|~|\\$HOME|/\\*|\\*)$" },
        ],
      },
      message: "Refusing recursive rm against a root-ish path (/, ~, $HOME, /*, *).",
      fix: "scope the delete to an explicit subdirectory",
    }),
    compileRule({
      id: "no-curl-pipe-shell",
      description: "curl piped straight into a shell",
      command: "curl",
      when: { pipedInto: ["sh", "bash", "zsh", "dash"] },
      message: "curl | sh executes remote code unreviewed.",
      fix: "download to a file, inspect it, then run it",
    }),
    compileRule({
      id: "no-wget-pipe-shell",
      description: "wget piped straight into a shell",
      command: "wget",
      when: { pipedInto: ["sh", "bash", "zsh", "dash"] },
      message: "wget | sh executes remote code unreviewed.",
      fix: "download to a file, inspect it, then run it",
    }),
    compileRule({
      id: "no-chmod-777",
      description: "world-writable + executable chmod",
      command: "chmod",
      when: { argMatches: "^(0?777|a\\+rwx)$" },
      message: "chmod 777 makes a path world-writable and executable.",
      fix: "grant the minimal needed mode (e.g. 644 / 755)",
    }),
  ];
}
