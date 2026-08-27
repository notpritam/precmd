// ABOUTME: Pure helpers for inspecting a parsed argv array.
// ABOUTME: No IO; used by rules to read flags, values, and positionals.

/** True if any of `flags` is present, matching exact tokens and `--flag=value` forms. */
export function hasFlag(argv: string[], flags: string[]): boolean {
  return argv.some(
    (t) => flags.includes(t) || flags.some((f) => f.startsWith("--") && t.startsWith(f + "=")),
  );
}

/** Value of a `--flag value` or `--flag=value`, or null when absent. */
export function flagValue(argv: string[], flag: string): string | null {
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i]!;
    if (t === flag) return argv[i + 1] ?? null;
    if (t.startsWith(flag + "=")) return t.slice(flag.length + 1);
  }
  return null;
}

/** Non-flag args after the command word (argv[0]). */
export function positionals(argv: string[]): string[] {
  return argv.slice(1).filter((t) => !t.startsWith("-"));
}

/** True if a short-flag cluster (e.g. `-vn`) contains the char `ch`. Excludes long flags. */
export function hasShortFlagChar(argv: string[], ch: string): boolean {
  return argv.some((t) => /^-[A-Za-z]+$/.test(t) && t.slice(1).includes(ch));
}
