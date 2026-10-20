// SPDX-License-Identifier: Apache-2.0
/**
 * The facts of the import of a scratch prop and the answer of "Promote to the room": plain data that the workbench
 * page and the host give through the bridge. The lab must not import the host (tools/check-boundaries.ts). Thus these
 * shapes mirror `ScratchInfo` of apps/workbench/src/imports/scratchModels.ts and `PromoteResult` of
 * packages/workbench-host/src/scratchProtocol.ts, and the readers check each field. The rights gap and the reasons of
 * a block are Fluent messages of `src/i18n/en-US/scratch.ftl`.
 */
import { t } from "../../texts";
import { IMPORT_ID } from "./scratchList";

/** What the card of a scratch prop shows of its import record. */
export interface ScratchInfo {
  readonly import: string;
  /** The file name of the drop. */
  readonly name: string;
  /** The answers of the owner at the drop ("" when not given). */
  readonly source: string;
  readonly licence: string;
  /**
   * The answer of the licence register (`register.json` of the rights folder) that the import job wrote: allowed, or
   * the reason that the source or the licence is not allowed. Null for a record of an older import job.
   */
  readonly rights: { readonly allowed: boolean; readonly reason: string | null } | null;
  /** In the prop budget and no validator error; null for a failed import. */
  readonly pass: boolean | null;
  readonly triangles: number | null;
  readonly kb: number | null;
  readonly warnings: readonly string[];
}

/** The state of "Promote to the room" on the card (a project asset and an entity, no Claude prompt). */
export interface PromoteView {
  /** The scratch prop. */
  readonly id: string;
  readonly dry: boolean;
  /** "running" until the answer of the host, then "done" or "refused". */
  readonly status: "running" | "done" | "refused";
  readonly refused: string | null;
  /** The files that the promote writes (a dry run) or wrote. */
  readonly changes: readonly string[];
  /** The new asset ID and the new entity ID, or null (a dry run or a refusal). */
  readonly asset: string | null;
  readonly entity: string | null;
  /** The sentence of the host on the rights record and the release gate ("" for none). */
  readonly rights: string;
  /** The changes that the project still needs (a code change), one line each. */
  readonly followUp: readonly string[];
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** The answer of the licence register in a bridge value, or null. */
function rightsOf(value: unknown): ScratchInfo["rights"] {
  if (typeof value !== "object" || value === null) return null;
  const item = value as Record<string, unknown>;
  if (typeof item.allowed !== "boolean") return null;
  return { allowed: item.allowed, reason: typeof item.reason === "string" && item.reason !== "" ? item.reason : null };
}

/** The facts of an import from a bridge value, or null when it has no import ID. */
export function readInfo(value: unknown): ScratchInfo | null {
  if (typeof value !== "object" || value === null) return null;
  const item = value as Record<string, unknown>;
  const id = text(item.import);
  if (!IMPORT_ID.test(id) || "error" in item) return null;
  return {
    import: id,
    name: text(item.name),
    source: text(item.source).trim(),
    licence: text(item.licence).trim(),
    rights: rightsOf(item.rights),
    pass: typeof item.pass === "boolean" ? item.pass : null,
    triangles: numberOrNull(item.triangles),
    kb: numberOrNull(item.kb),
    warnings: Array.isArray(item.warnings) ? item.warnings.filter((entry) => typeof entry === "string") : [],
  };
}

/**
 * The gap of the rights of an import, or null. Null means that the owner gave a source and a licence, and that the
 * licence register allows them for a prop (the answer of the import job). A gap does not stop the promote. The release
 * gate stops the asset until the owner records its rights.
 */
export function rightsGap(info: ScratchInfo | null): string | null {
  if (info === null) return t("scratch-gap-no-record");
  if (info.source === "" && info.licence === "") return t("scratch-gap-no-answers");
  if (info.source === "") return t("scratch-gap-no-source");
  if (info.licence === "") return t("scratch-gap-no-licence");
  if (info.rights === null) return t("scratch-gap-not-checked");
  if (!info.rights.allowed) return info.rights.reason ?? t("scratch-gap-not-allowed");
  return null;
}

/** The reason that a scratch prop cannot be promoted, or null (the host checks the record again). */
export function promoteBlock(info: ScratchInfo | null): string | null {
  if (info === null) return t("scratch-gap-no-record");
  if (info.pass !== true) return t("scratch-block-budget");
  return null;
}

/** The ID of an object field of a bridge value (`{ id }`), or null. */
function idOf(value: unknown): string | null {
  if (typeof value !== "object" || value === null) return null;
  const id = (value as Record<string, unknown>).id;
  return typeof id === "string" && id !== "" ? id : null;
}

function lines(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((line): line is string => typeof line === "string") : [];
}

/** The answer of the host to a promote (`promoteResult`) for the card. */
export function promoteAnswer(id: string, value: unknown): PromoteView | null {
  if (typeof value !== "object" || value === null) return null;
  const item = value as Record<string, unknown>;
  if (typeof item.dry !== "boolean") return null;
  const refused = typeof item.refused === "string" && item.refused !== "" ? item.refused : null;
  const rights =
    typeof item.rights === "object" && item.rights !== null ? (item.rights as Record<string, unknown>) : {};
  return {
    id,
    dry: item.dry,
    status: refused === null ? "done" : "refused",
    refused,
    changes: lines(item.changes),
    asset: idOf(item.asset),
    entity: idOf(item.entity),
    rights: text(rights.note),
    followUp: lines(item.followUp),
  };
}
