// SPDX-License-Identifier: Apache-2.0
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { FluentBundle, FluentResource } from "@fluent/bundle";
import { FluentParser, Message, Term, Visitor, type VariableReference } from "@fluent/syntax";
import { pseudoLocalize, pseudoText } from "../src/pseudo";

const WEB = join(import.meta.dir, "../../..");
/**
 * The en-US texts of the engine: the files of this repository. The texts of a plugin have their own test in the
 * plugin.
 */
const EDITOR_EN_US = join(WEB, "apps/editor/src/i18n/en-US");
/** The editor has one file per part (`apps/editor/src/i18n/en-US/<name>.ftl`). */
const EN_US_FILES = [
  join(WEB, "packages/ui/src/i18n/en-US.ftl"),
  ...readdirSync(EDITOR_EN_US)
    .filter((name) => name.endsWith(".ftl"))
    .sort()
    .map((name) => join(EDITOR_EN_US, name)),
];

/** The IDs, attribute names and variable names of a resource, by the reference parser. */
function shape(source: string): Map<string, { attributes: string[]; variables: string[] }> {
  const resource = new FluentParser().parse(source);
  const junk = resource.body.filter((entry) => entry.type === "Junk");
  expect(junk).toEqual([]);
  const out = new Map<string, { attributes: string[]; variables: string[] }>();
  for (const entry of resource.body) {
    if (entry instanceof Message || entry instanceof Term) {
      const variables = new Set<string>();
      class Collect extends Visitor {
        override visitVariableReference(node: VariableReference): void {
          variables.add(node.id.name);
        }
      }
      new Collect().visit(entry);
      out.set(entry.id.name, {
        attributes: entry.attributes.map((attribute) => attribute.id.name).sort(),
        variables: [...variables].sort(),
      });
    }
  }
  return out;
}

function formatAll(source: string, locale: string, args: Record<string, string | number>): Map<string, string> {
  const bundle = new FluentBundle(locale, { useIsolating: false });
  expect(bundle.addResource(new FluentResource(source))).toEqual([]);
  const out = new Map<string, string>();
  for (const id of shape(source).keys()) {
    const message = bundle.getMessage(id);
    if (message?.value) {
      out.set(id, bundle.formatPattern(message.value, args, []));
    }
    for (const [name, value] of Object.entries(message?.attributes ?? {})) {
      out.set(`${id}.${name}`, bundle.formatPattern(value, args, []));
    }
  }
  return out;
}

describe("pseudoText", () => {
  test("accents letters and doubles vowels", () => {
    expect(pseudoText("Today")).toBe("Ŧǿǿḓȧȧẏ");
    expect(pseudoText("ABC xyz")).toBe("ȦȦƁƇ ẋẏẑ");
  });

  test("keeps digits, punctuation, markup and character references", () => {
    expect(pseudoText("2.8 s, <b>bold</b> &amp; 42%")).toBe("2.8 ş, <b>ƀǿǿŀḓ</b> &amp; 42%");
  });
});

describe("pseudoLocalize", () => {
  const SOURCE = [
    "-brand = Scenity",
    "    .gender = masculine",
    "hello = Hello, { $name }! You have { $n ->",
    "    [one] one message",
    "   *[other] { $n } messages",
    "  } from { -brand }.",
    "multi =",
    "    Line one",
    "    Line two",
    "",
    "    Line four",
    "    { $x } after",
    'lead = {"  "}two spaces',
    "attrs =",
    "    .aria-label = Close the { -brand } menu",
    "only-select = { $n ->",
    "    [0] none",
    "   *[other] some { NUMBER($n, minimumFractionDigits: 1) }",
    "}",
    'literal = Use {"{"} braces',
    "gendered = { -brand.gender ->",
    "    [masculine] He",
    "   *[other] They",
    "}",
    "",
  ].join("\n");

  test("keeps IDs, attributes and variables, and writes valid FTL", () => {
    const pseudo = pseudoLocalize(SOURCE);
    expect(shape(pseudo)).toEqual(shape(SOURCE));
  });

  test("brackets each message value and attribute, but not terms", () => {
    const text = formatAll(pseudoLocalize(SOURCE), "en-XA", { name: "Ana", n: 2, x: "X" });
    expect(text.get("hello")).toBe("[Ħḗḗŀŀǿǿ, Ana! Ẏǿǿŭŭ ħȧȧṽḗḗ 2 ḿḗḗşşȧȧɠḗḗş ƒřǿǿḿ Şƈḗḗƞīīŧẏ.]");
    expect(text.get("multi")).toBe("[Ŀīīƞḗḗ ǿǿƞḗḗ\nĿīīƞḗḗ ŧẇǿǿ\n\nĿīīƞḗḗ ƒǿǿŭŭř\nX ȧȧƒŧḗḗř]");
    expect(text.get("lead")).toBe("[  ŧẇǿǿ şƥȧȧƈḗḗş]");
    expect(text.get("attrs.aria-label")).toBe("[Ƈŀǿǿşḗḗ ŧħḗḗ Şƈḗḗƞīīŧẏ ḿḗḗƞŭŭ]");
    expect(text.get("only-select")).toBe("[şǿǿḿḗḗ 2.0]");
    expect(text.get("literal")).toBe("[ŬŬşḗḗ { ƀřȧȧƈḗḗş]");
  });

  test("keeps term attributes, so selectors on them still match", () => {
    const text = formatAll(pseudoLocalize(SOURCE), "en-XA", {});
    expect(text.get("gendered")).toBe("[Ħḗḗ]");
  });

  test("keeps the variant keys of plural selectors", () => {
    const text = formatAll(pseudoLocalize(SOURCE), "en-XA", { name: "Ana", n: 1, x: "X" });
    expect(text.get("hello")).toContain("ǿǿƞḗḗ ḿḗḗşşȧȧɠḗḗ");
    expect(formatAll(pseudoLocalize(SOURCE), "en-XA", { n: 0 }).get("only-select")).toBe("[ƞǿǿƞḗḗ]");
  });

  test("handles special characters at the start of a line", () => {
    const source = 'special =\n    first\n    {"["}bracket\n    {"*"}star\n    {"."}dot\n';
    const pseudo = pseudoLocalize(source);
    expect(shape(pseudo)).toEqual(shape(source));
    expect(formatAll(pseudo, "en-XA", {}).get("special")).toBe("[ƒīīřşŧ\n[ƀřȧȧƈķḗḗŧ\n*şŧȧȧř\n.ḓǿǿŧ]");
  });

  test("returns an empty resource for an empty source", () => {
    expect(pseudoLocalize("# Only a comment\n")).toBe("");
  });

  // The engine texts are short labels, so the two brackets of each text add more than in long texts.
  test("makes the en-US texts of the engine 30 % to 60 % longer", () => {
    let source = 0;
    let pseudo = 0;
    for (const file of EN_US_FILES) {
      const text = readFileSync(file, "utf8");
      const plain = formatAll(text, "en-US", {
        count: 3,
        seconds: 5,
        page: "Plan",
        name: "Ana",
        version: "1.0",
        build: "abc",
        requestId: "r-1",
      });
      const accented = formatAll(pseudoLocalize(text), "en-XA", {
        count: 3,
        seconds: 5,
        page: "Plan",
        name: "Ana",
        version: "1.0",
        build: "abc",
        requestId: "r-1",
      });
      expect([...accented.keys()]).toEqual([...plain.keys()]);
      for (const [id, value] of plain) {
        source += value.length;
        pseudo += accented.get(id)?.length ?? 0;
      }
    }
    const growth = pseudo / source - 1;
    expect(growth).toBeGreaterThan(0.3);
    expect(growth).toBeLessThan(0.6);
  });
});
