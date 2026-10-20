// SPDX-License-Identifier: Apache-2.0
/**
 * A small Markdown reader for the review pack: headings, paragraphs, lists, tables, code
 * blocks, rules, and inline code, bold, italics, links and images. It gives a tree, not HTML, so the view renders
 * text only and never injects markup.
 */

export type Inline =
  | { readonly t: "text"; readonly v: string }
  | { readonly t: "code"; readonly v: string }
  | { readonly t: "strong" | "em"; readonly c: readonly Inline[] }
  | { readonly t: "link"; readonly href: string; readonly c: readonly Inline[] }
  | { readonly t: "image"; readonly src: string; readonly alt: string };

export type Block =
  | { readonly t: "heading"; readonly level: number; readonly c: readonly Inline[] }
  | { readonly t: "paragraph"; readonly c: readonly Inline[] }
  | { readonly t: "list"; readonly ordered: boolean; readonly items: readonly (readonly Inline[])[] }
  | {
      readonly t: "table";
      readonly head: readonly (readonly Inline[])[];
      readonly rows: readonly (readonly Inline[])[][];
    }
  | { readonly t: "code"; readonly v: string }
  | { readonly t: "rule" };

const INLINE =
  /!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)|\[([^\]]+)\]\(([^)\s]+)\)|`([^`]+)`|\*\*(.+?)\*\*|\*([^*\s][^*]*)\*|\b_([^_\s][^_]*)_\b/g;

/** Read the inline marks of a text. */
export function parseInline(text: string): Inline[] {
  const out: Inline[] = [];
  let last = 0;
  for (const match of text.matchAll(INLINE)) {
    const at = match.index;
    if (at > last) out.push({ t: "text", v: text.slice(last, at) });
    const [, alt, src, label, href, code, strong, em, under] = match;
    if (src !== undefined) out.push({ t: "image", src, alt: alt ?? "" });
    else if (href !== undefined) out.push({ t: "link", href, c: parseInline(label ?? "") });
    else if (code !== undefined) out.push({ t: "code", v: code });
    else if (strong !== undefined) out.push({ t: "strong", c: parseInline(strong) });
    else out.push({ t: "em", c: parseInline(em ?? under ?? "") });
    last = at + match[0].length;
  }
  if (last < text.length) out.push({ t: "text", v: text.slice(last) });
  return out;
}

const LIST = /^\s*([-*+]|\d+[.)])\s+(.*)$/;
const RULE = /^\s*([-*_])(\s*\1){2,}\s*$/;

function cells(line: string): Inline[][] {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => parseInline(cell.trim()));
}

function isTableStart(lines: readonly string[], index: number): boolean {
  return (lines[index] ?? "").trim().startsWith("|") && /^\s*\|?\s*:?-{3,}/.test(lines[index + 1] ?? "");
}

/** Read the blocks of a Markdown text. */
export function parseMarkdown(text: string): Block[] {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const blocks: Block[] = [];
  let index = 0;
  while (index < lines.length) {
    const line = lines[index] ?? "";
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (line.trim() === "") index += 1;
    else if (line.trimStart().startsWith("```")) {
      const code: string[] = [];
      index += 1;
      while (index < lines.length && !(lines[index] ?? "").trimStart().startsWith("```"))
        code.push(lines[index++] ?? "");
      blocks.push({ t: "code", v: code.join("\n") });
      index += 1;
    } else if (heading !== null) {
      blocks.push({ t: "heading", level: heading[1]?.length ?? 1, c: parseInline(heading[2] ?? "") });
      index += 1;
    } else if (RULE.test(line)) {
      blocks.push({ t: "rule" });
      index += 1;
    } else if (isTableStart(lines, index)) {
      const head = cells(line);
      const rows: Inline[][][] = [];
      index += 2;
      while (index < lines.length && (lines[index] ?? "").trim().startsWith("|"))
        rows.push(cells(lines[index++] ?? ""));
      blocks.push({ t: "table", head, rows });
    } else if (LIST.test(line)) {
      const ordered = /^\s*\d/.test(line);
      const items: Inline[][] = [];
      while (index < lines.length && LIST.test(lines[index] ?? "")) {
        items.push(parseInline(LIST.exec(lines[index++] ?? "")?.[2] ?? ""));
      }
      blocks.push({ t: "list", ordered, items });
    } else {
      const words: string[] = [];
      while (index < lines.length && isParagraphLine(lines, index)) words.push((lines[index++] ?? "").trim());
      blocks.push({ t: "paragraph", c: parseInline(words.join(" ")) });
    }
  }
  return blocks;
}

function isParagraphLine(lines: readonly string[], index: number): boolean {
  const line = lines[index] ?? "";
  return (
    line.trim() !== "" &&
    !/^#{1,6}\s/.test(line) &&
    !line.trimStart().startsWith("```") &&
    !LIST.test(line) &&
    !RULE.test(line) &&
    !isTableStart(lines, index)
  );
}

/** The path of an image of a Markdown file in a folder: absolute, or relative to the folder. */
export function resolveImage(folder: string, src: string): string {
  if (src.startsWith("/")) return src;
  const parts = folder.split("/");
  for (const part of src.split("/")) {
    if (part === "..") parts.pop();
    else if (part !== "." && part !== "") parts.push(part);
  }
  return parts.join("/");
}
