// SPDX-License-Identifier: Apache-2.0
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const SRC = join(import.meta.dir, "../src");
const ids = (locale: string): Map<string, string[]> => {
  const text = readFileSync(join(SRC, "i18n", `${locale}.ftl`), "utf8");
  const out = new Map<string, string[]>();
  let current = "";
  for (const line of text.split("\n")) {
    const message = /^([a-z][a-z0-9_-]*) =/.exec(line);
    if (message?.[1] !== undefined) {
      current = message[1];
      out.set(current, []);
      continue;
    }
    const attribute = /^\s+\.([a-z]+) =/.exec(line);
    if (attribute?.[1] !== undefined && current !== "") out.get(current)?.push(attribute[1]);
  }
  return out;
};
const enUS = ids("en-US");
const ptBR = ids("pt-BR");

describe("ui Fluent resources", () => {
  test("en-US and pt-BR have the same message IDs and attributes", () => {
    expect([...ptBR.keys()].sort()).toEqual([...enUS.keys()].sort());
    for (const [id, attrs] of enUS) expect(ptBR.get(id), id).toEqual(attrs);
  });

  test("every ID has the ui- prefix", () => {
    for (const id of enUS.keys()) expect(id.startsWith("ui-"), id).toBe(true);
  });

  test("every literal ui- ID in the sources exists", () => {
    const files = readdirSync(SRC, { recursive: true }).filter((f) => /\.(ts|vue)$/.test(String(f)));
    const missing: string[] = [];
    for (const file of files) {
      const text = readFileSync(join(SRC, String(file)), "utf8");
      for (const match of text.matchAll(/["']((?:ui)-[a-z0-9_-]+)["']/g)) {
        const id = match[1] ?? "";
        if (!id.endsWith("-") && !enUS.has(id)) missing.push(`${String(file)}: ${id}`);
      }
    }
    expect(missing).toEqual([]);
  });
});
