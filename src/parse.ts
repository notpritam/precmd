// ABOUTME: Splits a raw shell command line into structured invocations.
// ABOUTME: Handles separators, quoting, env prefixes, and command substitution.
import type { Invocation } from "./types";

interface Scan {
  segments: string[][];
  subs: string[];
  unbalanced: boolean;
}

/** Tokenize + segment a raw command, respecting quotes and operators. */
function scan(raw: string): Scan {
  const segments: string[][] = [];
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
  const endSegment = (): void => {
    endToken();
    if (cur.length) {
      segments.push(cur);
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

    // top-level operators
    if (c === "&" && raw[i + 1] === "&") {
      endSegment();
      i++;
      continue;
    }
    if (c === "|" && raw[i + 1] === "|") {
      endSegment();
      i++;
      continue;
    }
    if (c === "|" || c === ";" || c === "\n") {
      endSegment();
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
  endSegment();
  return { segments, subs, unbalanced };
}

const ENV_ASSIGN = /^[A-Za-z_][A-Za-z0-9_]*=/;

/** Parse a (possibly compound) command line into invocations, including substitutions. */
export function parseCommand(raw: string): Invocation[] {
  const { segments, subs, unbalanced } = scan(raw);
  const invocations: Invocation[] = [];

  for (const tokens of segments) {
    const env: Record<string, string> = {};
    let k = 0;
    while (k < tokens.length && ENV_ASSIGN.test(tokens[k]!)) {
      const t = tokens[k]!;
      const eq = t.indexOf("=");
      env[t.slice(0, eq)] = t.slice(eq + 1);
      k++;
    }
    const argv = tokens.slice(k);
    if (argv.length === 0) continue;
    invocations.push({ argv, env, raw: tokens.join(" "), uncertain: unbalanced });
  }

  for (const inner of subs) {
    if (inner.trim()) invocations.push(...parseCommand(inner));
  }

  return invocations;
}
