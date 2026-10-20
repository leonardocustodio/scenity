// SPDX-License-Identifier: Apache-2.0
/**
 * The approvals of a project on a dev server, a Vite plugin:
 *
 * - `GET /projects/<name>/assets.approvals.json`: the approval roles of the project (`release.approvals`) and, for each
 *   asset, the state of each role that applies to it (missing, refused, stale after a source change, current).
 * - `POST .../assets.approval.write`: a review (`ApprovalInput`). The server writes `approvals/<ID>-<role>.json`
 *   (`scenity.approval/1` with the current source hash) and adds its path to the asset record. The review of a role
 *   replaces the last review of that role for that asset.
 * - `POST .../assets.approval.role`: a new approval role of the project (`{ role, label }`).
 *
 * The writes need the import header and the same origin, as the import does. Put the plugin before `scenityProjects`.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { dirname, join, posix, relative } from "node:path";
import type { Plugin } from "vite";
import type * as AssetsIndex from "@scenity/assets";
import type * as ReleaseIndex from "@scenity/assets/release";
import { canonicalJson } from "@scenity/scene";
import {
  ASSET_APPROVAL_ROLE_PATH,
  ASSET_APPROVAL_WRITE_PATH,
  ASSET_APPROVALS_PATH,
  type ApprovalAsset,
  type ApprovalCell,
  type ApprovalInput,
  type ApprovalQueue,
} from "../src/assetBrowser/assetTypes.ts";
import { sameOriginImport } from "./assetApiServer.ts";
import { assetsModule } from "./assetsModule.ts";
import { isRemote } from "./labsFs.ts";
import { readJson, sendJson } from "./serverParts.ts";

type Result = { readonly ok: true } | { readonly ok: false; readonly reason: string };
type Json = Record<string, unknown>;

/** The folder of the approval records, relative to the project folder. */
export const APPROVALS_FOLDER = "approvals";
const ROLE = /^[A-Za-z0-9_.-]{1,64}$/;

/** The name of a source file with no folder and no extension. */
function nameOf(sourcePath: string): string {
  const file = sourcePath.slice(sourcePath.lastIndexOf("/") + 1);
  return file.includes(".") ? file.slice(0, file.lastIndexOf(".")) : file;
}

/** The review queue of the project folder `dir`. */
export async function approvalQueue(dir: string): Promise<ApprovalQueue> {
  const { AssetDatabase } = await assetsModule<typeof AssetsIndex>("");
  const release = await assetsModule<typeof ReleaseIndex>("release");
  const db = await AssetDatabase.open(dir);
  const rules = db.project.release?.approvals ?? [];
  const assets: ApprovalAsset[] = [];
  for (const entry of db.entries()) {
    const approvals: ReleaseIndex.Approval[] = [];
    for (const path of entry.record.approvals ?? []) {
      const { record } = await release.readApprovalFile(join(dir, dirname(entry.recordPath), path));
      if (record !== null) approvals.push(record);
    }
    const subject = { id: entry.id, kind: entry.kind, tags: entry.tags, hash: entry.hash, approvals };
    const roles: Record<string, ApprovalCell> = {};
    for (const rule of rules.filter((item) => release.ruleApplies(item, subject))) {
      const last = release.latestApproval(approvals, rule.role);
      roles[rule.role] = {
        state: release.approvalState(subject, rule.role),
        verdict: last?.verdict ?? null,
        reviewer: last?.reviewer ?? null,
        date: last?.date ?? null,
        note: last?.note ?? null,
      };
    }
    assets.push({ id: entry.id, name: nameOf(entry.sourcePath), kind: entry.kind, roles });
  }
  return {
    roles: rules.map((rule) => ({ role: rule.role, label: rule.label ?? null, required: rule.required !== false })),
    assets,
  };
}

/** Write a review: the approval record of the asset and the role, and its path in the asset record. */
export async function writeApproval(dir: string, input: ApprovalInput, today = new Date()): Promise<Result> {
  const { AssetDatabase, readAssetRecord, writeAssetRecord } = await assetsModule<typeof AssetsIndex>("");
  const { writeApprovalRecord, APPROVAL_FORMAT } = await assetsModule<typeof ReleaseIndex>("release");
  const db = await AssetDatabase.open(dir);
  const entry = db.get(input.id);
  if (entry === undefined) return { ok: false, reason: `no asset ${input.id}` };
  if (!(db.project.release?.approvals ?? []).some((rule) => rule.role === input.role)) {
    return { ok: false, reason: `the project has no approval role ${input.role}` };
  }
  if (entry.hash === null) return { ok: false, reason: "the asset has no source to review" };
  const file = join(dir, APPROVALS_FOLDER, `${input.id}-${input.role}.json`);
  const note = input.note?.trim() ?? "";
  try {
    const text = writeApprovalRecord({
      format: APPROVAL_FORMAT,
      asset: input.id,
      role: input.role,
      reviewer: input.reviewer.trim(),
      date: today.toISOString().slice(0, 10),
      verdict: input.verdict,
      sourceHash: entry.hash,
      ...(note === "" ? {} : { note }),
    });
    const recordPath = join(dir, entry.recordPath);
    const read = readAssetRecord(readFileSync(recordPath, "utf8"));
    if (!read.ok) return { ok: false, reason: read.errors.map((error) => error.message).join("; ") };
    const link = relative(dirname(recordPath), file).split("\\").join(posix.sep);
    const approvals = [...new Set([...(read.record.approvals ?? []), link])];
    const recordText = writeAssetRecord({ ...read.record, approvals });
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, text);
    writeFileSync(recordPath, recordText);
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : String(error) };
  }
  return { ok: true };
}

/** Add an approval role to the project file (`release.approvals`). */
export function addApprovalRole(dir: string, role: unknown, label: unknown): Result {
  if (typeof role !== "string" || !ROLE.test(role))
    return { ok: false, reason: "a role has 1 to 64 letters, digits, '_', '.' or '-'" };
  const path = join(dir, "scenity.project.json");
  if (!existsSync(path)) return { ok: false, reason: "no project file" };
  const project = JSON.parse(readFileSync(path, "utf8")) as Json;
  const release = (typeof project.release === "object" && project.release !== null ? project.release : {}) as Json;
  const rules = Array.isArray(release.approvals) ? (release.approvals as Json[]) : [];
  if (rules.some((rule) => rule.role === role))
    return { ok: false, reason: `the project has the role ${role} already` };
  const text = typeof label === "string" && label.trim() !== "" ? label.trim() : undefined;
  project.release = { ...release, approvals: [...rules, { role, ...(text === undefined ? {} : { label: text }) }] };
  writeFileSync(path, canonicalJson(project));
  return { ok: true };
}

/** Answer a write: a review or a new role (a page of this server only). */
async function handleWrite(
  request: IncomingMessage,
  response: ServerResponse,
  dir: string,
  what: string,
): Promise<void> {
  if (isRemote(process.env) || !sameOriginImport(request)) {
    sendJson(response, 403, { ok: false, reason: "A review comes only from a page of this server." });
    return;
  }
  try {
    const input = (await readJson(request)) as Json;
    const result =
      what === ASSET_APPROVAL_ROLE_PATH
        ? addApprovalRole(dir, input.role, input.label)
        : await writeApproval(dir, input as unknown as ApprovalInput);
    sendJson(response, result.ok ? 200 : 400, result);
  } catch (error) {
    sendJson(response, 400, { ok: false, reason: error instanceof Error ? error.message : String(error) });
  }
}

/** The plugin. `projects` maps a project name to its folder (absolute), as for `scenityProjects`. */
export function scenityApprovalsApi(projects: Readonly<Record<string, string>>): Plugin {
  return {
    name: "scenity-approvals-api",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const match = /^\/projects\/([a-z0-9-]+)\/(.+)$/.exec((request.url ?? "").split("?")[0] ?? "");
        const dir = match?.[1] === undefined ? undefined : projects[match[1]];
        const what = match?.[2] ?? "";
        if (dir !== undefined && what === ASSET_APPROVALS_PATH && request.method === "GET") {
          void approvalQueue(dir).then(
            (queue) => sendJson(response, 200, queue),
            (error: unknown) => sendJson(response, 500, { reason: String(error) }),
          );
        } else if (
          dir !== undefined &&
          (what === ASSET_APPROVAL_WRITE_PATH || what === ASSET_APPROVAL_ROLE_PATH) &&
          request.method === "POST"
        ) {
          void handleWrite(request, response, dir, what);
        } else next();
      });
    },
  };
}
