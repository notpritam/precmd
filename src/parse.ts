// ABOUTME: Splits a raw shell command line into structured invocations.
// ABOUTME: Handles separators, quoting, env prefixes, command substitution, and pipelines.
import type { Invocation } from "./types";

interface Segment {
  tokens: string[];
  /** true when this segment was terminated by a single `|` (same pipeline continues). */
  pipeNext: boolean;
}

interface Scan {
  segments: Segment[];
  subs: string[];
  unbalanced: boolean;
}

/** Tokenize + segment a raw command, respecting quotes and operators. */
function scan(raw: string): Scan {
  const segments: Segment[] = [];
  const subs: string[] = [];
  let cur: string[] = [];
  let buf = "";
  let hasBuf = false;
  let inSingle = false;
  let inDouble = false;
  let unbalanced = false;

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
      segments.push({ tokens: cur, pipeNext });
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

    // command substitution: $( ... ) with nesting
    if (c === "$" && raw[i + 1] === "(") {
      let depth = 1;
      let j = i + 2;
      let inner = "";
      for (; j < raw.length && depth > 0; j++) {
        const d = raw[j]!;
        if (d === "(") depth++;
        else if (d === ")") {
          depth--;
          if (depth === 0) break;
        }
        inner += d;
      }
      if (depth !== 0) unbalanced = true;
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

    // top-level operators (order matters: && and || before single | )
    if (c === "&" && raw[i + 1] === "&") {
      endSegment(false);
      i++;
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

function buildInvocation(tokens: string[], uncertain: boolean): Invocation | null {
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
  return { argv, env, raw: tokens.join(" "), uncertain, pipedTo: [] };
}

/** Parse a (possibly compound) command line into invocations, including substitutions. */
export function parseCommand(raw: string): Invocation[] {
  const { segments, subs, unbalanced } = scan(raw);
  const perSegment = segments.map((s) => buildInvocation(s.tokens, unbalanced));

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

  const invocations: Invocation[] = perSegment.filter((i): i is Invocation => i !== null);
  for (const inner of subs) {
    if (inner.trim()) invocations.push(...parseCommand(inner));
  }
  return invocations;
}
