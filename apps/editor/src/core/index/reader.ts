// SPDX-License-Identifier: Apache-2.0
/**
 * The reader of the frame index in the lab page. The strip, the hover preview and the overview strip read the index
 * through it.
 *
 * - The lab page alone reads its own store (OPFS or IndexedDB, browserIndex.ts).
 * - The lab page in a frame of the workbench reads the store of the host through the workbench page. It posts
 *   `{ workbenchIndex: 1, id, op, ... }` to the parent. The parent fetches `GET /index/take/…` or `GET /index/<key>`
 *   with its token and posts the answer to the lab page (apps/workbench/src/index/indexReads.ts). The lab page never
 *   holds the token of the host. The bridge call `indexChanged` tells the page that the store changed. The messages of
 *   a read are in `@scenity/bridge` (indexRead.ts).
 */
import {
  indexErrorMessage,
  indexReadMessage,
  isIndexReadAnswer,
  type IndexRead,
  type IndexReadAnswer,
} from "@scenity/bridge";
import { takeKeyOf, type FrameKeyInput } from "@scenity/labs-platform/frameKey";
import { EMPTY_TAKE_INDEX, takeIndexOf, type TakeIndex } from "@scenity/labs-platform/indexRead";
import type { IndexFrame, IndexStore } from "@scenity/labs-platform/indexStore";

export interface IndexReader {
  /** "browser" (the store of the page) or "host" (the store of the workbench host). */
  readonly kind: "browser" | "host";
  /** The frames of a take: of the content hash of the input, and the newest stale ones. */
  takeIndex(input: FrameKeyInput): Promise<TakeIndex>;
  /** The picture of a frame, or null. */
  picture(frame: IndexFrame): Promise<Blob | null>;
  /** Listen for a change of the store. The result is the stop function. */
  onChange(listener: () => void): () => void;
  /** Tell the listeners that the store changed (a put of this page, the bridge call `indexChanged`). */
  changed(): void;
}

function listeners(): Pick<IndexReader, "onChange" | "changed"> {
  const set = new Set<() => void>();
  return {
    onChange(listener) {
      set.add(listener);
      return () => set.delete(listener);
    },
    changed() {
      for (const listener of set) listener();
    },
  };
}

/** The reader of the store of the lab page alone. */
export function browserReader(store: IndexStore): IndexReader {
  return {
    kind: "browser",
    takeIndex: (input) => takeIndexOf(store, input.contentHash, takeKeyOf(input)),
    async picture(frame) {
      const hit = await store.get(frame.key, frame.size);
      return hit === null ? null : new Blob([hit.bytes as Uint8Array<ArrayBuffer>], { type: hit.frame.mime });
    },
    ...listeners(),
  };
}

/** The window parts of the parent reader (a test gives fakes). */
export interface ParentHost {
  readonly parent: { postMessage(message: unknown, targetOrigin: string): void };
  addEventListener(type: "message", listener: (event: MessageEvent) => void): void;
}

/** The time limit of one read through the workbench page (ms). */
const READ_TIMEOUT_MS = 5_000;

/** A read without its ID. */
type ReadBody = IndexRead extends infer Read ? (Read extends unknown ? Omit<Read, "id"> : never) : never;

/** The reader of the store of the workbench host, through the workbench page of `origin`. */
export function parentReader(origin: string, host: ParentHost = globalThis): IndexReader {
  const waiting = new Map<number, (answer: IndexReadAnswer) => void>();
  let next = 1;
  host.addEventListener("message", (event) => {
    if (event.origin !== origin || event.source !== host.parent || !isIndexReadAnswer(event.data)) return;
    waiting.get(event.data.id)?.(event.data);
    waiting.delete(event.data.id);
  });
  function ask(body: ReadBody): Promise<IndexReadAnswer> {
    const id = next++;
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        waiting.delete(id);
        resolve(indexErrorMessage(id, "The workbench page did not answer."));
      }, READ_TIMEOUT_MS);
      waiting.set(id, (answer) => {
        clearTimeout(timer);
        resolve(answer);
      });
      host.parent.postMessage(indexReadMessage({ id, ...body }), origin);
    });
  }
  return {
    kind: "host",
    async takeIndex(input) {
      const answer = await ask({ op: "take", contentHash: input.contentHash, take: takeKeyOf(input) });
      const result = answer.result as TakeIndex | null | undefined;
      return result !== null && result !== undefined && "current" in result ? result : EMPTY_TAKE_INDEX;
    },
    async picture(frame) {
      const answer = await ask({ op: "frame", key: frame.key, size: frame.size });
      const result = answer.result as { mime?: unknown; bytes?: unknown } | null | undefined;
      if (!(result?.bytes instanceof ArrayBuffer)) return null;
      return new Blob([result.bytes], { type: typeof result.mime === "string" ? result.mime : frame.mime });
    },
    ...listeners(),
  };
}
