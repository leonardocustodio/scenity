// SPDX-License-Identifier: Apache-2.0
/**
 * The models of the scratch props for the lab frames. A scratch prop is a lab input (`scratch=<import>@x,y,z,turn` in
 * the lab URL), and its model is the `preview.glb` of an import of the host. A frame that opens with scratch props (a
 * reload, the shadow frame, the indexer window) sends the bridge event `scratch` with the imports that it needs. The
 * page reads `record.json` and `preview.glb` of each import with the token. Then it gives them to that frame (the
 * bridge call `scratchModel`). A missing import gives the frame an error, so the frame stops its wait.
 */
import {
  IMPORT_PATH,
  TOKEN_HEADER,
  type BridgeScratchEvent,
  type HostEndpoint,
} from "@scenity/workbench-host/protocol";

/** What the card of a scratch prop shows of its import record (the rights and the budget). */
export interface ScratchInfo {
  readonly import: string;
  readonly name: string;
  readonly source: string;
  readonly licence: string;
  /** The answer of the licence register of the import job, or null for a record of an older job. */
  readonly rights: { readonly allowed: boolean; readonly reason: string | null } | null;
  /** In the prop budget and no validator error; null for a failed import. */
  readonly pass: boolean | null;
  readonly triangles: number | null;
  readonly kb: number | null;
  readonly warnings: readonly string[];
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

function textOf(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function numberOf(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** The facts of an import record for the card (`ImportRecord` of the import job of the host plugin). */
export function scratchInfo(id: string, value: unknown): ScratchInfo {
  const item = record(value);
  const result = item.result === null || item.result === undefined ? null : record(item.result);
  const high = record(record(result?.tiers).high);
  const bytes = numberOf(high.bytes);
  const warnings = Array.isArray(result?.warnings) ? result.warnings.filter((entry) => typeof entry === "string") : [];
  const rights = item.rights === undefined || item.rights === null ? null : record(item.rights);
  return {
    import: id,
    name: textOf(item.name),
    source: textOf(item.source),
    licence: textOf(item.licence),
    rights:
      rights === null || typeof rights.allowed !== "boolean"
        ? null
        : { allowed: rights.allowed, reason: textOf(rights.reason) === "" ? null : textOf(rights.reason) },
    pass: result === null ? null : result.pass === true,
    triangles: numberOf(high.triangles),
    kb: bytes === null ? null : Math.round(bytes / 1024),
    warnings,
  };
}

export interface ScratchModelDeps {
  endpoint(): HostEndpoint | null;
  /** A call into the frame that sent the event. */
  call(call: string, args: readonly unknown[]): Promise<unknown>;
  readonly fetch?: typeof fetch;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** The record and the model bytes of an import, from the host. */
export async function readImport(
  endpoint: HostEndpoint,
  id: string,
  get: typeof fetch,
): Promise<{ readonly info: ScratchInfo; readonly bytes: ArrayBuffer }> {
  const headers = { [TOKEN_HEADER]: endpoint.token };
  const base = `${endpoint.origin}${IMPORT_PATH}/${id}`;
  const recordAnswer = await get(`${base}/record.json`, { headers });
  if (!recordAnswer.ok) throw new Error(`the import ${id} has no record (${String(recordAnswer.status)})`);
  const info = scratchInfo(id, await recordAnswer.json());
  const model = await get(`${base}/preview.glb`, { headers });
  if (!model.ok) throw new Error(`the import ${id} has no model (${String(model.status)})`);
  return { info, bytes: await model.arrayBuffer() };
}

/** Make the handler of the `scratch` events of one frame: each needed model goes to that frame. */
export function createScratchModels(deps: ScratchModelDeps): (event: BridgeScratchEvent) => Promise<void> {
  const get = deps.fetch ?? globalThis.fetch.bind(globalThis);
  return async (event) => {
    const endpoint = deps.endpoint();
    for (const id of event.need) {
      try {
        if (endpoint === null) throw new Error("the host is not connected");
        const { info, bytes } = await readImport(endpoint, id, get);
        await deps.call("scratchModel", [bytes, info]);
      } catch (error) {
        await deps.call("scratchModel", [null, { import: id, error: errorText(error) }]).catch(() => undefined);
      }
    }
  };
}
