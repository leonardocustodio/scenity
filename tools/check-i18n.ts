// SPDX-License-Identifier: Apache-2.0
/**
 * The check of the Fluent files of the studio. en-US is the source locale. The check reads
 * the editor files (`apps/editor/src/i18n/<locale>/<namespace>.ftl`) and the files of the ui package
 * (`packages/ui/src/i18n/<locale>.ftl`). It finds these problems:
 * - a syntax error (a Junk entry of @fluent/syntax);
 * - a message ID in two files of one locale of the editor;
 * - in a locale other than en-US: a file, a message or an attribute that en-US does not have, a variable that the en-US
 *   message does not have, a reference to a message that the locale does not have;
 * - in each locale of SUPPORTED_LOCALES: an en-US message with no translation (a gap shows English to the person);
 * - the pseudo-locale (en-XA) of an en-US file that does not parse, or that loses a message.
 *
 * Run from the repo root:
 *     bun tools/check-i18n.ts              # exit 1 on a problem
 *     bun tools/check-i18n.ts --coverage   # also the count of messages of each locale
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { parse, type Resource } from "@fluent/syntax";
import { pseudoLocalize } from "../packages/i18n/src/pseudo";
import { SOURCE_LOCALE, SUPPORTED_LOCALES } from "../packages/i18n/src/locales";

export const ROOT = resolve(import.meta.dir, "..");
/** The folder of the editor files: one folder for each locale. */
const EDITOR_FOLDER = "apps/editor/src/i18n";
/** The folder of the files of the ui package: one file for each locale. */
const UI_FOLDER = "packages/ui/src/i18n";

/** One problem of a Fluent file. */
export interface I18nProblem {
  readonly path: string;
  readonly line: number;
  readonly text: string;
}

/** One message or term of a file: its attributes, its variables and the messages it refers to. */
interface EntryInfo {
  readonly line: number;
  readonly attributes: ReadonlySet<string>;
  readonly variables: ReadonlySet<string>;
  readonly references: ReadonlySet<string>;
}

/** One Fluent file: its locale, its namespace and its entries by ID. */
export interface FtlFile {
  readonly path: string;
  readonly locale: string;
  readonly namespace: string;
  readonly source: string;
}

const lineOf = (source: string, offset: number): number => source.slice(0, offset).split("\n").length;

/** Collect the variables and the message references under a node of the syntax tree. */
function walk(node: unknown, variables: Set<string>, references: Set<string>): void {
  if (Array.isArray(node)) {
    for (const item of node) walk(item, variables, references);
    return;
  }
  if (typeof node !== "object" || node === null) return;
  const record = node as { type?: unknown; id?: { name?: unknown } };
  const name = typeof record.id?.name === "string" ? record.id.name : null;
  if (record.type === "VariableReference" && name !== null) variables.add(name);
  if (record.type === "MessageReference" && name !== null) references.add(name);
  for (const [key, value] of Object.entries(node)) if (key !== "span") walk(value, variables, references);
}

/** The entries of a parsed file, and its syntax problems. */
function entriesOf(file: FtlFile, resource: Resource): { entries: Map<string, EntryInfo>; problems: I18nProblem[] } {
  const entries = new Map<string, EntryInfo>();
  const problems: I18nProblem[] = [];
  for (const entry of resource.body) {
    const start = entry.span?.start ?? 0;
    if (entry.type === "Junk") {
      const note = entry.annotations[0];
      const at = note?.span?.start ?? start;
      problems.push({ path: file.path, line: lineOf(file.source, at), text: `syntax: ${note?.message ?? "junk"}` });
      continue;
    }
    if (entry.type !== "Message" && entry.type !== "Term") continue;
    const variables = new Set<string>();
    const references = new Set<string>();
    walk(entry.value, variables, references);
    walk(entry.attributes, variables, references);
    const id = entry.type === "Term" ? `-${entry.id.name}` : entry.id.name;
    const attributes = new Set(entry.attributes.map((attribute) => attribute.id.name));
    entries.set(id, { line: lineOf(file.source, start), attributes, variables, references });
  }
  return { entries, problems };
}

/** The Fluent files of the studio under a root. */
export function studioFiles(root: string = ROOT): FtlFile[] {
  const files: FtlFile[] = [];
  const editor = join(root, EDITOR_FOLDER);
  for (const locale of existsSync(editor) ? readdirSync(editor).sort() : []) {
    const folder = join(editor, locale);
    if (!existsSync(folder) || locale.includes(".")) continue;
    for (const name of readdirSync(folder).sort()) {
      if (!name.endsWith(".ftl")) continue;
      const path = join(folder, name);
      files.push({
        path: relative(root, path),
        locale,
        namespace: name.slice(0, -4),
        source: readFileSync(path, "utf8"),
      });
    }
  }
  const ui = join(root, UI_FOLDER);
  for (const name of existsSync(ui) ? readdirSync(ui).sort() : []) {
    if (!name.endsWith(".ftl")) continue;
    const path = join(ui, name);
    files.push({
      path: relative(root, path),
      locale: name.slice(0, -4),
      namespace: "ui",
      source: readFileSync(path, "utf8"),
    });
  }
  return files;
}

/** The problems of a translation against its en-US file. */
function translationProblems(
  file: FtlFile,
  entries: ReadonlyMap<string, EntryInfo>,
  source: ReadonlyMap<string, EntryInfo> | undefined,
  known: ReadonlySet<string>,
): I18nProblem[] {
  const problems: I18nProblem[] = [];
  const add = (line: number, text: string): void => {
    problems.push({ path: file.path, line, text });
  };
  if (source === undefined) return [{ path: file.path, line: 1, text: `en-US has no file "${file.namespace}"` }];
  for (const [id, entry] of entries) {
    const original = source.get(id);
    if (original === undefined) {
      add(entry.line, `${id}: en-US has no such message`);
      continue;
    }
    for (const attribute of entry.attributes)
      if (!original.attributes.has(attribute)) add(entry.line, `${id}.${attribute}: en-US has no such attribute`);
    for (const attribute of original.attributes)
      if (!entry.attributes.has(attribute)) add(entry.line, `${id}.${attribute}: the attribute is missing`);
    for (const variable of entry.variables)
      if (!original.variables.has(variable)) add(entry.line, `${id}: en-US has no variable $${variable}`);
    for (const reference of entry.references)
      if (!known.has(reference)) add(entry.line, `${id}: no message "${reference}"`);
  }
  return problems;
}

/** The problems of the Fluent files of the studio, and the count of messages of each locale. */
export function checkI18n(files: readonly FtlFile[] = studioFiles()): {
  problems: I18nProblem[];
  counts: Record<string, number>;
} {
  const problems: I18nProblem[] = [];
  const parsed = files.map((file) => {
    const result = entriesOf(file, parse(file.source, { withSpans: true }));
    problems.push(...result.problems);
    return { file, entries: result.entries };
  });
  const sourceOf = (namespace: string): ReadonlyMap<string, EntryInfo> | undefined =>
    parsed.find(({ file }) => file.locale === SOURCE_LOCALE && file.namespace === namespace)?.entries;
  const counts: Record<string, number> = {};
  const locales = [...new Set(files.map((file) => file.locale))];
  for (const locale of locales) {
    const own = parsed.filter(({ file }) => file.locale === locale);
    const known = new Set(own.flatMap(({ entries }) => [...entries.keys()]));
    counts[locale] = [...known].filter((id) => !id.startsWith("-")).length;
    // A message ID in two editor files of one locale.
    const seen = new Map<string, string>();
    for (const { file, entries } of own) {
      if (file.namespace === "ui") continue;
      for (const [id, entry] of entries) {
        const other = seen.get(id);
        if (other !== undefined) problems.push({ path: file.path, line: entry.line, text: `${id}: also in ${other}` });
        else seen.set(id, file.path);
      }
    }
    if (locale === SOURCE_LOCALE) continue;
    for (const { file, entries } of own)
      problems.push(...translationProblems(file, entries, sourceOf(file.namespace), known));
    if (!(SUPPORTED_LOCALES as readonly string[]).includes(locale)) continue;
    // Each en-US message of a supported locale has a translation.
    for (const { file, entries } of parsed.filter((item) => item.file.locale === SOURCE_LOCALE)) {
      const missing = [...entries.keys()].filter((id) => !id.startsWith("-") && !known.has(id));
      if (missing.length > 0)
        problems.push({
          path: file.path.replace(`/${SOURCE_LOCALE}`, `/${locale}`),
          line: 1,
          text: `${String(missing.length)} messages have no ${locale} text: ${missing.slice(0, 5).join(", ")}${missing.length > 5 ? ", …" : ""}`,
        });
    }
  }
  // The pseudo-locale of each en-US file parses and keeps each message.
  for (const { file, entries } of parsed.filter((item) => item.file.locale === SOURCE_LOCALE)) {
    const pseudo = entriesOf(file, parse(pseudoLocalize(file.source), { withSpans: true }));
    if (pseudo.problems.length > 0 || pseudo.entries.size !== entries.size)
      problems.push({
        path: file.path,
        line: 1,
        text: "the pseudo-locale of the file does not parse or loses a message",
      });
  }
  return { problems, counts };
}

if (import.meta.main) {
  const { problems, counts } = checkI18n();
  for (const problem of problems) console.log(`${problem.path}:${String(problem.line)}: ${problem.text}`);
  if (process.argv.includes("--coverage"))
    for (const [locale, count] of Object.entries(counts)) console.log(`${locale}: ${String(count)} messages`);
  console.log(`check-i18n: ${String(problems.length)} problems`);
  process.exit(problems.length === 0 ? 0 : 1);
}
