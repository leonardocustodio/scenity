// SPDX-License-Identifier: Apache-2.0
/**
 * The format upgrade of a document. The reader of `@scenity/scene` upcasts a file of an older format at the load.
 * The page then offers the upgrade with the diff of the file text (`lineDiff`), and the upgrade saves the document in
 * the current format. Pure functions, no DOM.
 */
import { FORMAT_CHAINS, formatString, isDocumentKind, parseFormat } from "@scenity/scene";

/** The offer of an upgrade: the format of the file and the current format. */
export interface UpgradeOffer {
  readonly from: string;
  readonly to: string;
}

/** The offer for the text of a file, or null for a file of the current format (or a text that is not JSON). */
export function upgradeOffer(text: string | null): UpgradeOffer | null {
  if (text === null) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  const format = parseFormat(
    typeof raw === "object" && raw !== null ? (raw as { format?: unknown }).format : undefined,
  );
  if (format === undefined || !isDocumentKind(format.kind)) return null;
  const current = FORMAT_CHAINS[format.kind].current;
  return format.version < current
    ? { from: formatString(format.kind, format.version), to: formatString(format.kind, current) }
    : null;
}

/** The most cells of the table of a line diff; a larger diff gives all the old lines out and all the new lines in. */
const MAX_CELLS = 4_000_000;

/**
 * The changed lines from `before` to `after` ("- " out, "+ " in), in the order of the files, from the longest common
 * subsequence of the lines. At most `most` lines; the rest is one line "…".
 */
export function lineDiff(before: string, after: string, most = 200): string[] {
  const a = before.split("\n");
  const b = after.split("\n");
  let out: string[];
  if (a.length * b.length > MAX_CELLS) out = [...a.map((line) => `- ${line}`), ...b.map((line) => `+ ${line}`)];
  else {
    // The length of the common subsequence of the tails a[i..] and b[j..].
    const width = b.length + 1;
    const table = new Uint32Array((a.length + 1) * width);
    for (let i = a.length - 1; i >= 0; i -= 1)
      for (let j = b.length - 1; j >= 0; j -= 1)
        table[i * width + j] =
          a[i] === b[j]
            ? (table[(i + 1) * width + j + 1] ?? 0) + 1
            : Math.max(table[(i + 1) * width + j] ?? 0, table[i * width + j + 1] ?? 0);
    out = [];
    let i = 0;
    let j = 0;
    while (i < a.length || j < b.length) {
      if (i < a.length && j < b.length && a[i] === b[j]) {
        i += 1;
        j += 1;
      } else if (
        j < b.length &&
        (i >= a.length || (table[i * width + j + 1] ?? 0) >= (table[(i + 1) * width + j] ?? 0))
      ) {
        out.push(`+ ${b[j] ?? ""}`);
        j += 1;
      } else {
        out.push(`- ${a[i] ?? ""}`);
        i += 1;
      }
    }
  }
  return out.length > most ? [...out.slice(0, most), "…"] : out;
}
