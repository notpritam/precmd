# precmd

**Deterministic pre-command guardrails for AI coding agents.**

`precmd` inspects every shell command your coding agent is about to run and
**blocks the ones that violate your conventions — before they execute**. It runs
as a Claude Code `PreToolUse` hook, so the check happens on every command whether
or not the agent "remembered" the rule. A blocked command returns to the agent
with a precise, corrective message, so it fixes itself in one step.

> Prose in `AGENTS.md` is advisory. `precmd` is enforced.

Ships with a **git / GitHub / PR** rule pack out of the box, but the engine is
command-agnostic — write a rule against any command (`git`, `gh`, `rm`, `curl`, …).

---

## What it catches (git pack)

- `git commit --no-verify` / `-n` (and `git merge --no-verify`) — hook-bypassing commits
- Committing directly **on** a protected branch (`staging`/`main`) — branch first
- Branch names off-convention — enforce `type/kebab-slug`, an allowed prefix
  list, and reserved tool-owned prefixes you must not hand-create
- `git push --force` **or** direct push to protected branches (`main`, `staging`, …)
- `gh pr create` against the wrong base branch
- PR bodies missing a required marker/section (e.g. a review-notes block)
- The wrong PR template for a branch class (e.g. `bug/*` must use the bug template)

All of it configurable; all of it enforced deterministically.

## How it works

```
Bash command ─► PreToolUse hook ─► precmd
                                     ├─ violates a rule ─► block + tell the agent exactly why & how to fix
                                     └─ clean            ─► allow
```

The enforcement primitive is a `PreToolUse` hook that `exit 2`s with the reason
on stderr — the only reliable way to deny a tool call and show the agent the
reason. There is **no environment escape hatch**: an agent controls the whole
command line, so a bypassable gate is no gate. Local override is out-of-band
(remove the hook).

## Configure any command (no code)

Rules are JSON. Drop a `precmd.config.json` at your repo root — the engine is
command-agnostic, so you can guard `kubectl`, `terraform`, `rm`, `docker`,
anything:

```json
{
  "packs": ["git-conventions", "safety"],
  "git": { "commit": { "denyNoVerify": true }, "protectedBranches": ["main"] },
  "rules": [
    {
      "id": "no-prod-kubectl",
      "command": "kubectl",
      "subcommand": ["delete"],
      "when": { "flagEquals": { "flag": "--namespace", "value": "production" } },
      "message": "No kubectl delete in production.",
      "fix": "target a staging namespace"
    },
    {
      "id": "no-terraform-apply-on-main",
      "command": "terraform",
      "subcommand": "apply",
      "when": { "onBranch": "^(main|staging)$" },
      "message": "Apply from a feature branch, not a protected one."
    }
  ]
}
```

A rule **fires (blocks)** when its `command`/`subcommand` match and `when` is
true. `"command": "*"` matches any command.

### Conditions

| Condition | Fires when |
|---|---|
| `{ "hasFlag": ["--x","-x"] }` | any listed flag is present |
| `{ "hasShortChar": ["n"] }` | a short cluster contains the char (`-n`, `-vn`) |
| `{ "flagEquals": { "flag":"--base","value":"staging" } }` | flag present and equals value |
| `{ "flagNotEquals": { "flag":"--base","value":"staging" } }` | flag missing or ≠ value (to *require* a value) |
| `{ "requireFlag": "--sign" }` | the flag is absent |
| `{ "argMatches": "^/$" }` / `{ "argNotMatches": "…" }` | a regex (un)matches any argument |
| `{ "commandMatches": "^sudo$" }` | regex matches the command word (pair with `"command": "*"`) |
| `{ "onBranch": "^main$" }` / `{ "notOnBranch": "…" }` | current branch (mis)matches |
| `{ "changedPathMatches": { "pattern":"**/payment*/**", "base":"main" } }` | a file changed vs base matches the glob |
| `{ "pipedInto": ["sh","bash"] }` | the command pipes into one of these (`curl … \| sh`) |
| `{ "all": [ … ] }` · `{ "any": [ … ] }` · `{ "not": … }` | combinators |
| `{ "always": true }` | always (block a command outright) |

A malformed rule is **skipped, never fatal** — the gate keeps working. Debug with
`precmd check "<command>"`.

## Status

Early. See [`DESIGN.md`](./DESIGN.md) for the full architecture and roadmap.
Phase 1 (engine + git pack + CLI + tests) is in progress.

## License

MIT © [notpritam](https://github.com/notpritam)
