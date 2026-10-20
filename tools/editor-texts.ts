// SPDX-License-Identifier: Apache-2.0
/**
 * The text lint of the editor: each text that the editor shows comes from Fluent.
 *
 * Run from the repo root:
 *     bun tools/editor-texts.ts            # exit 1 on a text that is not in Fluent, a missing message or a stale entry
 *     bun tools/editor-texts.ts --json apps/editor/src/scene/gizmo   # the findings under the prefixes as allowlist JSON
 *
 * The lint reads the Vue and TypeScript files of the scene page, the editor core, the asset browser and the player
 * window (EDITOR_ROOTS). It finds three kinds of text:
 * - the static text of a Vue template and the static text attributes (title, placeholder, aria-label, alt, label);
 * - a string literal that goes into a text sink: `textContent`, `title`, `placeholder`, `document.title`,
 *   `setAttribute` of a text attribute, `append` and `createTextNode`, and each literal of a template interpolation;
 * - a string literal that reads as prose: two words, or one word with a capital letter and lower case letters.
 * It does not read literals of imports, console calls, errors, comparisons, type positions, DOM queries, storage keys,
 * events and CSS classes, and the message IDs of `t()` and `$t()`.
 *
 * Each finding must be in a file of the folder editor-texts-allowlist/ with the reason why it is not a text of the
 * interface (a key name, a data value, a developer text). An entry with no finding is stale and fails. The lint also
 * checks that each
 * literal message ID of `t()`, `$t()` and `$ta()` is a message of the en-US resources of the editor.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join, relative, resolve, sep } from "node:path";
import ts from "typescript";
import tseslint from "typescript-eslint";
import { parse as parseVue } from "vue-eslint-parser";

export const ROOT = resolve(import.meta.dir, "..");
/** The allowlist folder: one JSON file per part of the editor (each file maps a path to its texts and reasons). */
export const ALLOWLIST = join(ROOT, "tools", "editor-texts-allowlist");

/** The folders of the editor that show text to people. */
export const EDITOR_ROOTS = [
  "apps/editor/src/scene",
  "apps/editor/src/core",
  "apps/editor/src/assetBrowser",
  "apps/editor/src/player",
  // The Hub of Scenity Studio.
  "apps/editor/src/hub",
  // The editor window of Scenity Studio.
  "apps/editor/src/studio",
];
/** The Fluent resources of the editor and of the ui package (the messages that `t()` can read). */
const MESSAGE_FILES = ["apps/editor/src/i18n/en-US", "packages/ui/src/i18n/en-US.ftl"];

/** One text that is not in Fluent. */
export interface Finding {
  readonly path: string;
  readonly line: number;
  readonly text: string;
}

/** The allowlist: for each file, each allowed text with its reason. */
export type Allowlist = Readonly<Record<string, Readonly<Record<string, string>>>>;

/** The attributes whose value people read. */
const TEXT_ATTRIBUTES = new Set(["title", "placeholder", "aria-label", "alt", "label", "aria-description"]);
/** The properties whose value people read (an assignment `x.title = "…"`). */
const TEXT_PROPERTIES = new Set(["textContent", "innerText", "title", "placeholder", "ariaLabel", "alt", "label"]);
/** The methods whose string arguments people read. */
const TEXT_METHODS = new Set(["append", "prepend", "createTextNode", "replaceChildren", "before", "after"]);
/** The methods of the message IDs. */
const MESSAGE_METHODS = new Set(["t", "$t", "$ta", "format"]);
/** Calls whose string arguments are never text of the interface. */
const CODE_CALL =
  /^(console\.\w+|.*\b(querySelector|querySelectorAll|getElementById|closest|matches|addEventListener|removeEventListener|dispatchEvent|createElement|createElementNS|getAttribute|hasAttribute|removeAttribute|toggleAttribute|fetch|getItem|setItem|removeItem|matchMedia|startsWith|endsWith|includes|split|replace|replaceAll|indexOf|lastIndexOf|padStart|padEnd|join|postMessage|getContext|mark|measure|getPropertyValue|setProperty|removeProperty|get|has|delete|getAll|set|append(?=$)|warn|error|info|debug|log|defineProps|defineEmits|withDefaults|inject|provide|Symbol|require|keys|test|exec|match|search|localeCompare|toggle|add|remove|contains)|import)$/;
/** Constructors whose string arguments are never text of the interface. */
const CODE_NEW = /(Error|Event|CustomEvent|URL|URLSearchParams|RegExp|Worker|BroadcastChannel|Blob|File|Request)$/;
/** Object keys and assigned properties whose string value is code: IDs, kinds, classes, keys and paths. */
const CODE_KEYS =
  /^(id|testId|testid|key|keys|kind|type|class|className|cssText|icon|mode|path|role|event|command|context|src|href|url|mime|accept|tag|name|ref|target|dir|lang|theme|cursor|display|position|value|step|min|max|unit|format|variant|size|tone|side|align|state|status|code|scope|group|axis|channel|field|prop|slot|source|layer|tab|view|chord|keyContext|placement|anchor|inputMode|autocomplete|draggable|method|backend|renderer|level|filter|sort|query|locale|component|op|action|selector|testIdPrefix|storageKey|dataset)$/;

const isLetterText = (text: string): boolean => /[A-Za-z]{2,}/.test(text);

/** True when the text reads as CSS classes (`flex items-center gap-1`) or a style. */
function isClassText(text: string): boolean {
  const tokens = text.trim().split(/\s+/);
  return (
    tokens.length > 0 &&
    tokens.every((token) => /^[a-z0-9\-:/[\]._!%#()&>=*~@,'"]+$/.test(token)) &&
    tokens.some((token) => /[a-z0-9][-:][a-z0-9[]|\[/.test(token))
  );
}

/** True when the text is one token of code: an ID, a path, a key or a file name. */
function isCodeToken(text: string): boolean {
  return !/\s/.test(text.trim()) && /[-_./:@#=?&<>{}()|\\]|[a-z][A-Z]/.test(text);
}

/** True when a literal outside a text sink reads as prose: two words, or one capital word ("Save"). */
export function isProse(text: string): boolean {
  const value = text.trim();
  if (!isLetterText(value) || isClassText(value) || isCodeToken(value)) return false;
  const words = value.split(/\s+/).filter((word) => /[A-Za-z]{2,}/.test(word));
  return words.length >= 2 || /^[A-Z][a-z]+\b/.test(value);
}

/** True when a literal in a text sink is a text of the interface (not a class list, an ID or a path). */
export function isSinkText(text: string): boolean {
  const value = text.trim();
  return isLetterText(value) && !isClassText(value) && !isCodeToken(value);
}

/** The text of a literal node: a template literal gives `{}` for each placeable. */
function literalText(node: ts.Node): string | null {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (ts.isTemplateExpression(node))
    return [node.head.text, ...node.templateSpans.map((span) => `{}${span.literal.text}`)].join("");
  return null;
}

function calleeName(expression: ts.Expression): string {
  if (ts.isIdentifier(expression)) return expression.text;
  if (ts.isPropertyAccessExpression(expression)) return `${calleeName(expression.expression)}.${expression.name.text}`;
  if (ts.isElementAccessExpression(expression)) return `${calleeName(expression.expression)}[]`;
  if (ts.isCallExpression(expression)) return `${calleeName(expression.expression)}()`;
  return "";
}

function lastName(name: string): string {
  return name.split(".").at(-1) ?? name;
}

function propertyName(name: ts.PropertyName): string {
  return ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isPrivateIdentifier(name) ? name.text : "";
}

type Verdict = "skip" | "sink" | "prose";

/** The verdict of the context of a literal: code (skip), a text sink, or a plain place that needs the prose rule. */
function contextOf(node: ts.Node): Verdict {
  let child: ts.Node = node;
  while (!ts.isSourceFile(child)) {
    const parent: ts.Node = child.parent;
    if (ts.isTypeNode(parent) || ts.isImportDeclaration(parent) || ts.isExportDeclaration(parent)) return "skip";
    if (ts.isImportTypeNode(parent) || ts.isLiteralTypeNode(parent) || ts.isEnumMember(parent)) return "skip";
    if (ts.isCaseClause(parent) || ts.isElementAccessExpression(parent) || ts.isComputedPropertyName(parent))
      return "skip";
    if (ts.isBinaryExpression(parent)) {
      const kind = parent.operatorToken.kind;
      const compare = [
        ts.SyntaxKind.EqualsEqualsEqualsToken,
        ts.SyntaxKind.ExclamationEqualsEqualsToken,
        ts.SyntaxKind.EqualsEqualsToken,
        ts.SyntaxKind.ExclamationEqualsToken,
        ts.SyntaxKind.InKeyword,
      ];
      if (compare.includes(kind)) return "skip";
      if (kind === ts.SyntaxKind.EqualsToken && child === parent.right) {
        const target = calleeName(parent.left);
        if (target === "document.title" || TEXT_PROPERTIES.has(lastName(target))) return "sink";
        if (/(^|\.)(dataset|style)\./.test(target) || CODE_KEYS.test(lastName(target))) return "skip";
        return "prose";
      }
    }
    if (ts.isCallExpression(parent) && parent.arguments.includes(child as ts.Expression)) {
      const name = calleeName(parent.expression);
      const last = lastName(name);
      if (MESSAGE_METHODS.has(last) && parent.arguments[0] === child) return "skip";
      if (last === "setAttribute") {
        const first = parent.arguments[0];
        return first !== undefined && ts.isStringLiteral(first) && TEXT_ATTRIBUTES.has(first.text) && child !== first
          ? "sink"
          : "skip";
      }
      if (TEXT_METHODS.has(last)) return "sink";
      if (CODE_CALL.test(name) || CODE_CALL.test(last)) return "skip";
      return "prose";
    }
    if (ts.isNewExpression(parent)) {
      const name = calleeName(parent.expression);
      if (name === "Option") return "sink";
      return CODE_NEW.test(name) ? "skip" : "prose";
    }
    if (ts.isPropertyAssignment(parent) && child === parent.initializer) {
      return CODE_KEYS.test(propertyName(parent.name)) ? "skip" : "prose";
    }
    if (ts.isThrowStatement(parent)) return "skip";
    if (ts.isStatement(parent) || ts.isSourceFile(parent)) return "prose";
    child = parent;
  }
  return "prose";
}

/** The findings and the literal message IDs of a TypeScript source. `displayed`: each literal is a sink. */
function scanScript(code: string, displayed: boolean, lineOf: (pos: number) => number, out: Collect): void {
  const file = ts.createSourceFile("x.ts", code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && MESSAGE_METHODS.has(lastName(calleeName(node.expression)))) {
      const first = node.arguments[0];
      if (first !== undefined && ts.isStringLiteral(first) && /^[a-z][a-z0-9-]*$/.test(first.text)) {
        out.ids.push({ id: first.text, line: lineOf(first.getStart(file)) });
      }
    }
    const text = literalText(node);
    if (text !== null) {
      const verdict = contextOf(node);
      const shown =
        verdict === "sink" || (displayed && verdict !== "skip")
          ? isSinkText(text)
          : verdict === "prose" && isProse(text);
      if (shown) out.texts.push({ line: lineOf(node.getStart(file)), text });
      if (ts.isTemplateExpression(node)) node.templateSpans.forEach((span) => visit(span.expression));
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
}

interface Collect {
  readonly texts: { line: number; text: string }[];
  readonly ids: { id: string; line: number }[];
}

// The nodes of vue-eslint-parser that the lint reads.
interface VNode {
  readonly type: string;
  readonly range: [number, number];
  readonly value?: unknown;
  readonly children?: readonly VNode[];
  readonly startTag?: { readonly attributes: readonly VAttr[] };
  readonly rawName?: string;
}
interface VAttr {
  readonly directive: boolean;
  readonly key: { readonly name: string | { name: string }; readonly argument?: { name?: string } | null };
  readonly value: { readonly type: string; readonly value?: string; readonly range: [number, number] } | null;
}

/** The findings of a Vue file: the template and each script block. */
function scanVue(code: string, lineOf: (pos: number) => number, out: Collect): void {
  for (const match of code.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)) {
    const start = match.index + match[0].indexOf(">") + 1;
    scanScript(match[1] ?? "", false, (pos) => lineOf(start + pos), out);
  }
  const ast = parseVue(code, { sourceType: "module", ecmaVersion: "latest", parser: tseslint.parser }) as unknown as {
    templateBody?: VNode;
  };
  const expression = (range: [number, number], displayed: boolean, handler: boolean): void => {
    const inner = code.slice(range[0] + 1, range[1] - 1);
    const offset = range[0] + 1 - (handler ? 0 : 1);
    scanScript(handler ? inner : `(${inner})`, displayed, (pos) => lineOf(offset + pos), out);
  };
  const walk = (node: VNode, data: boolean): void => {
    const attributes = node.startTag?.attributes ?? [];
    const own = attributes.some((attribute) => !attribute.directive && attribute.key.name === "translate");
    const inData = data || own || node.rawName === "kbd";
    for (const attribute of attributes) {
      const value = attribute.value;
      if (value === null) continue;
      if (!attribute.directive) {
        const name = typeof attribute.key.name === "string" ? attribute.key.name : attribute.key.name.name;
        if (TEXT_ATTRIBUTES.has(name) && typeof value.value === "string" && isLetterText(value.value)) {
          out.texts.push({ line: lineOf(value.range[0]), text: value.value });
        }
        continue;
      }
      const directive = typeof attribute.key.name === "string" ? attribute.key.name : attribute.key.name.name;
      if (directive === "for" || directive === "slot") continue;
      const argument = attribute.key.argument?.name ?? "";
      expression(value.range, directive === "bind" && TEXT_ATTRIBUTES.has(argument), directive === "on");
    }
    for (const child of node.children ?? []) {
      if (child.type === "VText") {
        const text = String(child.value).trim();
        if (!inData && isLetterText(text)) out.texts.push({ line: lineOf(child.range[0]), text });
      } else if (child.type === "VExpressionContainer") {
        const inner = code.slice(child.range[0] + 2, child.range[1] - 2);
        if (!inData) scanScript(`(${inner})`, true, (pos) => lineOf(child.range[0] + 1 + pos), out);
      } else walk(child, inData);
    }
  };
  if (ast.templateBody !== undefined) walk(ast.templateBody, false);
}

function lineIndex(code: string): (pos: number) => number {
  const starts = [0];
  for (let index = 0; index < code.length; index += 1) if (code[index] === "\n") starts.push(index + 1);
  return (pos) => {
    let low = 0;
    let high = starts.length - 1;
    while (low < high) {
      const mid = Math.ceil((low + high) / 2);
      if ((starts[mid] ?? 0) <= pos) low = mid;
      else high = mid - 1;
    }
    return low + 1;
  };
}

function walkFiles(folder: string, out: string[]): void {
  for (const name of readdirSync(folder)) {
    const path = join(folder, name);
    if (statSync(path).isDirectory()) {
      if (name !== "generated" && name !== "node_modules") walkFiles(path, out);
    } else if ((extname(name) === ".ts" && !name.endsWith(".d.ts")) || extname(name) === ".vue") out.push(path);
  }
}

/** The editor files, relative to the repo root with "/" as the separator. */
export function editorFiles(root = ROOT): string[] {
  const out: string[] = [];
  for (const folder of EDITOR_ROOTS) if (existsSync(join(root, folder))) walkFiles(join(root, folder), out);
  return out.map((path) => relative(root, path).split(sep).join("/")).sort();
}

/** The findings of one source text. */
export function scanSource(path: string, code: string): { texts: Finding[]; ids: { id: string; line: number }[] } {
  const out: Collect = { texts: [], ids: [] };
  const lineOf = lineIndex(code);
  if (path.endsWith(".vue")) scanVue(code, lineOf, out);
  else scanScript(code, false, lineOf, out);
  return { texts: out.texts.map((item) => ({ path, ...item })), ids: out.ids };
}

/** The message IDs of the en-US resources of the editor and of the ui package. */
export function messageIds(root = ROOT): Set<string> {
  const ids = new Set<string>();
  const read = (path: string): void => {
    for (const match of readFileSync(path, "utf8").matchAll(/^(-?[a-zA-Z][\w-]*)\s*=/gm)) ids.add(match[1] ?? "");
  };
  for (const entry of MESSAGE_FILES) {
    const path = join(root, entry);
    if (!existsSync(path)) continue;
    if (statSync(path).isDirectory()) {
      for (const name of readdirSync(path)) if (name.endsWith(".ftl")) read(join(path, name));
    } else read(path);
  }
  return ids;
}

export interface Problem {
  readonly path: string;
  readonly message: string;
}

/** The findings of the editor and the problems against the allowlist. */
export function check(root = ROOT, allow: Allowlist = readAllowlist()): { findings: Finding[]; problems: Problem[] } {
  const ids = messageIds(root);
  const findings: Finding[] = [];
  const problems: Problem[] = [];
  for (const path of editorFiles(root)) {
    const result = scanSource(path, readFileSync(join(root, path), "utf8"));
    findings.push(...result.texts);
    for (const { id, line } of result.ids) {
      if (!ids.has(id)) problems.push({ path, message: `${String(line)}: no en-US message "${id}"` });
    }
  }
  const found = new Map<string, Set<string>>();
  for (const finding of findings) {
    const texts = found.get(finding.path) ?? new Set<string>();
    texts.add(finding.text);
    found.set(finding.path, texts);
    if (allow[finding.path]?.[finding.text] === undefined) {
      problems.push({
        path: finding.path,
        message: `${String(finding.line)}: text not in Fluent: ${JSON.stringify(finding.text)}`,
      });
    }
  }
  for (const [path, texts] of Object.entries(allow)) {
    for (const text of Object.keys(texts)) {
      if (found.get(path)?.has(text) !== true) problems.push({ path, message: `stale entry: ${JSON.stringify(text)}` });
    }
  }
  return { findings, problems };
}

/** Read and merge the JSON files of the allowlist folder. */
export function readAllowlist(folder = ALLOWLIST): Allowlist {
  const out: Record<string, Record<string, string>> = {};
  if (!existsSync(folder)) return out;
  for (const name of readdirSync(folder).sort()) {
    if (!name.endsWith(".json")) continue;
    const part = JSON.parse(readFileSync(join(folder, name), "utf8")) as Allowlist;
    for (const [path, texts] of Object.entries(part)) out[path] = { ...out[path], ...texts };
  }
  return out;
}

/** The findings under some path prefixes as allowlist JSON, with the reason of an old entry or "TODO". */
export function findingsJson(findings: readonly Finding[], allow: Allowlist, prefixes: readonly string[]): Allowlist {
  const out: Record<string, Record<string, string>> = {};
  const chosen = findings.filter(
    (finding) => prefixes.length === 0 || prefixes.some((p) => finding.path.startsWith(p)),
  );
  for (const finding of [...chosen].sort((a, b) => a.path.localeCompare(b.path) || a.line - b.line)) {
    const texts = (out[finding.path] ??= {});
    texts[finding.text] = allow[finding.path]?.[finding.text] ?? "TODO";
  }
  return out;
}

if (import.meta.main) {
  const allow = readAllowlist();
  const { findings, problems } = check(ROOT, allow);
  const json = process.argv.indexOf("--json");
  if (json >= 0) {
    console.log(JSON.stringify(findingsJson(findings, allow, process.argv.slice(json + 1)), null, 2));
  } else {
    for (const problem of problems) console.log(`${problem.path}:${problem.message}`);
    console.log(`editor-texts: ${String(findings.length)} texts outside Fluent, ${String(problems.length)} problems`);
    if (problems.length > 0) process.exit(1);
  }
}
