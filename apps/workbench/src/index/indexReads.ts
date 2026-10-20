// SPDX-License-Identifier: Apache-2.0
/**
 * The index reads of the lab frames. The strip, the hover preview and the overview strip of a lab frame read the store
 * of the host through this page. Thus the lab page never holds the token of the host. A frame posts
 * `{ workbenchIndex: 1, id, op: "take", contentHash, take }` or `{ …, op: "frame", key, size }`. The page fetches
 * `GET /index/take/<hash>/<take>` or `GET /index/<key>?size=` with its token. Then it posts
 * `{ workbenchIndex: 1, id, result }` back (the picture bytes move, no copy).
 *
 * Only a lab frame that the relay knows (the same window and origin) gets an answer. This module has no framework.
 */
import { INDEX_CAPABILITY, INDEX_PATH, INDEX_TAKE_PATH, TOKEN_HEADER } from "@scenity/workbench-host/protocol";
import type { HostEndpoint } from "@scenity/workbench-host/protocol";
import type { FrameMessage, SurfaceRelay } from "../surfaces/relay";
import { indexErrorMessage, indexResultMessage, readIndexRead, type IndexRead } from "@scenity/bridge";

/** A read of a lab frame, or null for another message (the contract of `@scenity/bridge`). */
export const readOf = readIndexRead;

/** The URL of a read on the host. */
export function readUrl(origin: string, read: IndexRead): string {
  return read.op === "take"
    ? `${origin}${INDEX_TAKE_PATH}${read.contentHash}/${read.take}`
    : `${origin}${INDEX_PATH}${read.key}?size=${String(read.size)}`;
}

/** The answer of a read: the take index, the picture bytes, or null on a miss. */
export async function answerRead(
  endpoint: HostEndpoint,
  read: IndexRead,
  get: typeof fetch = fetch,
): Promise<{ result: unknown; transfer: ArrayBuffer[] }> {
  const response = await get(readUrl(endpoint.origin, read), { headers: { [TOKEN_HEADER]: endpoint.token } });
  if (!response.ok) return { result: null, transfer: [] };
  if (read.op === "take") return { result: (await response.json()) as unknown, transfer: [] };
  const bytes = await response.arrayBuffer();
  return { result: { mime: response.headers.get("content-type") ?? "image/webp", bytes }, transfer: [bytes] };
}

/** The window parts of the reads (a test gives a fake). */
export interface ReadsWindow {
  addEventListener(type: "message", listener: (event: MessageEvent) => void): void;
  removeEventListener(type: "message", listener: (event: MessageEvent) => void): void;
}

/** Answer the index reads of the lab frames. Gives the stop function. */
export function startIndexReads(
  relay: SurfaceRelay,
  endpoint: () => HostEndpoint | null,
  win: ReadsWindow = globalThis,
  get: typeof fetch = fetch,
): () => void {
  const onMessage = (event: MessageEvent): void => {
    const read = readOf(event.data);
    if (read === null) return;
    const frame = relay.frameOf(event satisfies FrameMessage);
    const host = endpoint();
    // The frames of the index surface read the index.
    if (frame?.surface !== relay.idWith(INDEX_CAPABILITY) || host === null) return;
    const target: { postMessage(message: unknown, origin: string, transfer?: Transferable[]): void } =
      frame.target.window;
    answerRead(host, read, get)
      .then(
        ({ result, transfer }) =>
          target.postMessage(indexResultMessage(read.id, result), frame.target.origin, transfer),
        (error: unknown) => target.postMessage(indexErrorMessage(read.id, error), frame.target.origin),
      )
      .catch(() => null);
  };
  win.addEventListener("message", onMessage);
  return () => {
    win.removeEventListener("message", onMessage);
  };
}
