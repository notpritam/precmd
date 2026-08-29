// ABOUTME: Discovers and loads precmd.config.{mjs,js,json} and resolves rule packs.
// ABOUTME: Discovery walks up from a start directory; unknown/absent config = no rules.
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { buildGitConventionsPack } from "./rules/git-conventions";
import { buildSafetyPack } from "./rules/safety";
import { compileRules } from "./rules/spec";
import type { Config, Rule } from "./types";

export const DEFAULT_CONFIG: Config = { packs: [], git: {}, rules: [] };

const CONFIG_NAMES = ["precmd.config.mjs", "precmd.config.js", "precmd.config.json"];

/** Walk up from `startDir` to the first directory containing a precmd config. */
export function findConfigPath(startDir: string): string | null {
  let dir = resolve(startDir);
  for (;;) {
    for (const name of CONFIG_NAMES) {
      const p = join(dir, name);
      if (existsSync(p)) return p;
    }
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/** Load config discovered from `startDir`; returns defaults when absent or unreadable. */
export async function loadConfig(startDir: string): Promise<Config> {
  const p = findConfigPath(startDir);
  if (!p) return DEFAULT_CONFIG;
  try {
    if (p.endsWith(".json")) {
      return { ...DEFAULT_CONFIG, ...(JSON.parse(readFileSync(p, "utf8")) as Config) };
    }
    const mod = (await import(pathToFileURL(p).href)) as { default?: Config } & Config;
    return { ...DEFAULT_CONFIG, ...(mod.default ?? mod) };
  } catch (e) {
    // Fail open (a broken config must not brick the agent) — but not silently.
    process.stderr.write(
      `precmd: failed to load ${p} — enforcement is DISABLED until fixed: ${(e as Error).message}\n`,
    );
    return DEFAULT_CONFIG;
  }
}

/** Expand configured packs + custom rules into a flat rule list. Invalid specs are skipped. */
export function resolveRules(config: Config): Rule[] {
  const rules: Rule[] = [];
  for (const pack of config.packs ?? []) {
    if (pack === "git-conventions") rules.push(...buildGitConventionsPack(config.git ?? {}));
    else if (pack === "safety") rules.push(...buildSafetyPack());
  }
  if (config.rules) rules.push(...compileRules(config.rules).rules);
  return rules;
}

/** Return human-readable errors for any invalid custom rule specs (for `check`/debugging). */
export function validateConfig(config: Config): string[] {
  return config.rules ? compileRules(config.rules).errors : [];
}
