// SPDX-License-Identifier: Apache-2.0
/**
 * The page half of the import by drop (the browser path). The lab frame sends the bridge event `import` (the dropped
 * file, its drop point and the answers of the owner). The relay keeps the event in the page and gives it here:
 *
 * 1. The page uploads the bytes to the host: `POST /imports?<fields>` with the token header (importProtocol.ts says
 *    why an HTTP body and not a binary WebSocket frame). The host starts the import job as a run of the Runs tab.
 * 2. The page tells the lab frame the state (`importStatus`) and waits for the end of the run (`runs.done`).
 * 3. It reads `record.json` and `preview.glb` of the import and gives the model to the lab frame (`scratchAdd`).
 *    The optimized model becomes a scratch prop of the checkout at the drop point (a lab input in the URL). It
 *    replaces the quick preview of the drop. The card of the scratch prop shows the record.
 *
 * The desktop path (the shell half): in Scenity, the drag and drop of the shell gives the page the file path of a
 * drop (desktop/shellDrop.ts). The lab frame sends the `import` event without a file, and the page sends the path
 * that it keeps for the drop ID in a JSON body (`POST /imports`, `{ path, point, source, licence, drop }`). The host
 * reads the file where it is; no bytes go through the page.
 */
import {
  IMPORT_PATH,
  importQuery,
  TOKEN_HEADER,
  type BridgeImportEvent,
  type EventPayload,
  type HostEndpoint,
  type ImportFields,
  type ImportStarted,
} from "@scenity/workbench-host/protocol";
import { scratchInfo } from "./scratchModels";

/** The longest wait for an import job (ms). */
export const IMPORT_WAIT_MS = 10 * 60_000;

/** The parts of a record of the job that the page reads (`ImportRecord` of the import job of the host plugin). */
interface RecordView {
  readonly error: string | null;
  readonly result: {
    readonly pass: boolean;
    readonly tiers: Readonly<Record<"high" | "low", { readonly triangles: number; readonly bytes: number }>>;
    readonly warnings: readonly string[];
  } | null;
}

export interface ImportDropDeps {
  endpoint(): HostEndpoint | null;
  /** Listen for the end of runs; returns the stop function. */
  onRunDone(listener: (payload: EventPayload<"runs.done">) => void): () => void;
  /** A call into the visible lab frame. */
  call(call: string, args: readonly unknown[]): Promise<unknown>;
  /**
   * The file path of a drop of the desktop shell, by its drop ID (the page keeps it, desktop/shellDrop.ts), or null.
   * A path goes once: a second event of the same drop gets null.
   */
  readonly pathOf?: (drop: string) => string | null;
  readonly fetch?: typeof fetch;
  readonly waitMs?: number;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** The end of a run, or null after the wait. */
function runEnd(deps: ImportDropDeps, run: string): Promise<EventPayload<"runs.done"> | null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      stop();
      resolve(null);
    }, deps.waitMs ?? IMPORT_WAIT_MS);
    const stop = deps.onRunDone((payload) => {
      if (payload.run !== run) return;
      clearTimeout(timer);
      stop();
      resolve(payload);
    });
  });
}

/** The line of a finished import for the lab. */
export function doneText(name: string, record: RecordView): string {
  if (record.result === null) return `Import of ${name} failed: ${record.error ?? "no result"}`;
  const { high } = record.result.tiers;
  const verdict = record.result.pass ? "in the prop budget" : "OVER the prop budget or with validator errors";
  const warnings = record.result.warnings.length > 0 ? `; ${record.result.warnings.join("; ")}` : "";
  return `Import of ${name}: ${String(high.triangles)} triangles, ${String(Math.round(high.bytes / 1024))} KB, ${verdict}${warnings}`;
}

/** The body and the headers of the start of an import: the bytes of an upload, or the JSON of a desktop path. */
export function importRequest(
  origin: string,
  token: string,
  fields: ImportFields,
  source: { readonly file: Blob } | { readonly path: string },
): { readonly url: string; readonly init: RequestInit } {
  if ("path" in source) {
    return {
      url: `${origin}${IMPORT_PATH}`,
      init: {
        method: "POST",
        headers: { [TOKEN_HEADER]: token, "content-type": "application/json" },
        body: JSON.stringify({
          path: source.path,
          point: fields.point,
          source: fields.source,
          licence: fields.licence,
          drop: fields.drop,
        }),
      },
    };
  }
  return {
    url: `${origin}${IMPORT_PATH}?${importQuery(fields)}`,
    init: {
      method: "POST",
      headers: { [TOKEN_HEADER]: token, "content-type": "application/octet-stream" },
      body: source.file,
    },
  };
}

/** Make the handler of the `import` events of the lab frame. */
export function createImportDrop(deps: ImportDropDeps): (event: BridgeImportEvent) => Promise<void> {
  const get = deps.fetch ?? globalThis.fetch.bind(globalThis);
  const tell = (drop: string, state: string, text: string): Promise<unknown> =>
    deps.call("importStatus", [{ drop, state, text }]).catch(() => undefined);

  return async (event) => {
    const endpoint = deps.endpoint();
    if (endpoint === null) {
      await tell(event.drop, "failed", "The host is not connected.");
      return;
    }
    const headers = { [TOKEN_HEADER]: endpoint.token };
    const fields = {
      name: event.name,
      point: event.point,
      source: event.source,
      licence: event.licence,
      drop: event.drop,
    };
    try {
      let source: { readonly file: Blob } | { readonly path: string };
      if (event.file === null) {
        // A drop of the desktop shell: the page has the path of the drop, the frame has none.
        const path = deps.pathOf?.(event.drop) ?? null;
        if (path === null) throw new Error("the page has no file path of this drop");
        source = { path };
        await tell(event.drop, "upload", `Sending the path of ${event.name} to the host…`);
      } else {
        source = { file: event.file };
        await tell(
          event.drop,
          "upload",
          `Uploading ${event.name} (${String(Math.ceil(event.file.size / 1048576))} MB)…`,
        );
      }
      const request = importRequest(endpoint.origin, endpoint.token, fields, source);
      const answer = await get(request.url, request.init);
      if (!answer.ok) {
        const refusal = (await answer.json().catch(() => ({}))) as { error?: string };
        throw new Error(refusal.error ?? `the host answered ${String(answer.status)}`);
      }
      const started = (await answer.json()) as ImportStarted;
      const ended = runEnd(deps, started.run);
      await tell(event.drop, "running", `Importing ${event.name} on the host (run ${started.run} in the Runs tab)…`);
      const end = await ended;
      if (end === null) throw new Error("the import job did not end in 10 minutes");
      const base = `${endpoint.origin}${IMPORT_PATH}/${started.id}`;
      const recordAnswer = await get(`${base}/record.json`, { headers });
      // A cancelled or crashed job writes no record.
      if (!recordAnswer.ok) throw new Error(`the import job ended with code ${String(end.code)} and no record`);
      const value: unknown = await recordAnswer.json();
      const record = value as RecordView;
      if (record.result !== null) {
        const preview = await get(`${base}/preview.glb`, { headers });
        if (!preview.ok) throw new Error("the import has no preview model");
        // The model becomes a scratch prop at the drop point, in place of the quick preview of the drop.
        const info = { ...scratchInfo(started.id, value), point: started.point, drop: event.drop };
        await deps.call("scratchAdd", [await preview.arrayBuffer(), info]);
      }
      await tell(event.drop, record.result === null ? "failed" : "done", doneText(event.name, record));
    } catch (error) {
      await tell(event.drop, "failed", `Import of ${event.name} failed: ${errorText(error)}`);
    }
  };
}
