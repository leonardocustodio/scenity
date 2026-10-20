// SPDX-License-Identifier: Apache-2.0
/**
 * Write the JSON Schema files of the asset record and of the import settings to packages/assets/schema.
 *
 *   bun packages/assets/scripts/json-schema.ts [--check]     (from the repo root)
 *
 * With --check, the script writes nothing and fails when a file is not current.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { jsonSchemaFiles } from "../src/jsonSchema";

const DIR = join(import.meta.dir, "..", "schema");

function main(): number {
  const check = process.argv.includes("--check");
  let stale = 0;
  for (const { file, text } of jsonSchemaFiles()) {
    const path = join(DIR, file);
    const current = existsSync(path) ? readFileSync(path, "utf8") : undefined;
    if (current === text) continue;
    stale += 1;
    if (check) {
      console.error(`json schema: ${file} is not current; run bun packages/assets/scripts/json-schema.ts`);
      continue;
    }
    mkdirSync(DIR, { recursive: true });
    writeFileSync(path, text);
    console.log(`json schema: wrote ${path}`);
  }
  if (stale === 0) console.log("json schema: the files are current");
  return check && stale > 0 ? 1 : 0;
}

process.exit(main());
