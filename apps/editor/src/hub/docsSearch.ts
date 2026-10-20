// SPDX-License-Identifier: Apache-2.0
/**
 * The search of the Hub prompt box: the person asks how to do something. The box gives the sections of the docs and
 * the tutorials that match the words of the question. The index is the user docs of the repository (`docs/*.md`),
 * with one section at each heading. It loads at the first question. A link goes to the section on GitHub (the anchor
 * of its heading). The search needs no model. It counts the words of the question in the headings and in the text of
 * each section, and a rare word counts more than a frequent word.
 */

/** The user docs in the index, in the order of the docs list of the Hub. */
export const DOC_FILES = [
  "quickstart.md",
  "studio.md",
  "editor.md",
  "formats.md",
  "plugins.md",
  "studio-plugins.md",
  "cli.md",
  "components.md",
  "testing.md",
  "architecture.md",
] as const;

/** The docs on GitHub. */
export const DOCS_URL = "https://github.com/leonardocustodio/scenity/blob/main/docs/";

/** One section of a doc: the text under one heading, up to the next heading. */
export interface DocSection {
  readonly file: string;
  readonly heading: string;
  /** The headings above this heading, from the title of the doc. */
  readonly parents: readonly string[];
  /** The anchor of the heading on GitHub. */
  readonly anchor: string;
  readonly text: string;
}

/** The sections of the docs with the words of each one. */
export interface DocsIndex {
  readonly sections: readonly DocSection[];
  readonly words: readonly IndexWords[];
  /** The number of sections with each word. */
  readonly counts: ReadonlyMap<string, number>;
  /** The mean number of words in the text of a section. */
  readonly mean: number;
}

/** The words of a heading and of a text, each with its count. */
interface IndexWords {
  readonly heading: ReadonlySet<string>;
  readonly parents: ReadonlySet<string>;
  readonly text: ReadonlyMap<string, number>;
  /** The number of words in the text. */
  readonly size: number;
}

/** A section that matches a question. */
export interface DocAnswer {
  readonly section: DocSection;
  readonly url: string;
  readonly excerpt: string;
  readonly score: number;
}

const STOP = new Set(
  (
    "a an and are as at be by can could do does doing for from have how i if in into is it its me my of on or our " +
    "should so than that the their them then there these this to use using want was we what when where which who " +
    "why will with would you your one"
  ).split(" "),
);

/** The stems of the verbs of many questions: they weigh half, and a section needs the other words of the question. */
const VERBS = new Set(
  "add change create find get make new open run see set show start work write".split(" ").map((word) => stem(word)),
);

/** The plain text of a line of Markdown: no links, no code marks, no emphasis. */
export function plainText(line: string): string {
  return line
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[`*_]/g, "")
    .trim();
}

/** The anchor of a heading on GitHub: lower case, no punctuation, a hyphen for each space. */
export function headingAnchor(heading: string): string {
  return plainText(heading)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s_-]/gu, "")
    .replace(/\s/g, "-");
}

/** The stem of a word: a short form, so "animate", "animation" and "animates" are the same word. */
export function stem(word: string): string {
  const cut = word
    .replace(/(?:ing|ions?|ed|es|ly)$/, (end, at: number) => (at >= 3 ? "" : end))
    .replace(/(?<=..[^s])s$/, "")
    .replace(/(?<=...)e$/, "");
  return cut.slice(0, 7);
}

/** The words of a text: lower case, no stop words, each as its stem. */
export function wordsOf(text: string): string[] {
  return (text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [])
    .filter((word) => word.length > 1 && !STOP.has(word))
    .map(stem);
}

/** The sections of one doc. A heading in a code block is text. */
export function docSections(file: string, markdown: string): DocSection[] {
  const sections: DocSection[] = [];
  const anchors = new Map<string, number>();
  const stack: { level: number; heading: string }[] = [];
  let fenced = false;
  let current: { heading: string; parents: string[]; anchor: string; lines: string[] } | null = null;
  const close = (): void => {
    if (current !== null) sections.push({ file, ...current, text: current.lines.join("\n").trim() });
  };
  for (const line of markdown.split("\n")) {
    if (/^\s*(?:```|~~~)/.test(line)) fenced = !fenced;
    const match = fenced ? null : /^(#{1,4})\s+(.+?)\s*#*\s*$/.exec(line);
    if (match === null) {
      current?.lines.push(line);
      continue;
    }
    close();
    const level = match[1]?.length ?? 1;
    const heading = plainText(match[2] ?? "");
    while ((stack.at(-1)?.level ?? 0) >= level) stack.pop();
    const base = headingAnchor(heading);
    const seen = anchors.get(base) ?? 0;
    anchors.set(base, seen + 1);
    current = {
      heading,
      parents: stack.map((item) => item.heading),
      anchor: seen === 0 ? base : `${base}-${String(seen)}`,
      lines: [],
    };
    stack.push({ level, heading });
  }
  close();
  return sections;
}

/** The index of the docs: `files` maps a file name to its Markdown. */
export function docsIndex(files: Readonly<Record<string, string>>): DocsIndex {
  const sections = Object.entries(files).flatMap(([file, markdown]) => docSections(file, markdown));
  const words = sections.map((section) => {
    const all = wordsOf(section.text);
    const text = new Map<string, number>();
    for (const word of all) text.set(word, (text.get(word) ?? 0) + 1);
    const parents = new Set(wordsOf(section.parents.join(" ")));
    return { heading: new Set(wordsOf(section.heading)), parents, text, size: all.length };
  });
  const counts = new Map<string, number>();
  for (const each of words) {
    for (const word of new Set([...each.heading, ...each.text.keys()])) counts.set(word, (counts.get(word) ?? 0) + 1);
  }
  const mean = words.reduce((sum, each) => sum + each.size, 0) / Math.max(1, words.length);
  return { sections, words, counts, mean };
}

/** The weight of a word: a word in few sections weighs more. */
const weightOf = (index: DocsIndex, word: string): number =>
  Math.log(1 + index.sections.length / (1 + (index.counts.get(word) ?? 0)));

/**
 * The score of a section for the words of a question (BM25 for the text): a word in the heading counts more than a
 * word in the text, and a word in a short text counts more than a word in a long text.
 */
function scoreOf(index: DocsIndex, question: readonly string[], words: IndexWords): number {
  const keys = question.filter((word) => !VERBS.has(word));
  const needed = keys.length > 0 ? keys : question;
  let score = 0;
  let found = 0;
  for (const word of question) {
    const count = words.text.get(word) ?? 0;
    const text = (count * 2.2) / (count + 1.2 * (0.25 + (0.75 * words.size) / Math.max(1, index.mean)));
    const hit = (words.heading.has(word) ? 4 : 0) + (words.parents.has(word) ? 1 : 0) + text;
    if (hit > 0 && needed.includes(word)) found += 1;
    score += weightOf(index, word) * hit * (VERBS.has(word) ? 0.5 : 1);
  }
  // A section that has more of the words of the question goes first.
  return needed.length === 0 ? 0 : score * (found / needed.length) ** 2;
}

/** The first sentences of a section, up to `max` characters, as plain text. */
export function excerptOf(text: string, max = 200): string {
  let fenced = false;
  const prose = text.split("\n").filter((line) => {
    if (/^\s*(?:```|~~~)/.test(line)) fenced = !fenced;
    return !fenced && line.trim() !== "" && !/^\s*(?:```|~~~|\||<)/.test(line);
  });
  const plain = plainText(prose.join(" ").replace(/^\s*[-*]\s+/gm, "")).replace(/\s+/g, " ");
  return plain.length <= max ? plain : `${plain.slice(0, max - 1).replace(/\s\S*$/, "")}…`;
}

/** The sections that answer a question, best first. */
export function searchDocs(index: DocsIndex, question: string, max = 3): DocAnswer[] {
  const words = [...new Set(wordsOf(question))];
  return index.sections
    .map((section, at) => ({ section, score: scoreOf(index, words, index.words[at] ?? EMPTY) }))
    .filter((item) => item.score > 0 && item.section.text.trim() !== "")
    .sort((a, b) => b.score - a.score)
    .slice(0, max)
    .map(({ section, score }) => ({
      section,
      score,
      url: `${DOCS_URL}${section.file}#${section.anchor}`,
      excerpt: excerptOf(section.text),
    }));
}

const EMPTY: IndexWords = { heading: new Set(), parents: new Set(), text: new Map(), size: 0 };

/** A tutorial with its texts in the page language. */
export interface TutorialText {
  readonly id: string;
  readonly title: string;
  readonly steps: readonly string[];
}

/** The tutorials that answer a question (at most one): the tutorial must have half the words of the question. */
export function searchTutorials(index: DocsIndex, question: string, tutorials: readonly TutorialText[]): string[] {
  const words = [...new Set(wordsOf(question))];
  const scored = tutorials.map((tutorial) => {
    const text = new Map<string, number>();
    for (const word of wordsOf(tutorial.steps.join(" "))) text.set(word, (text.get(word) ?? 0) + 1);
    const own = { heading: new Set(wordsOf(tutorial.title)), parents: new Set<string>(), text, size: text.size };
    const found = words.filter((word) => own.heading.has(word) || text.has(word)).length;
    return { id: tutorial.id, score: scoreOf(index, words, own), found };
  });
  return scored
    .filter((item) => item.found > 0 && item.found * 2 >= words.length)
    .sort((a, b) => b.score - a.score)
    .slice(0, 1)
    .map((item) => item.id);
}

let loading: Promise<DocsIndex> | null = null;

/** The index of the user docs of the repository (it loads once, at the first question). */
export function loadDocsIndex(): Promise<DocsIndex> {
  loading ??= (async () => {
    const modules = import.meta.glob<string>(
      "../../../../docs/{quickstart,studio,editor,formats,plugins,studio-plugins,cli,components,testing,architecture}.md",
      { query: "?raw", import: "default" },
    );
    const files: Record<string, string> = {};
    for (const file of DOC_FILES) {
      const load = modules[`../../../../docs/${file}`];
      if (load !== undefined) files[file] = await load();
    }
    return docsIndex(files);
  })();
  return loading;
}
