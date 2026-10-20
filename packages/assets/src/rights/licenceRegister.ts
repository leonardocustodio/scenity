// SPDX-License-Identifier: Apache-2.0
/**
 * The licence register of a project: `register.json` in the rights folder of the project. The asset build checks that
 * every rights record names a source and a licence of an allowed entry (records.ts, check.ts). The import of a dropped
 * file and "Promote to the room" use the same rule (the import job of a host plugin,
 * packages/workbench-host/src/promote.ts).
 *
 * The rule of `rightsVerdict`:
 * 1. A source that matches an entry that is not "allowed" (rejected, check, spike) is refused, also when it matches an
 *    allowed entry too.
 * 2. A source that matches no entry is refused.
 * 3. The licence must match a licence of an allowed entry of the source.
 * 4. An entry with `kinds` allows only those asset kinds.
 *
 * This module reads only the file that the caller names. The workbench host gives the register of its checkout.
 */
import { existsSync, readFileSync } from "node:fs";

/** The status of a register entry. Only "allowed" passes. */
export type RegisterStatus = "allowed" | "rejected" | "check" | "spike";

const STATUSES: readonly RegisterStatus[] = ["allowed", "rejected", "check", "spike"];

export interface RegisterEntry {
  readonly id: string;
  readonly name: string;
  readonly status: RegisterStatus;
  /** The licence as the register or the records name it. */
  readonly licence: string;
  readonly sourceMatch: readonly RegExp[];
  readonly licenceMatch: readonly RegExp[];
  /** The asset kinds that the entry allows, or null for all kinds. */
  readonly kinds: readonly string[] | null;
  /** True when the rights record must give the attribution text. */
  readonly attribution: boolean;
  /** The facts that a release still needs (the release gate refuses the entry until then), or null. */
  readonly open: string | null;
  /** How a record or an import answer names the source and the licence, or null. */
  readonly form: string | null;
  readonly reason: string;
  /** "assets", "data", "model", "service", "tool" or "code". */
  readonly what: string;
}

export interface LicenceRegister {
  readonly entries: readonly RegisterEntry[];
}

/** The answer of the register for one source and licence. */
export interface RightsVerdict {
  readonly allowed: boolean;
  /** The ID of the entry that decided, or null when no entry matches. */
  readonly entry: string | null;
  /** Why the source or the licence is not allowed, or null. */
  readonly reason: string | null;
  /** The `open` text of an allowed entry, or null. */
  readonly open: string | null;
  /** True when the entry asks for the attribution text in the rights record. */
  readonly attribution: boolean;
}

/** The answers of a rights record or of an import. */
export interface RightsAnswer {
  readonly source: string;
  readonly licence: string;
  /** The asset kind of the project (for example "prop", "character", "clip", "room"), or null when not known. */
  readonly kind?: string | null;
}

/** The name of the register file in the rights folder. */
export const REGISTER_FILE = "register.json";

type Json = Readonly<Record<string, unknown>>;

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function patterns(value: unknown, where: string, problems: string[]): RegExp[] {
  const result: RegExp[] = [];
  for (const text of strings(value)) {
    try {
      result.push(new RegExp(text, "iu"));
    } catch {
      problems.push(`${where}: the pattern ${text} is not a regular expression`);
    }
  }
  return result;
}

function entryOf(value: unknown, index: number, problems: string[]): RegisterEntry | null {
  if (typeof value !== "object" || value === null) {
    problems.push(`licence register: entry ${String(index)} is not an object`);
    return null;
  }
  const item = value as Json;
  const id = typeof item.id === "string" && item.id !== "" ? item.id : `#${String(index)}`;
  const where = `licence register: entry ${id}`;
  const status = item.status as RegisterStatus;
  if (!STATUSES.includes(status)) problems.push(`${where}: status must be ${STATUSES.join(", ")}`);
  for (const key of ["name", "licence", "reason"]) {
    if (typeof item[key] !== "string" || item[key] === "") problems.push(`${where}: no ${key}`);
  }
  const sourceMatch = patterns(item.sourceMatch, where, problems);
  const licenceMatch = patterns(item.licenceMatch, where, problems);
  if (sourceMatch.length === 0) problems.push(`${where}: no sourceMatch`);
  if (status === "allowed" && licenceMatch.length === 0) problems.push(`${where}: an allowed entry needs licenceMatch`);
  const kinds = item.kinds === undefined || item.kinds === null ? null : strings(item.kinds);
  const text = (key: string): string | null => (typeof item[key] === "string" ? item[key] : null);
  return {
    id,
    name: text("name") ?? id,
    status: STATUSES.includes(status) ? status : "check",
    licence: text("licence") ?? "",
    sourceMatch,
    licenceMatch,
    kinds,
    attribution: item.attribution === true,
    open: text("open"),
    form: text("form"),
    reason: text("reason") ?? "",
    what: text("what") ?? "assets",
  };
}

/** Parse the register. Returns the entries and the problems of the file. */
export function parseRegister(value: unknown): { register: LicenceRegister; problems: string[] } {
  const problems: string[] = [];
  const json = typeof value === "object" && value !== null ? (value as Json) : {};
  if (json.version !== 1) problems.push("licence register: version must be 1");
  if (!Array.isArray(json.entries)) problems.push("licence register: no entries");
  const raw: unknown[] = Array.isArray(json.entries) ? json.entries : [];
  const entries = raw.map((item, index) => entryOf(item, index, problems)).filter((item) => item !== null);
  const ids = entries.map((entry) => entry.id);
  for (const id of new Set(ids)) {
    if (ids.filter((other) => other === id).length > 1) problems.push(`licence register: the ID ${id} is not unique`);
  }
  return { register: { entries }, problems };
}

/** Read the register file. A missing or broken file gives no entries and a problem, so every source fails. */
export function readRegister(path: string): { register: LicenceRegister; problems: string[] } {
  if (!existsSync(path)) return { register: { entries: [] }, problems: [`licence register: no file ${path}`] };
  try {
    return parseRegister(JSON.parse(readFileSync(path, "utf8")));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { register: { entries: [] }, problems: [`licence register: ${path} is not JSON (${message})`] };
  }
}

/** The names of the allowed entries for assets, data and services (not the code libraries and tools). */
export function allowedSources(register: LicenceRegister): string[] {
  return register.entries
    .filter((entry) => entry.status === "allowed" && entry.what !== "code" && entry.what !== "tool")
    .map((entry) => entry.name);
}

function refuse(entry: string | null, reason: string): RightsVerdict {
  return { allowed: false, entry, reason, open: null, attribution: false };
}

/** The answer of the register for a source and a licence (the rule is in the header of this module). */
export function rightsVerdict(register: LicenceRegister, answer: RightsAnswer): RightsVerdict {
  const source = answer.source.trim();
  const licence = answer.licence.trim();
  if (source === "") return refuse(null, "no source");
  if (licence === "") return refuse(null, "no licence");
  const matches = register.entries.filter((entry) => entry.sourceMatch.some((pattern) => pattern.test(source)));
  const barred = matches.find((entry) => entry.status !== "allowed");
  if (barred !== undefined) {
    return refuse(barred.id, `the licence register marks ${barred.name} as ${barred.status}: ${barred.reason}`);
  }
  if (matches.length === 0) {
    return refuse(
      null,
      `the source "${source}" is not in the licence register (allowed: ${allowedSources(register).join("; ")})`,
    );
  }
  const entry = matches.find((item) => item.licenceMatch.some((pattern) => pattern.test(licence)));
  if (entry === undefined) {
    const forms = matches.map((item) => `${item.name}: ${item.form ?? item.licence}`).join("; ");
    return refuse(matches[0]?.id ?? null, `the licence "${licence}" is not allowed for this source (${forms})`);
  }
  const kind = answer.kind ?? null;
  if (entry.kinds !== null && kind !== null && !entry.kinds.includes(kind)) {
    return refuse(entry.id, `${entry.name} is allowed only for ${entry.kinds.join(", ")}, not for a ${kind}`);
  }
  return { allowed: true, entry: entry.id, reason: null, open: entry.open, attribution: entry.attribution };
}
