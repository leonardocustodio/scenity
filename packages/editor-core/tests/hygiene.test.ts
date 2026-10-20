// SPDX-License-Identifier: Apache-2.0
// The editor core has no framework: no source file imports Vue. ESLint also checks it. It imports no plugin package,
// that is no name of a package under plugins/. The test itself names no plugin.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "bun:test";

const SRC = join(import.meta.dir, "..", "src");
const PLUGINS = join(import.meta.dir, "..", "..", "..", "plugins");

/** The names of the packages of the plugin parts: plugins/<plugin>/<part> and one level deeper. */
function pluginPackages(): Set<string> {
  const names = new Set<string>();
  const visit = (dir: string, depth: number): void => {
    const manifest = join(dir, "package.json");
    if (existsSync(manifest)) names.add((JSON.parse(readFileSync(manifest, "utf8")) as { name: string }).name);
    if (depth === 0) return;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory() && entry.name !== "node_modules") visit(join(dir, entry.name), depth - 1);
    }
  };
  if (existsSync(PLUGINS)) visit(PLUGINS, 3);
  return names;
}

describe("the editor core", () => {
  it("imports no Vue and no plugin", () => {
    const plugins = pluginPackages();
    expect(plugins.size).toBeGreaterThan(0);
    const files = readdirSync(SRC, { recursive: true })
      .map(String)
      .filter((name) => name.endsWith(".ts"));
    expect(files.length).toBeGreaterThan(5);
    for (const name of files) {
      const text = readFileSync(join(SRC, name), "utf8");
      expect(text, name).not.toMatch(/from\s+["'](vue|@vue\/[^"']*)["']/);
      for (const match of text.matchAll(/from\s+["'](@scenity\/[^/"']+)/g)) {
        expect(plugins.has(match[1] ?? ""), `${name} imports ${match[1] ?? ""}`).toBe(false);
      }
    }
  });
});
