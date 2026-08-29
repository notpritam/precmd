// ABOUTME: Splits a raw shell command line into structured invocations.
// ABOUTME: Handles separators, quoting, comments, subshells, env prefixes, substitution, pipelines.
import type { Invocation } from "./types";

interface Segment {
  tokens: string[];
  /** true when this segment was terminated by a single `|` (same pipeline continues). */
  pipeNext: boolean;
  /** subshell nesting depth of this segment (0 = top level). */
  depth: number;
}

interface Scan {
  segments: Segment[];
  subs: string[];
  unbalanced: boolean;
}

/** Tokenize + segment a raw command, respecting quotes, comments, subshells and operators. */
function scan(raw: string): Scan {
  const segments: Segment[] = [];
  const subs: string[] = [];
  let cur: string[] = [];
  let buf = "";
  let hasBuf = false;
  let inSingle = false;
  let inDouble = false;
  let unbalanced = false;
  let depth = 0;

  const endToken = (): void => {
    if (hasBuf) {
      cur.push(buf);
      buf = "";
      hasBuf = false;
    }
  };
  const endSegment = (pipeNext: boolean): void => {
    endToken();
    if (cur.length) {
      segments.push({ tokens: cur, pipeNext, depth });
      cur = [];
    }
  };

  for (let i = 0; i < raw.length; i++) {
    const c = raw[i]!;

    if (inSingle) {
      if (c === "'") inSingle = false;
      else buf += c;
      hasBuf = true;
      continue;
    }
    if (inDouble) {
      if (c === '"') inDouble = false;
      else if (c === "\\" && i + 1 < raw.length) buf += raw[++i]!;
      else buf += c;
      hasBuf = true;
      continue;
    }

    if (c === "'") {
      inSingle = true;
      hasBuf = true;
      continue;
    }
    if (c === '"') {
      inDouble = true;
      hasBuf = true;
      continue;
    }
    if (c === "\\" && i + 1 < raw.length) {
      buf += raw[++i]!;
      hasBuf = true;
      continue;
    }

    // comment: `#` at a word boundary runs to end of line
    if (c === "#" && !hasBuf) {
      let j = i;
      while (j < raw.length && raw[j] !== "\n") j++;
      i = j - 1;
      continue;
    }

    // command substitution: $( ... ) with nesting
    if (c === "$" && raw[i + 1] === "(") {
      let d = 1;
      let j = i + 2;
      let inner = "";
      for (; j < raw.length && d > 0; j++) {
        const ch = raw[j]!;
        if (ch === "(") d++;
        else if (ch === ")") {
          d--;
          if (d === 0) break;
        }
        inner += ch;
      }
      if (d !== 0) unbalanced = true;
      subs.push(inner);
      buf += "$(" + inner + ")";
      hasBuf = true;
      i = j;
      continue;
    }

    // backtick substitution
    if (c === "`") {
      let j = i + 1;
      let inner = "";
      for (; j < raw.length && raw[j] !== "`"; j++) inner += raw[j]!;
      if (j >= raw.length) unbalanced = true;
      subs.push(inner);
      buf += "`" + inner + "`";
      hasBuf = true;
      i = j;
      continue;
    }

    // subshell grouping — its own scope for `cd`
    if (c === "(") {
      endSegment(false);
      depth++;
      continue;
    }
    if (c === ")") {
      endSegment(false);
      if (depth > 0) depth--;
      continue;
    }

    // top-level operators (order matters)
    if (c === "&") {
      if (raw[i + 1] === "&") {
        endSegment(false);
        i++;
        continue;
      }
      if (raw[i + 1] === ">" || hasBuf) {
        buf += c; // redirect (`&>`, `2>&1`, `>&2`), not a background operator
        hasBuf = true;
        continue;
      }
      endSegment(false); // lone `&` backgrounds the preceding command
      continue;
    }
    if (c === "|" && raw[i + 1] === "|") {
      endSegment(false);
      i++;
      continue;
    }
    if (c === "|") {
      endSegment(true); // single pipe: next segment is in the same pipeline
      continue;
    }
    if (c === ";" || c === "\n") {
      endSegment(false);
      continue;
    }

    if (c === " " || c === "\t" || c === "\r") {
      endToken();
      continue;
    }

    buf += c;
    hasBuf = true;
  }

  if (inSingle || inDouble) unbalanced = true;
  endSegment(false);
  return { segments, subs, unbalanced };
}

const ENV_ASSIGN = /^[A-Za-z_][A-Za-z0-9_]*=/;

// Wrappers that run the command that follows (dropped to reveal the real command).
const WRAPPERS = new Set([
  "command",
  "builtin",
  "exec",
  "sudo",
  "doas",
  "env",
  "nohup",
  "setsid",
  "nocorrect",
  "xargs",
  "nice",
  "ionice",
  "timeout",
  "time",
  "stdbuf",
  "chrt",
  "taskset",
]);
// Shell keywords/prefixes that lead a command inside a compound statement.
const KEYWORDS = new Set(["if", "then", "else", "elif", "do", "while", "until", "!", "{"]);
// Shells that run a command string passed after `-c`.
const SHELL_C = new Set(["sh", "bash", "zsh", "dash", "ksh"]);

function make(argv: string[], from: Invocation): Invocation {
  return {
    argv,
    env: from.env,
    raw: argv.join(" "),
    uncertain: from.uncertain,
    pipedTo: from.pipedTo,
    depth: from.depth,
  };
}

/**
 * Reveal the real command behind shell wrappers, keywords, and `-c`/`eval` strings.
 * A wrapper's real command can sit after value-taking options (`sudo -u root git …`),
 * so we emit a candidate starting at every subsequent non-option token — arity-agnostic —
 * and keep the original so a rule can still match the wrapper itself.
 */
function unwrap(inv: Invocation, depth: number): Invocation[] {
  if (depth > 16) return [inv];
  let argv = inv.argv;
  let changed = false;
  while (argv.length && KEYWORDS.has(argv[0]!)) {
    argv = argv.slice(1);
    changed = true;
  }
  if (argv.length === 0) return [inv];
  const head = argv[0]!;

  if (WRAPPERS.has(head) && argv.length > 1) {
    const out: Invocation[] = [inv];
    const seen = new Set<string>();
    for (let j = 1; j < argv.length; j++) {
      const t = argv[j]!;
      if (t.startsWith("-") || ENV_ASSIGN.test(t)) continue;
      const tail = argv.slice(j);
      const key = tail.join(" ");
      if (seen.has(key)) continue;
      seen.add(key);
      for (const u of unwrap(make(tail, inv), depth + 1)) out.push(u);
    }
    return out;
  }

  // `sh -c "git …"` — runs in a subshell, so a `cd` inside must not leak out (depth + 1).
  if (SHELL_C.has(head)) {
    const ci = argv.indexOf("-c");
    if (ci >= 0 && argv[ci + 1] !== undefined) {
      const base = (inv.depth ?? 0) + 1;
      return [inv, ...parseCommand(argv[ci + 1]!).map((x) => ({ ...x, depth: base + (x.depth ?? 0) }))];
    }
  }
  // `eval "git …"` — runs in the current shell (cd persists), keep the invocation's depth.
  if (head === "eval") {
    const rest = argv.slice(1).join(" ");
    if (!rest.trim()) return [inv];
    const base = inv.depth ?? 0;
    return [inv, ...parseCommand(rest).map((x) => ({ ...x, depth: base + (x.depth ?? 0) }))];
  }
  // `gh pr new` is a documented alias of `gh pr create`.
  if (head === "gh" && argv[1] === "pr" && argv[2] === "new") {
    argv = ["gh", "pr", "create", ...argv.slice(3)];
    changed = true;
  }

  if (!changed) return [inv];
  return [inv, make(argv, inv)];
}

function buildInvocation(tokens: string[], uncertain: boolean, depth: number): Invocation | null {
  const env: Record<string, string> = {};
  let k = 0;
  while (k < tokens.length && ENV_ASSIGN.test(tokens[k]!)) {
    const t = tokens[k]!;
    const eq = t.indexOf("=");
    env[t.slice(0, eq)] = t.slice(eq + 1);
    k++;
  }
  const argv = tokens.slice(k);
  if (argv.length === 0) return null;
  return { argv, env, raw: tokens.join(" "), uncertain, pipedTo: [], depth };
}

/** Parse a (possibly compound) command line into invocations, including substitutions. */
export function parseCommand(raw: string): Invocation[] {
  const { segments, subs, unbalanced } = scan(raw);
  const perSegment = segments.map((s) => buildInvocation(s.tokens, unbalanced, s.depth));

  // Link pipelines: a run of segments joined by single `|` share a pipeline;
  // each member's pipedTo = command words of the later stages in that pipeline.
  let start = 0;
  while (start < segments.length) {
    let end = start;
    while (segments[end]!.pipeNext && end + 1 < segments.length) end++;
    for (let a = start; a <= end; a++) {
      const inv = perSegment[a];
      if (!inv) continue;
      const later: string[] = [];
      for (let b = a + 1; b <= end; b++) {
        const cmd = perSegment[b]?.argv[0];
        if (cmd) later.push(cmd);
      }
      inv.pipedTo = later;
    }
    start = end + 1;
  }

  const invocations: Invocation[] = perSegment
    .filter((i): i is Invocation => i !== null)
    .flatMap((i) => unwrap(i, 0));
  for (const inner of subs) {
    if (inner.trim()) invocations.push(...parseCommand(inner));
  }
  return invocations;
}
