// SPDX-License-Identifier: Apache-2.0
/**
 * A small reader of a unified diff: the files of the patch and the kind of each line, for
 * the colors of the diff view.
 */

export type DiffLineKind = "add" | "del" | "hunk" | "context" | "meta";

export interface DiffLine {
  readonly kind: DiffLineKind;
  readonly text: string;
}

export interface DiffFile {
  readonly path: string;
  readonly lines: readonly DiffLine[];
  readonly added: number;
  readonly removed: number;
}

function kindOf(line: string, inHunk: boolean): DiffLineKind {
  if (line.startsWith("@@")) return "hunk";
  if (!inHunk) return "meta";
  if (line.startsWith("+")) return "add";
  if (line.startsWith("-")) return "del";
  return line.startsWith("\\") ? "meta" : "context";
}

/** The path of a `diff --git a/x b/x` line (the `b/` side), or of `/dev/null` diffs of new files. */
function pathOf(header: string): string {
  const match = / b\/(.+)$/.exec(header);
  return match?.[1] ?? header.replace(/^diff --git /, "");
}

/** Read a unified diff (`git diff`) into its files. */
export function parseDiff(patch: string): DiffFile[] {
  const files: { path: string; lines: DiffLine[]; added: number; removed: number }[] = [];
  let inHunk = false;
  for (const line of patch.split("\n")) {
    if (line.startsWith("diff --git ")) {
      files.push({ path: pathOf(line), lines: [], added: 0, removed: 0 });
      inHunk = false;
    }
    const file = files.at(-1);
    if (file === undefined) continue;
    if (line.startsWith("@@")) inHunk = true;
    else if (line.startsWith("diff --git ")) inHunk = false;
    if (line.startsWith("+++ b/")) file.path = line.slice("+++ b/".length);
    const kind = kindOf(line, inHunk && !line.startsWith("diff --git "));
    if (kind === "add") file.added += 1;
    if (kind === "del") file.removed += 1;
    file.lines.push({ kind, text: line });
  }
  for (const file of files) while (file.lines.at(-1)?.text === "") file.lines.pop();
  return files;
}
