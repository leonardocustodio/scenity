// SPDX-License-Identifier: Apache-2.0
/**
 * The approval record `scenity.approval/1`. An asset record lists its approval records in
 * `approvals`. Each approval record holds one verdict of one reviewer for one role of the project. The record keeps
 * the source hash of the asset at the time of the review, so a later change of the asset makes the approval stale.
 *
 * A record file is JSON or YAML (the reader parses YAML, and JSON is a part of YAML). The writer gives the canonical
 * JSON of `@scenity/scene`.
 */
import { YAML } from "bun";
import { canonicalJson, isObject, zodErrors } from "@scenity/scene";
import { z } from "zod";
import { assetIdSchema } from "../record";

export const APPROVAL_FORMAT = "scenity.approval/1";
/** The verdicts of a review. Only `approved` passes the release gate. */
export const APPROVAL_VERDICTS = ["approved", "changes", "rejected"] as const;
export type ApprovalVerdict = (typeof APPROVAL_VERDICTS)[number];

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export const approvalRecordSchema = z.strictObject({
  format: z.literal(APPROVAL_FORMAT),
  /** The ID of the asset that the reviewer saw. */
  asset: assetIdSchema,
  /** A role of the project (`release.approvals` of the project document). */
  role: z.string().regex(/^[A-Za-z0-9_.-]{1,64}$/, "a role has 1 to 64 letters, digits, '_', '.' or '-'"),
  reviewer: z.string().min(1).max(200),
  /** The date of the review (YYYY-MM-DD). */
  date: z.string().regex(DATE_RE, "a date is YYYY-MM-DD"),
  verdict: z.enum(APPROVAL_VERDICTS),
  /** The source hash of the asset (the `hash` of its index entry) at the time of the review. */
  sourceHash: z.string().regex(/^[0-9a-f]{64}$/, "a SHA-256 in lower-case hex"),
  note: z.string().min(1).max(4000).optional(),
});

export type ApprovalRecord = z.infer<typeof approvalRecordSchema>;

/**
 * One approval in the release gate. A plugin that keeps its reviews in another form gives this shape (the date can be
 * null), so the gate reads no file.
 */
export interface Approval {
  readonly asset: string;
  readonly role: string;
  readonly reviewer: string;
  readonly date: string | null;
  readonly verdict: ApprovalVerdict;
  readonly sourceHash: string | null;
  readonly note?: string | undefined;
}

export interface ApprovalReadResult {
  readonly record: ApprovalRecord | null;
  readonly problems: readonly string[];
}

/** Read an approval record from its text. A YAML date becomes YYYY-MM-DD text. */
export function readApprovalText(text: string, where = "approval record"): ApprovalReadResult {
  let raw: unknown;
  try {
    raw = YAML.parse(text);
  } catch (error) {
    return { record: null, problems: [`${where}: the file is not YAML or JSON (${messageOf(error)})`] };
  }
  if (!isObject(raw)) return { record: null, problems: [`${where}: an approval record is an object`] };
  const value = raw.date instanceof Date ? { ...raw, date: raw.date.toISOString().slice(0, 10) } : raw;
  const parsed = approvalRecordSchema.safeParse(value);
  if (parsed.success) return { record: parsed.data, problems: [] };
  return {
    record: null,
    problems: zodErrors(parsed.error).map((error) => `${where}: ${error.path || "/"}: ${error.message}`),
  };
}

/** Read an approval record file. A missing file gives a problem. */
export async function readApprovalFile(path: string, where = path): Promise<ApprovalReadResult> {
  const file = Bun.file(path);
  if (!(await file.exists())) return { record: null, problems: [`approval record ${where}: no file`] };
  return readApprovalText(await file.text(), `approval record ${where}`);
}

/** The canonical text of an approval record. The function checks the record first and throws on a bad record. */
export function writeApprovalRecord(record: ApprovalRecord): string {
  const parsed = approvalRecordSchema.safeParse(record);
  if (!parsed.success) {
    const errors = zodErrors(parsed.error).map((error) => `${error.path || "/"}: ${error.message}`);
    throw new Error(`not an approval record: ${errors.join("; ")}`);
  }
  return canonicalJson(parsed.data);
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
