# precmd — Design

`precmd` is a deterministic pre-command gate for AI coding agents. It inspects
every shell command an agent is about to run, matches it against a rule set, and
**blocks convention-violating commands before they execute** — turning "rules the
agent is supposed to remember" into rules the harness enforces.

The first shipped rule pack encodes git / GitHub / PR conventions, but the engine
is command-agnostic: a rule targets any command (`git`, `gh`, `rm`, `curl`, …),
so the same engine grows to cover any policy you can express over a command line.

---

## 1. Why

Coding agents forget conventions probabilistically. Prose in `AGENTS.md` /
`CLAUDE.md` ("never `git commit --no-verify`", "branch as `type/kebab-slug`",
"PRs target `staging`") is advisory — the agent complies most of the time, which
is exactly the failure mode that produces rare, expensive mistakes.

`precmd` makes the important subset **deterministic**: the command is checked by
the harness on every invocation, independent of whether the agent remembered.
A blocked command comes back to the agent with a precise, corrective message, so
it self-corrects in one round-trip and learns the rule.

## 2. Mechanism

`precmd` runs as a **Claude Code `PreToolUse` hook on the `Bash` tool**. The
hook contract (verified against the Claude Code docs) gives us exactly what we
need:

- The hook receives the full command on stdin at `.tool_input.command`, plus
  `.cwd`, `.permission_mode`, and (in subagents) `.agent_id` / `.agent_type`.
- **Enforcement primitive: write the reason to stderr and `exit 2`.** For
  `PreToolUse`, exit 2 denies the tool call and the stderr text is surfaced to
  the agent as the block reason. Plain stdout is *not* shown to the model on
  `PreToolUse`, and a hook that *times out* fails **open** — so the gate must be
  fast and must use `exit 2`, never rely on stdout or on a slow check.
- `exit 0` with no output = "no decision" (command proceeds through the normal
  permission flow). Staying silent never *approves* — it can only decline to
  block.

```
Bash tool call ──► PreToolUse hook ──► `precmd hook`
                                          │  reads {command, cwd, …} from stdin
                                          │  parses → matches rules → collects violations
                                          ├─ violations ► stderr = corrective message; exit 2  (BLOCKED)
                                          └─ clean       ► exit 0                                (ALLOWED)
```

### Determinism: no agent-reachable bypass

The gate is only as trustworthy as its escape hatches. `precmd` deliberately has
**no inline environment escape hatch** — honoring something like `PRECMD_OFF=1`
would be defeated by `PRECMD_OFF=1 git commit --no-verify`, because the agent
controls the whole command line. Human/local override is **out of band only**:
comment the hook out of `settings.local.json`, or remove it. This is the whole
point of the tool, so the override is intentionally inconvenient and never
something the agent can emit.

## 3. Architecture

Five units, each independently testable:

### 3.1 CLI (`src/cli.ts`)
- `precmd hook` — the enforcement path. Reads hook JSON from stdin, runs the
  engine against the working directory, exits `2` (+ stderr message) on any
  blocking violation, else `0`. This is what `settings.json` points at.
- `precmd check "<command>" [--branch <b>] [--changed <a,b>] [--cwd <dir>]` —
  a **pure** evaluation path for tests, CI, and manual debugging. No stdin, no
  git side effects unless asked; context can be injected via flags.
- `precmd init` — scaffolds the `PreToolUse` hook into `.claude/settings.json`
  and writes a starter `precmd.config` + vendored build.

### 3.2 Command parser (`src/parse.ts`)
Turns a raw command string into an ordered list of **invocations**. Handles:
- statement/pipeline separators `;`, `&&`, `||`, `|`;
- leading `VAR=val` env assignments (stripped off the command word, retained as
  invocation `env`);
- quoting;
- best-effort extraction of commands inside `$(…)` / backticks.

Each invocation is `{ argv: string[], env: Record<string,string>, raw: string }`.

**Posture on ambiguity is per rule-kind, not global:**
- *bypass guards* (e.g. `--no-verify`) fail **closed** — if the tokens plausibly
  contain the banned flag, block, even if the surrounding parse is uncertain.
- *structural rules* (e.g. "branch name after `checkout -b`") **skip** when the
  parse is uncertain rather than risk a false block.

### 3.3 Rule engine (`src/engine.ts`)
Matches each invocation to rules by `command` + optional `subcommand`
(`gh pr create` → command `gh`, subcommand `["pr","create"]`), runs every
matching rule, and **collects all violations in one pass** so the agent gets one
message listing everything to fix — not one block per error.

### 3.4 Context provider (`src/context.ts`)
Lazily derives repository facts that rules ask for, from `cwd`, memoized per run:
current branch, repo root, staged/changed files, and glob matchers. Rules that
don't need context never trigger a `git` subprocess, keeping the common path
fast.

### 3.5 Rule model — the extensibility core (`src/rules/`)
A rule is:

```ts
interface Rule {
  id: string;
  description: string;
  appliesTo: { command: string; subcommand?: string | string[] };
  severity: "block";                 // "warn" deferred — see §7
  evaluate(inv: Invocation, ctx: Context): Violation | null;
}
interface Violation { ruleId: string; message: string; fix?: string; }
```

Two authoring styles sit on the same interface:

- **Declarative rules** (JSON, zero code) for the common cases:
  - `denyFlag` — block if a flag/alias is present (`--no-verify`, `-n`).
  - `requireFlagValue` — a flag must equal a value (`--base` = `staging`).
  - `argPattern` — a positional arg must / must not match a regex (branch name).
  - `denyForceToProtected` — block `push --force*` to protected branches.
- **Programmatic rules** (a JS/TS module exporting `Rule[]`) for context-aware
  checks: marker string present in `--body` / `--body-file`, branch-class →
  required PR template, changed-path glob → required PR section.

The engine ships a built-in **`git-conventions` pack**; a repo enables it and
supplies parameters (allowed prefixes, protected branches, marker text, path
globs) via config, and can add its own custom rules.

## 4. Configuration

`precmd` loads config discovered from `cwd` upward (or `CLAUDE_PROJECT_DIR`):
`precmd.config.js` / `.ts` / `.json` at the repo root. The config selects packs,
sets their parameters, and appends custom rules:

```js
// precmd.config.js
export default {
  packs: ["git-conventions"],
  git: {
    protectedBranches: ["staging", "main"],
    defaultBase: "staging",
    branch: {
      allowedPrefixes: ["feat","fix","bug","chore","refactor","test","docs","ci","exp","hotfix","revert"],
      reservedPrefixes: ["codex","cursor","claude","claude-review","devin","dependabot"],
      slug: "kebab-case",
    },
    commit: { denyNoVerify: true },
    pr: {
      requireBase: "staging",
      requireBodyMarker: "### React 19 / Compiler notes",
      branchTemplates: [{ branchPrefix: "bug", template: ".github/PULL_REQUEST_TEMPLATE/bug.md" }],
      pathSectionRules: [{ changedGlobs: ["**/checkout/**","**/payment*/**"], requireSection: "### Payment checkout notes" }],
    },
  },
  rules: [/* custom Rule objects */],
};
```

Pure-declarative users can use `precmd.config.json` (the same shape minus the
`rules` function array). This keeps the barrier to entry at "edit JSON."

## 5. Packaging & distribution

- **Own repo, published to npm** as `precmd`. Authored in TypeScript for a typed
  rule/plugin API; built with esbuild to a single self-contained CJS bundle
  (`dist/cli.cjs`) so the hook has **zero runtime deps** and fast cold start.
- `npx precmd init` scaffolds the hook + starter config for any project.
- **Consumers pin a local install, not `npx …@latest`.** The hook must not do a
  network fetch on every command (slow, offline-fragile). Install `precmd` as a
  devDependency and point the hook at `node_modules/.bin/precmd`, or **vendor the
  single-file build** into `.claude/hooks/` for a fully self-contained repo.
- **Vendoring into a repo that lints committed hooks.** If the consumer lints or
  formats every committed JS file (E1ectron lints `.claude/hooks/*`), a minified
  bundle can't pass source linters. Vendor the build **without a JS extension**
  (e.g. `.claude/hooks/precmd`): Node still runs it as CommonJS (absent a
  `type: module` package), yet it is invisible to oxlint/ESLint (not a
  `.js`/`.cjs`/… file) and to Prettier (no inferable parser) — the honest
  classification for a generated artifact. The build carries an `ABOUTME` banner
  so header-lints on any sibling files stay satisfied.

### E1ectron as the first consumer
E1ectron adopts `precmd` by committing:
1. a `PreToolUse` hook entry in `.claude/settings.json` invoking the vendored
   build;
2. an `precmd.config` encoding its conventions (the parameters in §4 above);
3. the vendored `dist/cli.cjs`, pinned to a `precmd` version and re-vendored on
   upgrade.

This keeps the engine generic and open-source while the repo owns only its
declarative rule parameters.

## 6. Performance budget

The hook runs on **every** Bash call, so it must be cheap. Measured cold start of
the bundled `dist/cli.cjs` is ~22 ms (Apple silicon, Node 22) — dominated by Node
startup, far under the harness timeout. The parser is linear in command length;
context git-subprocesses run only when a matched rule demands them and are
memoized. No network, ever. The shipped bundle is a single ~21 KB CJS file with
zero runtime dependencies.

## 7. Non-goals (v1) / YAGNI

- **Auto-rewrite / auto-fix execution.** v1 blocks and *describes* the fix (a
  `fix` string), but never mutates or runs a corrected command.
- **`warn` severity.** The `PreToolUse` contract can't surface a non-blocking
  message to the agent (plain stdout is dropped). Deferred; may later map to the
  `ask` decision (escalate to the human).
- **Non-Bash hook events, HTTP/mcp_tool matchers.** Bash `PreToolUse` only.

Shipped since the original scope: a full **declarative condition DSL** (`src/rules/spec.ts`)
so any command can be guarded from JSON (`hasFlag`, `flagEquals`, `argMatches`,
`onBranch`, `changedPathMatches`, `pipedInto`, `all`/`any`/`not`, `command: "*"`);
**pipeline detection** in the parser (`pipedTo`, for `curl | sh`); **command-indexed
evaluation** for scale; and an opt-in **`safety` rule pack** (`rm -rf`, `curl | sh`,
`chmod 777`). Malformed specs are skipped, never fatal.

## 8. Roadmap

1. **Phase 1** — engine + parser + `git-conventions` pack + CLI (`hook`,
   `check`) + full test suite; E1ectron config + vendored hook wired and
   verified live. (This is the working deliverable.)
2. **Phase 2** — OSS polish: `precmd init`, README/quickstart, npm publish,
   documented plugin API, a couple of example non-git packs.

## 9. Testing strategy

- **Parser**: table-driven cases over compound commands, env prefixes, quoting,
  `$()`; assert extracted invocations.
- **Rules**: each rule gets red/green cases via the pure `check` path — a
  command that must block and a near-miss that must pass.
- **Engine**: multiple violations in one command surface in one message; rule
  matching by command+subcommand.
- **E1ectron pack**: one focused test per committed convention (no-verify,
  branch prefixes, `--base staging`, React-19 marker, bug template, payment
  section), mirroring the repo's existing `scripts/__tests__` + `*.test.js`
  pattern.
