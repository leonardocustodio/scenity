// SPDX-License-Identifier: Apache-2.0
/**
 * The Git refusal of the workbench: the `PreToolUse` hook on `Bash` refuses a
 * command that changes the Git history or discards work. The owner does these from the Git panel. The list is
 * tight: a command that only reads, stages or commits passes.
 *
 * The check splits the command into simple commands at `;`, `&&`, `||`, `|`, `&` and line ends, reads the words of
 * each with the shell quotes, and also reads the text of `sh -c '…'`, `bash -c '…'` and `zsh -c '…'`.
 */

/** Split a command line into words. A quote keeps its words together; an operator is a word of its own. */
export function shellWords(line: string): string[] {
  const words: string[] = [];
  let word = "";
  let open = false;
  let quote: '"' | "'" | null = null;
  const end = (): void => {
    if (open) words.push(word);
    word = "";
    open = false;
  };
  for (let index = 0; index < line.length; index++) {
    const char = line.charAt(index);
    if (quote !== null) {
      if (char === quote) quote = null;
      else if (char === "\\" && quote === '"' && index + 1 < line.length) word += line.charAt(++index);
      else word += char;
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      open = true;
    } else if (char === "\\" && index + 1 < line.length) {
      word += line.charAt(++index);
      open = true;
    } else if (/\s/.test(char)) {
      if (char === "\n") {
        end();
        words.push(";");
      } else end();
    } else if (";&|()".includes(char)) {
      end();
      const pair = line.slice(index, index + 2);
      const operator = pair === "&&" || pair === "||" ? pair : char;
      words.push(operator);
      index += operator.length - 1;
    } else {
      word += char;
      open = true;
    }
  }
  end();
  return words;
}

const OPERATORS = new Set([";", "&&", "||", "|", "&", "(", ")"]);
const SHELLS = new Set(["sh", "bash", "zsh", "/bin/sh", "/bin/bash", "/bin/zsh"]);

/** The simple commands of a command line, each as its words. */
export function simpleCommands(line: string): string[][] {
  const out: string[][] = [];
  let current: string[] = [];
  for (const word of shellWords(line)) {
    if (OPERATORS.has(word)) {
      if (current.length > 0) out.push(current);
      current = [];
    } else current.push(word);
  }
  if (current.length > 0) out.push(current);
  return out;
}

/** The words of a Git call without its global options, or null when the command does not run Git. */
function gitArgs(words: readonly string[]): string[] | null {
  let index = 0;
  while (index < words.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(words[index] ?? "")) index++;
  while (["sudo", "command", "exec", "env", "nohup", "time"].includes(words[index] ?? "")) index++;
  const program = words[index] ?? "";
  if (program !== "git" && !program.endsWith("/git")) return null;
  const args = words.slice(index + 1);
  while (args.length > 0) {
    const first = args[0] ?? "";
    if (first === "-C" || first === "-c" || first === "--git-dir" || first === "--work-tree") args.splice(0, 2);
    else if (first.startsWith("-")) args.shift();
    else break;
  }
  return args;
}

/** True when a word is a short option cluster (`-fd`) that holds the letter, or the long option. */
function hasFlag(args: readonly string[], letter: string | null, long: readonly string[]): boolean {
  return args.some(
    (arg) =>
      long.includes(arg) ||
      long.some((name) => arg.startsWith(`${name}=`)) ||
      (letter !== null && /^-[A-Za-z]+$/.test(arg) && arg.includes(letter)),
  );
}

/** The rules: the Git subcommand and a test of its arguments. The reason names what the owner uses instead. */
const RULES: readonly { readonly name: string; readonly sub: string; readonly test: (args: string[]) => boolean }[] = [
  { name: "git push", sub: "push", test: () => true },
  { name: "git reset --hard", sub: "reset", test: (args) => hasFlag(args, null, ["--hard", "--merge", "--keep"]) },
  {
    name: "git checkout of files (checkout ., checkout -- <path>, checkout -f)",
    sub: "checkout",
    test: (args) => args.includes(".") || args.includes("--") || hasFlag(args, "f", ["--force"]),
  },
  {
    name: "git restore of the work tree",
    sub: "restore",
    test: (args) => !(hasFlag(args, "S", ["--staged"]) && !hasFlag(args, "W", ["--worktree"])),
  },
  { name: "git clean", sub: "clean", test: (args) => !hasFlag(args, "n", ["--dry-run"]) },
  { name: "git stash drop or clear", sub: "stash", test: (args) => args[0] === "drop" || args[0] === "clear" },
  {
    name: "git branch -D",
    sub: "branch",
    test: (args) => hasFlag(args, "D", []) || (hasFlag(args, "d", ["--delete"]) && hasFlag(args, "f", ["--force"])),
  },
  { name: "git rebase", sub: "rebase", test: () => true },
  { name: "git commit --amend", sub: "commit", test: (args) => args.includes("--amend") },
  {
    name: "git switch that throws away changes",
    sub: "switch",
    test: (args) => hasFlag(args, "f", ["--force", "--discard-changes"]),
  },
  { name: "git filter-branch", sub: "filter-branch", test: () => true },
  { name: "git filter-repo", sub: "filter-repo", test: () => true },
  { name: "git update-ref -d", sub: "update-ref", test: (args) => hasFlag(args, "d", ["--delete"]) },
  { name: "git reflog expire or delete", sub: "reflog", test: (args) => args[0] === "expire" || args[0] === "delete" },
];

/** The Git subcommands that the guard checks. The allowlist of git.ts agrees with them, and a test checks it. */
export const GUARDED_SUBCOMMANDS: readonly string[] = [...new Set(RULES.map((rule) => rule.sub))];

/** The rule name that refuses a Git call of the given arguments (without `git`), or null. git.ts uses it. */
export function gitArgsRefusal(args: readonly string[]): string | null {
  const [sub = "", ...rest] = args;
  return RULES.find((item) => item.sub === sub && item.test(rest))?.name ?? null;
}

/** The refusal of one simple command, or null. */
function refuseWords(words: readonly string[], depth: number): string | null {
  const program = words[0] ?? "";
  if (SHELLS.has(program) && depth < 3) {
    const flag = words.findIndex((word) => /^-[a-z]*c[a-z]*$/.test(word));
    const script = flag < 0 ? undefined : words[flag + 1];
    if (script !== undefined) return gitRefusal(script, depth + 1);
  }
  const args = gitArgs(words);
  if (args === null) return null;
  const [sub = "", ...rest] = args;
  const rule = RULES.find((item) => item.sub === sub && item.test(rest));
  return rule?.name ?? null;
}

/**
 * The reason to refuse a Bash command in the workbench, or null when the command may run. Only Git commands that
 * change the history or discard work get a reason.
 */
export function gitRefusal(command: string, depth = 0): string | null {
  for (const words of simpleCommands(command)) {
    const name = refuseWords(words, depth);
    if (name !== null) {
      return (
        `The workbench refuses ${name}: it changes the Git history or throws away work. ` +
        "The owner does this from the Git panel of the workbench. Leave the files as they are and tell the owner."
      );
    }
  }
  return null;
}
