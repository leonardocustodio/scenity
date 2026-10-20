// SPDX-License-Identifier: Apache-2.0
// The check of the Fluent files of the studio.
import { describe, expect, test } from "bun:test";
import { checkI18n, type FtlFile } from "./check-i18n";

const file = (locale: string, namespace: string, source: string): FtlFile => ({
  path: `apps/editor/src/i18n/${locale}/${namespace}.ftl`,
  locale,
  namespace,
  source,
});

const EN = file("en-US", "demo", "demo-save = Save { $path }\ndemo-open = Open\n    .title = Open a file\n");

describe("checkI18n", () => {
  test("the Fluent files of the repository have no problem and pt-BR has each message", () => {
    const { problems, counts } = checkI18n();
    expect(problems).toEqual([]);
    expect(counts["pt-BR"]).toBe(counts["en-US"]);
  });

  test("a full translation has no problem", () => {
    const pt = file(
      "pt-BR",
      "demo",
      "demo-save = Salvar { $path }\ndemo-open = Abrir\n    .title = Abrir um arquivo\n",
    );
    expect(checkI18n([EN, pt]).problems).toEqual([]);
  });

  test("finds a gap, an unknown message, an unknown variable, a missing attribute and a syntax error", () => {
    const pt = file(
      "pt-BR",
      "demo",
      "demo-save = Salvar { $file }\ndemo-open = Abrir\ndemo-new = Novo\ndemo-bad = {\n",
    );
    const texts = checkI18n([EN, pt]).problems.map((problem) => problem.text);
    expect(texts.some((text) => text.startsWith("syntax:"))).toBe(true);
    expect(texts).toContain("demo-save: en-US has no variable $file");
    expect(texts).toContain("demo-open.title: the attribute is missing");
    expect(texts).toContain("demo-new: en-US has no such message");
    const gap = checkI18n([EN, file("pt-BR", "demo", "demo-open = Abrir\n    .title = Abrir um arquivo\n")]);
    expect(gap.problems.map((problem) => problem.text)).toEqual(["1 messages have no pt-BR text: demo-save"]);
  });

  test("finds a message ID in two files of one locale", () => {
    const other = file("en-US", "other", "demo-save = Save it\n");
    expect(checkI18n([EN, other]).problems.map((problem) => problem.text)).toContain(
      "demo-save: also in apps/editor/src/i18n/en-US/demo.ftl",
    );
  });
});
