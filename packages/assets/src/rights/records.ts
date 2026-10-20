// SPDX-License-Identifier: Apache-2.0
/**
 * The rights records of the assets. A rights record
 * is `<rights folder>/<name>.yaml`. The asset build checks each record and the licence register of the folder.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { YAML } from "bun";
import { readRegister, REGISTER_FILE, rightsVerdict } from "./licenceRegister";

export interface RightsRecord {
  readonly name: string;
  readonly source: string;
  readonly licence: string;
  /** The SPDX ID of the licence, or null when the record gives none. */
  readonly spdx: string | null;
  /** The attribution text, or null. */
  readonly attribution: string | null;
  readonly allowedUse: readonly string[];
  /** "pending": the question to the seller is open; the build warns, and the release gate fails. */
  readonly webDelivery: boolean | "pending";
  readonly textReview: "done" | "open";
  readonly reviewer: string | null;
}

export type YamlRecord = Readonly<Record<string, unknown>>;

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Read a YAML record. Null for a missing file; an empty record for a file that is not a map. */
export function parseYaml(path: string): YamlRecord | null {
  if (!existsSync(path)) return null;
  const value: unknown = YAML.parse(readFileSync(path, "utf8"));
  return typeof value === "object" && value !== null ? (value as YamlRecord) : {};
}

/** The result of the read of a rights record: a missing file gives a null record. */
export interface RightsReadResult {
  readonly record: RightsRecord | null;
  readonly problems: string[];
}

/** Read a rights record `<folder>/<name>.yaml`. Returns the record and its problems. */
export function readRights(name: string, folder: string): RightsReadResult {
  const json = parseYaml(join(folder, `${name}.yaml`));
  if (json === null) return { record: null, problems: [`rights record ${name}: no file rights/${name}.yaml`] };
  return rightsOf(name, json);
}

/**
 * Read a rights record at a path (an asset record names its rights record by a path). The name of the record
 * is the file name with no `.yaml`.
 */
export function readRightsFile(path: string): RightsReadResult {
  const name = basename(path).replace(/\.ya?ml$/u, "");
  const json = parseYaml(path);
  if (json === null) return { record: null, problems: [`rights record ${name}: no file ${path}`] };
  return rightsOf(name, json);
}

function rightsOf(name: string, json: YamlRecord): RightsReadResult {
  const problems: string[] = [];
  const where = `rights record ${name}`;
  if (json.name !== name) problems.push(`${where}: name must be ${name}`);
  for (const key of ["source", "author", "licence"]) {
    if (typeof json[key] !== "string" || json[key].includes("<")) problems.push(`${where}: no ${key}`);
  }
  const date = json.licenceDate instanceof Date ? json.licenceDate.toISOString().slice(0, 10) : json.licenceDate;
  if (typeof date !== "string" || !DATE.test(date)) problems.push(`${where}: licenceDate must be YYYY-MM-DD`);
  const allowedUse = Array.isArray(json.allowedUse) ? json.allowedUse.filter((x) => typeof x === "string") : [];
  if (!allowedUse.includes("web")) problems.push(`${where}: allowedUse does not include web`);
  if (json.webDelivery !== true && json.webDelivery !== "pending") {
    problems.push(`${where}: the licence does not allow web delivery`);
  }
  const textReview = json.textReview === "done" ? "done" : "open";
  const reviewer = typeof json.reviewer === "string" && json.reviewer.length > 0 ? json.reviewer : null;
  const webDelivery = json.webDelivery === "pending" ? "pending" : json.webDelivery === true;
  const text = (key: string): string => (typeof json[key] === "string" ? json[key] : "");
  const attribution = text("attribution") === "" ? null : text("attribution");
  return {
    record: {
      name,
      source: text("source"),
      licence: text("licence"),
      spdx: text("spdx") === "" ? null : text("spdx"),
      attribution,
      allowedUse,
      webDelivery,
      textReview,
      reviewer,
    },
    problems,
  };
}

/** A finding of the register check: an error, or a warning that the release gate makes an error. */
export interface RegisterFinding {
  readonly level: "error" | "release";
  readonly record: string;
  readonly message: string;
}

/** The names of the rights records in a folder (every `<name>.yaml` but the template). */
export function rightsRecordNames(folder: string): string[] {
  if (!existsSync(folder)) return [];
  return readdirSync(folder)
    .filter((file) => file.endsWith(".yaml") && file !== "TEMPLATE.yaml")
    .map((file) => file.slice(0, -".yaml".length))
    .sort();
}

/**
 * The licence register check: every rights record of the folder names a source and
 * a licence of an allowed entry of the register, for each asset kind that uses the record (`kindsOf`).
 */
export function registerFindings(
  kindsOf: (record: string) => readonly string[],
  folder: string,
  registerPath = join(folder, REGISTER_FILE),
): RegisterFinding[] {
  const findings: RegisterFinding[] = [];
  const { register, problems } = readRegister(registerPath);
  for (const problem of problems) findings.push({ level: "error", record: "register", message: problem });
  for (const name of rightsRecordNames(folder)) {
    const { record } = readRights(name, folder);
    if (record === null) continue;
    const kinds = kindsOf(name);
    for (const kind of kinds.length === 0 ? [null] : kinds) {
      const verdict = rightsVerdict(register, { source: record.source, licence: record.licence, kind });
      const where = `rights record ${name}`;
      if (!verdict.allowed) {
        findings.push({ level: "error", record: name, message: `${where}: ${verdict.reason ?? "not allowed"}` });
        continue;
      }
      if (verdict.attribution && record.attribution === null) {
        findings.push({ level: "error", record: name, message: `${where}: the licence asks for the attribution text` });
      }
      if (verdict.open !== null) {
        findings.push({
          level: "release",
          record: name,
          message: `${where}: ${verdict.entry ?? ""} is open: ${verdict.open}`,
        });
      }
    }
  }
  return [...new Map(findings.map((item) => [`${item.record}\n${item.message}`, item])).values()];
}

/** One rights record of a project for a choice: its path, its name, its licence and its source. */
export interface RightsSummary {
  readonly path: string;
  readonly name: string;
  readonly licence: string;
  readonly spdx: string | null;
  readonly source: string;
  /** The problems of the record that the release gate sees (a missing field, no web use). */
  readonly problems: readonly string[];
}

/** The rights records of the folder `rights` of a project, by name (a record that does not read is left out). */
export function rightsSummaries(projectDir: string): RightsSummary[] {
  const folder = join(projectDir, "rights");
  return rightsRecordNames(folder).flatMap((name): RightsSummary[] => {
    const { record, problems } = readRightsFile(join(folder, `${name}.yaml`));
    if (record === null) return [];
    const { licence, spdx, source } = record;
    return [{ path: `rights/${name}.yaml`, name, licence, spdx, source, problems }];
  });
}
