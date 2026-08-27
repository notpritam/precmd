// ABOUTME: Lazy git-backed repository Context plus an in-memory Context for tests.
// ABOUTME: All git shell-outs are memoized and never throw (null/[] on failure).
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import type { Context } from "./types";

function memo<T>(fn: () => T): () => T {
  let done = false;
  let value: T;
  return () => {
    if (!done) {
      value = fn();
      done = true;
    }
    return value;
  };
}

function git(cwd: string, args: string[]): string | null {
  try {
    return execFileSync("git", args, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return null;
  }
}

/** Context backed by real git commands rooted at `cwd`. */
export function createGitContext(cwd: string): Context {
  const branch = memo((): string | null => {
    const b = git(cwd, ["rev-parse", "--abbrev-ref", "HEAD"]);
    return b && b !== "HEAD" ? b : null;
  });
  const repoRoot = memo((): string | null => git(cwd, ["rev-parse", "--show-toplevel"]));
  const changedFiles = memo((): string[] => {
    const outputs = [
      git(cwd, ["diff", "--name-only"]),
      git(cwd, ["diff", "--name-only", "--cached"]),
      git(cwd, ["ls-files", "--others", "--exclude-standard"]),
    ];
    const all = new Set<string>();
    for (const out of outputs) {
      if (!out) continue;
      for (const line of out.split("\n")) {
        const p = line.trim();
        if (p) all.add(p);
      }
    }
    return [...all];
  });

  return {
    cwd,
    branch,
    changedFiles,
    repoRoot,
    readRepoFile(relPath: string): string | null {
      const root = repoRoot() ?? cwd;
      const p = isAbsolute(relPath) ? relPath : join(root, relPath);
      try {
        return readFileSync(p, "utf8");
      } catch {
        return null;
      }
    },
  };
}

/** In-memory Context for tests and the `check --branch/--changed` path. */
export function createStaticContext(init: {
  cwd?: string;
  branch?: string | null;
  changedFiles?: string[];
  repoRoot?: string | null;
  files?: Record<string, string>;
}): Context {
  const files = init.files ?? {};
  return {
    cwd: init.cwd ?? "/tmp",
    branch: () => init.branch ?? null,
    changedFiles: () => init.changedFiles ?? [],
    repoRoot: () => init.repoRoot ?? null,
    readRepoFile: (relPath: string) => (relPath in files ? files[relPath]! : null),
  };
}
