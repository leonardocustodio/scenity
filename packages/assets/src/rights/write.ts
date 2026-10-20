// SPDX-License-Identifier: Apache-2.0
/**
 * The writer of a rights record: the editor makes `rights/<name>.yaml` from a form.
 * The writer checks the name and the fields that it needs, writes the YAML with each text quoted, and reads the file
 * again (`readRightsFile`), so the result has the problems that the release gate will see (a licence date, no web use).
 * A record that exists stays unless the call asks to replace it.
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { readRightsFile } from "./records";

/** The fields of a new rights record. */
export interface RightsInput {
  /** The name of the record: lower case letters, digits and "-" (the file `rights/<name>.yaml`). */
  readonly name: string;
  readonly source: string;
  readonly author: string;
  readonly licence: string;
  readonly spdx?: string | null;
  readonly licenceUrl?: string | null;
  /** YYYY-MM-DD. */
  readonly licenceDate: string;
  readonly allowedUse: readonly string[];
  readonly webDelivery: boolean | "pending";
  readonly attribution?: string | null;
  /** "generated" for the record of a generator (a text to model, texture or sky service). */
  readonly kind?: "generated";
  /** The generator of a generated record. */
  readonly generator?: string;
}

/** The result of a write: the path of the record and its problems, or the reason of a refusal. */
export type RightsWriteResult =
  | { readonly ok: true; readonly path: string; readonly problems: readonly string[] }
  | { readonly ok: false; readonly reason: string };

const NAME = /^[a-z0-9][a-z0-9-]{0,63}$/;

/** A YAML text value (a JSON string is a valid YAML scalar); null for no value. */
const text = (value: string | null | undefined): string =>
  value === undefined || value === null || value === "" ? "null" : JSON.stringify(value);

/** The YAML of a rights record. */
export function rightsYaml(input: RightsInput): string {
  const lines = [
    `name: ${input.name}`,
    `source: ${text(input.source)}`,
    `author: ${text(input.author)}`,
    `licence: ${text(input.licence)}`,
    `spdx: ${text(input.spdx)}`,
    `licenceUrl: ${text(input.licenceUrl)}`,
    `licenceDate: ${input.licenceDate}`,
    `allowedUse: [${input.allowedUse.map((use) => JSON.stringify(use)).join(", ")}]`,
    `webDelivery: ${input.webDelivery === "pending" ? "pending" : String(input.webDelivery)}`,
    `attribution: ${text(input.attribution)}`,
    ...(input.kind === undefined ? [] : [`kind: ${input.kind}`]),
    ...(input.generator === undefined ? [] : [`generator: ${text(input.generator)}`]),
  ];
  return `${lines.join("\n")}\n`;
}

/** Write a rights record into the folder `rights` of a project. */
export function writeRightsRecord(projectDir: string, input: RightsInput, replace = false): RightsWriteResult {
  if (!NAME.test(input.name)) return { ok: false, reason: `"${input.name}" is not a record name (a-z, 0-9 and -)` };
  for (const key of ["source", "author", "licence"] as const) {
    if (input[key].trim() === "") return { ok: false, reason: `a rights record needs its ${key}` };
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.licenceDate)) return { ok: false, reason: "the licence date is YYYY-MM-DD" };
  const folder = join(projectDir, "rights");
  const file = join(folder, `${input.name}.yaml`);
  if (existsSync(file) && !replace) return { ok: false, reason: `rights/${input.name}.yaml exists already` };
  mkdirSync(folder, { recursive: true });
  writeFileSync(file, rightsYaml(input));
  return { ok: true, path: `rights/${input.name}.yaml`, problems: readRightsFile(file).problems };
}
