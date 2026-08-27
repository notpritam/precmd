# precmd Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the `precmd` engine + CLI + git-conventions rule pack that runs as a Claude Code `PreToolUse` hook and blocks convention-violating shell commands before they execute, then adopt it in E1ectron.

**Architecture:** A `PreToolUse` hook reads the command from stdin, a parser splits it into invocations, an engine matches each invocation against rules (declarative + programmatic) that pull repo facts from a lazy context provider, and any violation causes `exit 2` with a corrective stderr message. Authored in TypeScript, bundled to a single zero-dep CJS file with esbuild.

**Tech Stack:** Node ≥18, TypeScript, esbuild (bundler), vitest (tests). No runtime dependencies in the shipped bundle.

**Spec:** `/Volumes/X9/Dev/precmd/DESIGN.md`

## Global Constraints

- Enforcement primitive is **`exit 2` + stderr**; never rely on stdout to reach the agent (dropped on PreToolUse), never rely on a slow check (timeout fails open).
- **No agent-reachable bypass** — never honor an env var like `PRECMD_OFF`.
- Zero **runtime** dependencies in `dist/cli.cjs` (esbuild inlines everything; devDeps only).
- Every source file starts with two `// ABOUTME:` comment lines.
- Fail posture: bypass guards (`--no-verify`) fail **closed** on parse ambiguity; structural rules **skip** on ambiguity.
- Blocking message lists **all** violations for the command in one pass.
- Commit per task; push to `origin main` after each commit (gh active account = `notpritam`).

---

## File Structure

- `src/types.ts` — shared interfaces (Invocation, Context, Rule, Violation, Config, GitConfig, HookInput).
- `src/argv.ts` — pure flag/arg helpers over `string[]`.
- `src/parse.ts` — `parseCommand(raw): Invocation[]`.
- `src/engine.ts` — rule matching + `evaluate(...)`.
- `src/context.ts` — lazy git-backed `Context`, plus an injectable in-memory context for tests.
- `src/rules/declarative.ts` — factories that build `Rule`s from config (denyFlag, requireFlagValue, argPattern, denyForceToProtected).
- `src/rules/git-conventions.ts` — `buildGitConventionsPack(git: GitConfig): Rule[]`, incl. programmatic PR rules.
- `src/config.ts` — discover + load `precmd.config.{js,mjs,json}`; supply defaults.
- `src/format.ts` — `formatViolations(v: Violation[]): string`.
- `src/cli.ts` — `hook` and `check` subcommands; stdin/exit wiring.
- `src/*.test.ts` — co-located vitest suites.

---

### Task 1: Toolchain + core types

**Files:**
- Modify: `package.json` (add `@types/node`, `vitest` config script already present), `tsconfig.json` (exclude tests from emit)
- Create: `vitest.config.ts`, `src/types.ts`, `src/types.test.ts`

**Interfaces:**
- Produces: all shared types below (every later task consumes them).

- [ ] **Step 1: Install dev deps**

Run: `cd /Volumes/X9/Dev/precmd && yarn add -D esbuild typescript vitest @types/node`
Expected: installs; `yarn.lock` created.

- [ ] **Step 2: Add vitest config**

Create `vitest.config.ts`:
```ts
// ABOUTME: Vitest configuration for the precmd test suite.
// ABOUTME: Runs *.test.ts files co-located in src/ under the node environment.
import { defineConfig } from "vitest/config";
export default defineConfig({ test: { include: ["src/**/*.test.ts"], environment: "node" } });
```

- [ ] **Step 3: Exclude tests from tsc emit**

In `tsconfig.json`, add `"**/*.test.ts"` to `exclude`.

- [ ] **Step 4: Write core types**

Create `src/types.ts`:
```ts
// ABOUTME: Shared type contracts for the precmd engine, rules, and CLI.
// ABOUTME: Every other module imports its interfaces from here.
export interface Invocation {
  argv: string[];                 // command word + args, env assignments stripped
  env: Record<string, string>;    // leading VAR=val assignments
  raw: string;                    // original segment text
  uncertain: boolean;             // parser was not fully confident about this segment
}

export interface HookInput {
  tool_name?: string;
  tool_input?: { command?: string };
  cwd?: string;
  permission_mode?: string;
}

export interface Context {
  readonly cwd: string;
  branch(): string | null;              // current branch, memoized
  changedFiles(): string[];             // paths changed vs HEAD (staged+unstaged+untracked), repo-relative
  repoRoot(): string | null;
  readRepoFile(relPath: string): string | null;
}

export interface Violation { ruleId: string; message: string; fix?: string; }

export interface Rule {
  id: string;
  description: string;
  appliesTo: { command: string; subcommand?: string | string[] };
  evaluate(inv: Invocation, ctx: Context): Violation | null;
}

export interface GitConfig {
  protectedBranches?: string[];
  defaultBase?: string;
  branch?: { allowedPrefixes?: string[]; reservedPrefixes?: string[]; slug?: "kebab-case" };
  commit?: { denyNoVerify?: boolean };
  push?: { denyForceToProtected?: boolean; denyNoVerify?: boolean };
  pr?: {
    requireBase?: string;
    requireBodyMarker?: string | string[];
    branchTemplates?: { branchPrefix: string; template: string }[];
    pathSectionRules?: { changedGlobs: string[]; requireSection: string }[];
  };
}

export interface Config { packs?: string[]; git?: GitConfig; rules?: Rule[]; }
```

- [ ] **Step 5: Sanity test compiles/imports**

Create `src/types.test.ts`:
```ts
// ABOUTME: Compile/shape smoke test for shared types.
// ABOUTME: Guards against accidental breaking edits to the type contracts.
import { expect, test } from "vitest";
import type { Rule, Violation } from "./types";
test("Rule/Violation shapes are usable", () => {
  const r: Rule = { id: "x", description: "d", appliesTo: { command: "git" }, evaluate: () => null };
  const v: Violation = { ruleId: "x", message: "m" };
  expect(r.evaluate({ argv: ["git"], env: {}, raw: "git", uncertain: false }, {} as any)).toBeNull();
  expect(v.ruleId).toBe("x");
});
```

- [ ] **Step 6: Run + commit**

Run: `yarn test`  → Expected: PASS.
```bash
git -C /Volumes/X9/Dev/precmd add -A
git -C /Volumes/X9/Dev/precmd commit -q -m "feat: toolchain + core type contracts"
git -C /Volumes/X9/Dev/precmd push -q origin main
```

---

### Task 2: argv helpers

**Files:** Create `src/argv.ts`, `src/argv.test.ts`

**Interfaces:**
- Produces:
  - `hasFlag(argv: string[], flags: string[]): boolean`
  - `flagValue(argv: string[], flag: string): string | null` (handles `--flag v` and `--flag=v`)
  - `positionals(argv: string[]): string[]` (non-flag args after argv[0])
  - `hasShortFlagChar(argv: string[], ch: string): boolean` (matches `-n` and clusters like `-vn`)

- [ ] **Step 1: Failing tests**
```ts
// ABOUTME: Tests for pure argv flag/value/positional helpers.
// ABOUTME: These underpin every rule's flag inspection.
import { expect, test } from "vitest";
import { hasFlag, flagValue, positionals, hasShortFlagChar } from "./argv";
test("hasFlag exact", () => { expect(hasFlag(["git","commit","--no-verify"], ["--no-verify","-n"])).toBe(true); });
test("flagValue space + equals", () => {
  expect(flagValue(["gh","pr","create","--base","staging"], "--base")).toBe("staging");
  expect(flagValue(["gh","pr","create","--base=main"], "--base")).toBe("main");
  expect(flagValue(["gh","pr","create"], "--base")).toBeNull();
});
test("positionals skip flags and command word", () => {
  expect(positionals(["git","checkout","-b","feat/x"])).toEqual(["checkout","feat/x"]);
});
test("hasShortFlagChar matches cluster", () => {
  expect(hasShortFlagChar(["git","commit","-vn"], "n")).toBe(true);
  expect(hasShortFlagChar(["git","commit","-v"], "n")).toBe(false);
});
```
Run: `yarn test src/argv.test.ts` → Expected: FAIL (module not found).

- [ ] **Step 2: Implement**
```ts
// ABOUTME: Pure helpers for inspecting a parsed argv array.
// ABOUTME: No IO; used by rules to read flags, values, and positionals.
export function hasFlag(argv: string[], flags: string[]): boolean {
  return argv.some((t) => flags.includes(t) || flags.some((f) => f.startsWith("--") && t.startsWith(f + "=")));
}
export function flagValue(argv: string[], flag: string): string | null {
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i]!;
    if (t === flag) return argv[i + 1] ?? null;
    if (t.startsWith(flag + "=")) return t.slice(flag.length + 1);
  }
  return null;
}
export function positionals(argv: string[]): string[] {
  return argv.slice(1).filter((t) => !t.startsWith("-"));
}
export function hasShortFlagChar(argv: string[], ch: string): boolean {
  return argv.some((t) => /^-[A-Za-z]+$/.test(t) && t.slice(1).includes(ch));
}
```
Run: `yarn test src/argv.test.ts` → Expected: PASS.

- [ ] **Step 3: Commit + push** (`feat: argv flag/value/positional helpers`).

---

### Task 3: Command parser

**Files:** Create `src/parse.ts`, `src/parse.test.ts`

**Interfaces:**
- Consumes: `Invocation` from types.
- Produces: `parseCommand(raw: string): Invocation[]`.

Behavior: split on top-level `;`, `&&`, `||`, `|` (respecting single/double quotes); per segment strip leading `VAR=val` into `env`, tokenize remaining respecting quotes into `argv`; also scan for `$( … )` / backticks and emit their inner commands as additional invocations. Set `uncertain: true` for a segment whose quotes are unbalanced.

- [ ] **Step 1: Failing tests**
```ts
// ABOUTME: Tests for the shell-ish command splitter/tokenizer.
// ABOUTME: Covers separators, env prefixes, quoting, and command substitution.
import { expect, test } from "vitest";
import { parseCommand } from "./parse";
const cmds = (s: string) => parseCommand(s).map((i) => i.argv);
test("compound &&", () => { expect(cmds("cd x && git commit -n")).toEqual([["cd","x"],["git","commit","-n"]]); });
test("pipe", () => { expect(cmds("git log | head")).toEqual([["git","log"],["head"]]); });
test("env prefix stripped", () => {
  const inv = parseCommand("FOO=bar git push")[0]!;
  expect(inv.argv).toEqual(["git","push"]); expect(inv.env).toEqual({ FOO: "bar" });
});
test("quotes keep spaces", () => { expect(cmds(`git commit -m "a b c"`)).toEqual([["git","commit","-m","a b c"]]); });
test("command substitution surfaced", () => {
  expect(cmds("echo $(rm -rf /tmp/x)")).toContainEqual(["rm","-rf","/tmp/x"]);
});
```
Run → Expected: FAIL.

- [ ] **Step 2: Implement `src/parse.ts`** — tokenizer that walks the string char-by-char tracking quote state, emitting tokens on unquoted whitespace and breaking segments on unquoted `;`, `&&`, `||`, `|`; extracts leading `^[A-Za-z_][A-Za-z0-9_]*=…` tokens as env; regex-extracts `\$\(([^)]*)\)` and backtick spans and recursively parses their contents as extra invocations. (Full implementation written during execution; keep it dependency-free and under ~120 lines.)

Acceptance: all Step-1 tests pass; a segment with an unbalanced quote yields `uncertain: true` and best-effort argv.

- [ ] **Step 3: Run + commit + push** (`feat: shell command parser into invocations`).

---

### Task 4: Rule engine

**Files:** Create `src/engine.ts`, `src/engine.test.ts`

**Interfaces:**
- Consumes: `Invocation`, `Rule`, `Violation`, `Context`.
- Produces:
  - `commandOf(inv): string | null` (= `argv[0]`)
  - `subcommandTokens(inv): string[]` (leading positionals after command, up to first flag)
  - `ruleApplies(rule, inv): boolean`
  - `evaluate(invocations: Invocation[], rules: Rule[], ctx: Context): Violation[]`

`ruleApplies`: command matches `appliesTo.command`; if `appliesTo.subcommand` set (string or array), the invocation's leading subcommand tokens must start-with that sequence (array = ordered prefix, e.g. `["pr","create"]`).

- [ ] **Step 1: Failing tests**
```ts
// ABOUTME: Tests for rule matching and multi-violation evaluation.
import { expect, test } from "vitest";
import { evaluate, ruleApplies, subcommandTokens } from "./engine";
import type { Rule } from "./types";
const inv = (argv: string[]) => ({ argv, env: {}, raw: argv.join(" "), uncertain: false });
const mk = (id: string, applies: Rule["appliesTo"]): Rule =>
  ({ id, description: id, appliesTo: applies, evaluate: () => ({ ruleId: id, message: id }) });
test("subcommandTokens stops at first flag", () => {
  expect(subcommandTokens(inv(["gh","pr","create","--base","x"]))).toEqual(["pr","create"]);
});
test("array subcommand is ordered prefix", () => {
  expect(ruleApplies(mk("r", { command: "gh", subcommand: ["pr","create"] }), inv(["gh","pr","create"]))).toBe(true);
  expect(ruleApplies(mk("r", { command: "gh", subcommand: ["pr","create"] }), inv(["gh","pr","list"]))).toBe(false);
});
test("evaluate collects all violations across invocations", () => {
  const rules = [mk("a", { command: "git", subcommand: "commit" }), mk("b", { command: "git", subcommand: "push" })];
  const out = evaluate([inv(["git","commit"]), inv(["git","push"])], rules, {} as any);
  expect(out.map((v) => v.ruleId)).toEqual(["a","b"]);
});
```
Run → FAIL.

- [ ] **Step 2: Implement** the four functions (pure, no IO). Commit + push (`feat: rule matching + evaluation engine`).

---

### Task 5: Context provider

**Files:** Create `src/context.ts`, `src/context.test.ts`

**Interfaces:**
- Produces:
  - `createGitContext(cwd: string): Context` — memoized `git` shell-outs via `child_process.execFileSync` (`git`, `["rev-parse","--abbrev-ref","HEAD"]`, etc.); returns `null`/`[]` on failure, never throws.
  - `createStaticContext(init: { cwd?; branch?; changedFiles?; repoRoot?; files? }): Context` — in-memory, for tests and the `check --branch/--changed` path.

- [ ] **Step 1: Failing tests** — assert `createStaticContext({ branch: "bug/x", changedFiles: ["src/checkout/pay.ts"] })` returns those verbatim and memoizes; `readRepoFile` returns injected file content or null.
- [ ] **Step 2: Implement** both factories. `createGitContext` wraps each fact in a memo + try/catch; `changedFiles` = union of `git diff --name-only`, `git diff --name-only --cached`, `git ls-files --others --exclude-standard`.
- [ ] **Step 3: Run + commit + push** (`feat: lazy git context + static test context`).

---

### Task 6: Declarative rule factories

**Files:** Create `src/rules/declarative.ts`, `src/rules/declarative.test.ts`

**Interfaces:**
- Consumes: `Rule`, `Invocation`, argv helpers.
- Produces:
  - `denyFlag(o: { id; description; command; subcommand?; flags: string[]; shortChars?: string[]; message: string; fix?: string }): Rule`
  - `requireFlagValue(o: { id; description; command; subcommand?; flag: string; equals: string; message?: string }): Rule`
  - `argPattern(o: { id; description; command; subcommand?; argIndexAfter?: string; pattern: RegExp; mustMatch: boolean; message: string; fix?: string }): Rule`

- [ ] **Step 1: Failing tests** — one red + one green per factory. E.g. `denyFlag` for `git commit --no-verify` → violation; `git commit -m x` → null. `requireFlagValue --base staging` → `--base main` violates, `--base staging` passes, missing `--base` violates (treated as not-equal).
- [ ] **Step 2: Implement** the three factories using `src/argv.ts`. `denyFlag` also checks `shortChars` via `hasShortFlagChar` (fail-closed bypass posture).
- [ ] **Step 3: Run + commit + push** (`feat: declarative rule factories`).

---

### Task 7: git-conventions pack

**Files:** Create `src/rules/git-conventions.ts`, `src/rules/git-conventions.test.ts`

**Interfaces:**
- Consumes: declarative factories, argv helpers, `Context`, `GitConfig`.
- Produces: `buildGitConventionsPack(git: GitConfig): Rule[]`.

Rules assembled (each gated on the relevant `git.*` config being present):
1. **commit-no-verify** — `denyFlag` on `git commit`, flags `["--no-verify"]`, shortChars `["n"]`.
2. **push-no-verify** — `denyFlag` on `git push`, flags `["--no-verify"]` (bypasses pre-push).
3. **branch-name** — programmatic: on `git checkout` (with `-b`), `git switch` (with `-c`), `git branch`. Extract new-branch name; if it starts with a `reservedPrefixes` value → violation "reserved/tool-owned prefix"; else must match `^(<allowed>)\/[a-z0-9]+(-[a-z0-9]+)*$` → else violation listing allowed prefixes + kebab rule. Skip when no new-branch arg present (e.g. `git branch` listing).
4. **push-force-protected** — programmatic: on `git push`, if a force flag (`--force`,`-f`,`--force-with-lease`,`--force-if-includes`) present AND (target is a protected branch: a protected name appears among positionals, OR no branch positional and `ctx.branch()` is protected) → violation.
5. **pr-base** — `requireFlagValue` on `gh pr create`, `--base` = `git.pr.requireBase`.
6. **pr-marker** — programmatic on `gh pr create`/`gh pr edit`: resolve body from `--body`, `--body-file` (via `ctx.readRepoFile`), else empty; if body does not contain every `requireBodyMarker` → violation.
7. **pr-branch-template** — programmatic on `gh pr create`: for each `branchTemplates` entry, if `ctx.branch()` starts with `<branchPrefix>/`, require `--body-file` to equal (basename or path-suffix match) the entry's `template` → else violation.
8. **pr-path-section** — programmatic on `gh pr create`/`edit`: for each `pathSectionRules`, if any `ctx.changedFiles()` matches any glob, require body to contain `requireSection` → else violation.

Glob match: implement a tiny `globMatch(glob, path)` (translate `**`,`*` to regex) inside this module or `src/argv.ts` sibling `src/glob.ts`.

- [ ] **Step 1: Failing tests** (static context injected) — at minimum one red + one green for rules 3, 4, 6, 7, 8 (the programmatic ones), plus a smoke test that `buildGitConventionsPack(fullConfig)` returns the expected rule ids.

Representative test:
```ts
import { createStaticContext } from "../context";
import { evaluate } from "../engine";
import { parseCommand } from "../parse";
import { buildGitConventionsPack } from "./git-conventions";
const cfg = { branch: { allowedPrefixes: ["feat","fix","bug"], reservedPrefixes: ["codex","claude"] },
  pr: { requireBase: "staging", requireBodyMarker: "### React 19 / Compiler notes",
        branchTemplates: [{ branchPrefix: "bug", template: ".github/PULL_REQUEST_TEMPLATE/bug.md" }],
        pathSectionRules: [{ changedGlobs: ["**/checkout/**"], requireSection: "### Payment checkout notes" }] } };
const rules = buildGitConventionsPack(cfg);
test("bad branch prefix blocks", () => {
  const v = evaluate(parseCommand("git checkout -b feature/thing"), rules, createStaticContext({}));
  expect(v.map(x=>x.ruleId)).toContain("branch-name");
});
test("reserved prefix blocks with specific message", () => {
  const v = evaluate(parseCommand("git switch -c claude/x"), rules, createStaticContext({}));
  expect(v.find(x=>x.ruleId==="branch-name")!.message).toMatch(/reserved/i);
});
test("pr missing marker blocks", () => {
  const v = evaluate(parseCommand(`gh pr create --base staging --title t --body "hello"`), rules, createStaticContext({}));
  expect(v.map(x=>x.ruleId)).toContain("pr-marker");
});
test("payment path requires section", () => {
  const ctx = createStaticContext({ changedFiles: ["src/checkout/pay.ts"] });
  const v = evaluate(parseCommand(`gh pr create --base staging --body "### React 19 / Compiler notes"`), rules, ctx);
  expect(v.map(x=>x.ruleId)).toContain("pr-path-section");
});
```
Run → FAIL.

- [ ] **Step 2: Implement** `buildGitConventionsPack` + `src/glob.ts`. Commit + push (`feat: git-conventions rule pack`).

---

### Task 8: Config loader

**Files:** Create `src/config.ts`, `src/config.test.ts`

**Interfaces:**
- Produces:
  - `DEFAULT_CONFIG: Config` (empty packs, no git → engine no-ops when unconfigured).
  - `loadConfig(cwd: string): Promise<Config>` — walk up from `cwd` (or `CLAUDE_PROJECT_DIR`) to find `precmd.config.mjs|js|json`; dynamic-`import()` the JS forms, `JSON.parse` the json form; merge over defaults; on absence return defaults.
  - `resolveRules(config: Config): Rule[]` — expand `packs` (currently only `"git-conventions"` → `buildGitConventionsPack(config.git ?? {})`) and append `config.rules`.

- [ ] **Step 1: Failing tests** — write a temp `precmd.config.json` in a tmp dir, assert `loadConfig` finds it walking up from a subdir; assert `resolveRules({ packs:["git-conventions"], git:{ commit:{denyNoVerify:true} } })` includes `commit-no-verify`.
- [ ] **Step 2: Implement.** Commit + push (`feat: config discovery + rule resolution`).

---

### Task 9: Formatter + CLI

**Files:** Create `src/format.ts`, `src/format.test.ts`, `src/cli.ts`, `src/cli.test.ts`

**Interfaces:**
- `formatViolations(v: Violation[]): string` — a compact multi-line block: a header, then per violation `• [ruleId] message` and `↳ fix: …` when present.
- CLI:
  - `precmd check "<command>" [--branch b] [--changed a,b] [--cwd dir]` — parse→resolveRules(loadConfig)→evaluate with a static context built from flags (falling back to git context when flags absent and `--cwd` is a repo); print message to stderr and exit 2 if violations, else exit 0 silent.
  - `precmd hook` — read all stdin, `JSON.parse` as `HookInput`, take `tool_input.command` (exit 0 if absent/non-Bash), build git context from `cwd`, evaluate, exit 2 + stderr on violations else exit 0. Must never throw: wrap in try/catch that exits 0 (fail-open on internal error is the safe default for a gate that must not brick the agent — except we still block on real violations).

- [ ] **Step 1: Failing tests**
  - `format.test.ts`: message contains ruleId + fix line.
  - `cli.test.ts`: spawn the CLI via `execFileSync("node", ["./dist/cli.cjs","check","git commit --no-verify"])` is deferred to Task 10 (needs build); here unit-test an exported `runCheck(args): { code, message }` and `runHook(json): { code, message }` pure-ish functions that `cli.ts` wraps, so logic is tested without a subprocess.

```ts
import { runHook } from "./cli";
test("hook blocks --no-verify via config", async () => {
  const res = await runHook(JSON.stringify({ tool_name:"Bash", tool_input:{ command:"git commit --no-verify" }, cwd: process.cwd() }),
    { git:{ commit:{ denyNoVerify:true } } });
  expect(res.code).toBe(2); expect(res.message).toMatch(/no-verify/);
});
test("hook allows clean command", async () => {
  const res = await runHook(JSON.stringify({ tool_name:"Bash", tool_input:{ command:"git status" }, cwd: process.cwd() }), {});
  expect(res.code).toBe(0);
});
```
(Design `runHook(json, injectedConfig?)` / `runCheck(argv, injectedConfig?)` so tests inject config instead of discovering it.)

- [ ] **Step 2: Implement** `format.ts` and `cli.ts` with exported `runCheck`/`runHook` + a thin `main()` that does stdin/argv/exit. Commit + push (`feat: formatter + hook/check CLI`).

---

### Task 10: Build + end-to-end smoke

**Files:** Modify `package.json` (ensure `build` script), Create `src/e2e.test.ts`

- [ ] **Step 1:** Run `yarn build` → `dist/cli.cjs` exists.
- [ ] **Step 2: Failing/observing test** — `e2e.test.ts` uses `execFileSync` to run the built bundle against a temp git repo with a temp `precmd.config.json`:
  - `git commit --no-verify` → exit 2, stderr matches `no-verify`.
  - `git status` → exit 0.
  - piped hook: `echo '{"tool_name":"Bash","tool_input":{"command":"git commit -n"}}' | node dist/cli.cjs hook` → exit 2.
- [ ] **Step 3:** Verify all pass; measure cold-start (`time node dist/cli.cjs check "git status"`) and record in DESIGN.md perf note.
- [ ] **Step 4: Commit + push** (`test: end-to-end built-bundle smoke + perf note`).

---

### Task 11: E1ectron adoption (operates in the E1ectron repo)

> **Account switch:** run `gh auth switch --user notpritamm` before any E1ectron gh/PR work; the E1ectron pre-commit hook must pass (never `--no-verify`). This task's commits go through E1ectron's own gates.

**Files (in `/Users/notpritamm/.bb/worktrees/env_k2cdkkmk4m/E1ectron`):**
- Create: `.claude/hooks/precmd.cjs` (vendored copy of `dist/cli.cjs`, pinned).
- Create: `precmd.config.json` (E1ectron conventions — values copied from `recipes/git-pr.md`).
- Modify: `.claude/settings.json` (add PreToolUse → Bash → command hook).

- [ ] **Step 1:** Copy `dist/cli.cjs` → `.claude/hooks/precmd.cjs`.
- [ ] **Step 2:** Write `precmd.config.json`:
```json
{
  "packs": ["git-conventions"],
  "git": {
    "protectedBranches": ["staging", "main"],
    "defaultBase": "staging",
    "branch": {
      "allowedPrefixes": ["feat","fix","bug","chore","refactor","test","docs","ci","exp","hotfix","revert"],
      "reservedPrefixes": ["codex","cursor","claude","claude-review","devin","dependabot"],
      "slug": "kebab-case"
    },
    "commit": { "denyNoVerify": true },
    "push": { "denyForceToProtected": true, "denyNoVerify": true },
    "pr": {
      "requireBase": "staging",
      "requireBodyMarker": "### React 19 / Compiler notes",
      "branchTemplates": [{ "branchPrefix": "bug", "template": ".github/PULL_REQUEST_TEMPLATE/bug.md" }],
      "pathSectionRules": [{ "changedGlobs": ["**/checkout/**","**/payment*/**","**/*paddle*/**","**/*pagbrasil*/**"], "requireSection": "### Payment checkout notes" }]
    }
  }
}
```
- [ ] **Step 3:** Add to `.claude/settings.json`:
```json
{ "hooks": { "PreToolUse": [ { "matcher": "Bash", "hooks": [
  { "type": "command", "command": "node \"${CLAUDE_PROJECT_DIR}/.claude/hooks/precmd.cjs\" hook" } ] } ] } }
```
(Merge into any existing hooks block rather than overwriting.)
- [ ] **Step 4: Live verification** (the acceptance gate — real, not mocked):
  - In a scratch Bash call, attempt `git commit --no-verify -m x` → observe the hook blocks it with the corrective message.
  - Attempt `git checkout -b feature/foo` → blocked; `git checkout -b feat/foo` → allowed.
  - Attempt `gh pr create --base main …` → blocked.
  - Confirm a normal `git status` / `ls` is unaffected.
- [ ] **Step 5:** Commit in E1ectron on a `chore/` branch through the pre-commit hook; open PR to `staging` with the required `### React 19 / Compiler notes` line (`Not applicable — no React component changes.`).

---

## Self-Review

- **Spec coverage:** mechanism (Task 9/10), parser (2/3), engine (4), rule model declarative+programmatic (6/7), context (5), config (8), git pack incl. all E1ectron conventions (7), packaging/build (10), E1ectron adoption + live verify (11), determinism/no-bypass (Global Constraints + Task 9 note), perf (10). No spec section left without a task.
- **Placeholders:** parser (Task 3 Step 2) and a few programmatic rules describe the algorithm precisely with acceptance tests rather than pasting every line; all other steps carry concrete code. No "TBD/handle edge cases".
- **Type consistency:** `Context` methods (`branch()`, `changedFiles()`, `repoRoot()`, `readRepoFile()`), `Rule.appliesTo`, `evaluate(...)` signature, `runHook(json, config?)`/`runCheck(argv, config?)` are used identically across Tasks 4–11.
