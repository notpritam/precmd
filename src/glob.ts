// ABOUTME: Minimal glob→RegExp matcher supporting * (in-segment) and ** (any depth).
// ABOUTME: Used by PR path-section rules to match changed files.

/** Compile a glob to an anchored RegExp. `*` stays within a path segment; `**` crosses segments. */
export function globToRegExp(glob: string): RegExp {
  let re = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i]!;
    if (c === "*") {
      if (glob[i + 1] === "*") {
        re += ".*";
        i++;
        if (glob[i + 1] === "/") i++;
      } else {
        re += "[^/]*";
      }
    } else if (c === "?") {
      re += "[^/]";
    } else if (".+^${}()|[]\\".includes(c)) {
      re += "\\" + c;
    } else {
      re += c;
    }
  }
  return new RegExp("^" + re + "$");
}

/** True when `path` matches `glob`. */
export function globMatch(glob: string, path: string): boolean {
  return globToRegExp(glob).test(path);
}
