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

- `git commit --no-verify` / `-n` — hook-bypassing commits
- Branch names off-convention — enforce `type/kebab-slug`, an allowed prefix
  list, and reserved tool-owned prefixes you must not hand-create
- `git push --force` to protected branches (`main`, `staging`, …)
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

## Status

Early. See [`DESIGN.md`](./DESIGN.md) for the full architecture and roadmap.
Phase 1 (engine + git pack + CLI + tests) is in progress.

## License

MIT © [notpritam](https://github.com/notpritam)
