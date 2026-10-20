// SPDX-License-Identifier: Apache-2.0
/**
 * The pseudo-locale en-XA.
 *
 * pseudoLocalize() reads an en-US FTL resource and writes the same resource with pseudo text. It changes
 * only the text of values: message values, message attributes, variant values and term values. It keeps
 * the IDs, the variables, the references, the selectors, the variant keys, the string literals and the
 * term attributes (term attributes are selector parameters, so they must not change).
 *
 * The pseudo text has accented letters, doubled vowels (about 35 % longer than the source) and brackets
 * around each message value and attribute. Text that a component does not take from Fluent shows without
 * accents, and a cut bracket shows truncation.
 *
 * The browser bundle has no @fluent/syntax (it is a development dependency), so this module parses with
 * the runtime parser of @fluent/bundle and writes the FTL from that tree. The runtime parser skips
 * comments and entries with errors; tools/check-i18n.ts checks the syntax of every file in CI.
 */
import { FluentResource } from "@fluent/bundle";

// The runtime AST of @fluent/bundle (esm/ast.d.ts). The package exports only the Message type.
type Literal = { type: "str"; value: string } | { type: "num"; value: number; precision: number };
type NamedArgument = { type: "narg"; name: string; value: Literal };
type Expression =
  | Literal
  | { type: "var"; name: string }
  | { type: "term"; name: string; attr: string | null; args: (Expression | NamedArgument)[] }
  | { type: "mesg"; name: string; attr: string | null }
  | { type: "func"; name: string; args: (Expression | NamedArgument)[] }
  | { type: "select"; selector: Expression; variants: { key: Literal; value: Pattern }[]; star: number };
type Pattern = string | (string | Expression)[];
interface Entry {
  id: string;
  value: Pattern | null;
  attributes: Record<string, Pattern>;
}

const ASCII = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const ACCENTED = "ȦƁƇḒḖƑƓĦĪĴĶĿḾȠǾƤɊŘŞŦŬṼẆẊẎẐȧƀƈḓḗƒɠħīĵķŀḿƞǿƥɋřşŧŭṽẇẋẏẑ";
const ACCENT_MAP: ReadonlyMap<string, string> = new Map(
  Array.from(ASCII, (letter, index) => [letter, Array.from(ACCENTED)[index] ?? letter]),
);
/** Markup and character references stay as they are. */
const MARKUP = /(<[^>]*>|&#?\w+;)/;
const INDENT = "    ";

/** Return the pseudo form of a plain text: doubled vowels and accented letters. */
export function pseudoText(text: string): string {
  return text
    .split(MARKUP)
    .map((part, index) =>
      index % 2 === 1
        ? part
        : part.replace(/[A-Za-z]/g, (letter) => {
            const accented = ACCENT_MAP.get(letter) ?? letter;
            return "AEIOUaeiou".includes(letter) ? accented + accented : accented;
          }),
    )
    .join("");
}

function transformPattern(pattern: Pattern): Pattern {
  if (typeof pattern === "string") {
    return pseudoText(pattern);
  }
  return pattern.map((element) => {
    if (typeof element === "string") {
      return pseudoText(element);
    }
    if (element.type === "select") {
      return {
        ...element,
        variants: element.variants.map((variant) => ({ key: variant.key, value: transformPattern(variant.value) })),
      };
    }
    return element;
  });
}

function bracketed(pattern: Pattern): Pattern {
  return typeof pattern === "string" ? `[${pattern}]` : ["[", ...pattern, "]"];
}

function serializeString(value: string): string {
  const escaped = value
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/[\n\r]/g, (char) => (char === "\n" ? "\\u000A" : "\\u000D"));
  return `"${escaped}"`;
}

function serializeLiteral(literal: Literal): string {
  return literal.type === "str" ? serializeString(literal.value) : literal.value.toFixed(literal.precision);
}

function serializeArguments(args: readonly (Expression | NamedArgument)[], indent: string): string {
  const parts = args.map((arg) =>
    arg.type === "narg" ? `${arg.name}: ${serializeLiteral(arg.value)}` : serializeExpression(arg, indent),
  );
  return `(${parts.join(", ")})`;
}

function serializeExpression(expression: Expression, indent: string): string {
  switch (expression.type) {
    case "str":
    case "num":
      return serializeLiteral(expression);
    case "var":
      return `$${expression.name}`;
    case "mesg":
      return expression.attr === null ? expression.name : `${expression.name}.${expression.attr}`;
    case "term": {
      const name = expression.attr === null ? `-${expression.name}` : `-${expression.name}.${expression.attr}`;
      return expression.args.length > 0 ? name + serializeArguments(expression.args, indent) : name;
    }
    case "func":
      return expression.name + serializeArguments(expression.args, indent);
    case "select": {
      // The variants and the closing brace go on their own lines, as the @fluent/syntax serializer writes them.
      const close = indent + INDENT;
      const inner = close + INDENT;
      const variants = expression.variants.map((variant, index) => {
        const key = variant.key.type === "str" ? variant.key.value : serializeLiteral(variant.key);
        const star = index === expression.star ? "*" : " ";
        return `\n${inner.slice(1)}${star}[${key}] ${serializePattern(variant.value, inner)}`;
      });
      return `${serializeExpression(expression.selector, indent)} ->${variants.join("")}\n${close}`;
    }
  }
}

/**
 * Write a text so that the runtime parser and @fluent/syntax read the same text back. Braces become string
 * literals. At the start of a line (or of the pattern), the special characters "[", "*", "." and leading
 * spaces also become string literals, because the parsers read them as syntax or as indentation.
 */
function serializeText(text: string, indent: string, atPatternStart: boolean): string {
  const lines = text.split("\n");
  return lines
    .map((line, index) => {
      let safe = line.replace(/[{}]/g, (brace) => `{${serializeString(brace)}}`);
      const lineStart = index > 0 || atPatternStart;
      if (index > 0 && /^[[*.]/.test(safe)) {
        safe = `{${serializeString(safe.charAt(0))}}${safe.slice(1)}`;
      }
      const lead = /^ +/.exec(safe)?.[0] ?? "";
      if (lineStart && lead !== "") {
        safe = `{${serializeString(lead)}}${safe.slice(lead.length)}`;
      }
      if (index === 0) {
        return safe;
      }
      // A blank line inside the text needs no indent; every other line does.
      const blank = line === "" && index < lines.length - 1;
      return `\n${blank ? "" : indent + INDENT}${safe}`;
    })
    .join("");
}

/** Join adjacent text elements, so that a line break and the next line are one text. */
function elementsOf(pattern: Pattern): (string | Expression)[] {
  const out: (string | Expression)[] = [];
  for (const element of typeof pattern === "string" ? [pattern] : pattern) {
    const last = out.at(-1);
    if (typeof element === "string" && typeof last === "string") {
      out[out.length - 1] = last + element;
    } else {
      out.push(element);
    }
  }
  return out;
}

function serializePattern(pattern: Pattern, indent: string): string {
  let out = "";
  for (const element of elementsOf(pattern)) {
    if (typeof element === "string") {
      out += serializeText(element, indent, out === "");
    } else if (element.type === "select") {
      out += `{ ${serializeExpression(element, indent)}}`;
    } else {
      out += `{ ${serializeExpression(element, indent)} }`;
    }
  }
  return out;
}

function serializeEntry(entry: Entry): string {
  const lines = [entry.value === null ? `${entry.id} =` : `${entry.id} = ${serializePattern(entry.value, "")}`];
  for (const [name, value] of Object.entries(entry.attributes)) {
    lines.push(`${INDENT}.${name} = ${serializePattern(value, INDENT)}`);
  }
  return lines.join("\n");
}

/** Return the pseudo-locale form of an FTL resource (see the module comment). */
export function pseudoLocalize(source: string): string {
  const body: readonly Entry[] = new FluentResource(source).body;
  const entries = body.map((entry): Entry => {
    if (entry.id.startsWith("-")) {
      // A term: pseudo text in the value, attributes unchanged (they are selector parameters).
      return { ...entry, value: entry.value === null ? null : transformPattern(entry.value) };
    }
    const attributes: Record<string, Pattern> = {};
    for (const [name, value] of Object.entries(entry.attributes)) {
      attributes[name] = bracketed(transformPattern(value));
    }
    return {
      id: entry.id,
      value: entry.value === null ? null : bracketed(transformPattern(entry.value)),
      attributes,
    };
  });
  return entries.map(serializeEntry).join("\n") + (entries.length > 0 ? "\n" : "");
}
