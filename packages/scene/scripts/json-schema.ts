// SPDX-License-Identifier: Apache-2.0
/**
 * Write the JSON Schema files of the documents to packages/scene/schema. There is one file for each document kind (for
 * example project, scene, prefab, overrides, sequence, material and rules). There is also one file for a line of a
 * recorded state stream and one file for an input recording.
 *
 *   bun packages/scene/scripts/json-schema.ts [--check]     (from the repo root)
 *
 * With --check, the script writes nothing and fails when a file is not current.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { jsonSchemaFiles } from "../src/jsonSchema";

const DIR = join(import.meta.dir, "..", "schema");

function main(): number {
  const check = process.argv.includes("--check");
  const stale: string[] = [];
  mkdirSync(DIR, { recursive: true });
  for (const [name, text] of Object.entries(jsonSchemaFiles())) {
    const path = join(DIR, name);
    const current = existsSync(path) ? readFileSync(path, "utf8") : undefined;
    if (current === text) continue;
    if (check) stale.push(name);
    else writeFileSync(path, text);
  }
  if (stale.length > 0) {
    console.error(`scene schema: not current: ${stale.join(", ")}; run bun packages/scene/scripts/json-schema.ts`);
    return 1;
  }
  console.log(check ? "scene schema: the files are current" : `scene schema: wrote ${DIR}`);
  return 0;
}

process.exit(main());
