// SPDX-License-Identifier: Apache-2.0
/**
 * The parts of the indexer page: the host client, the relay of its one lab frame, the load of the frame and the wait
 * for its scene, the shell state and the wait for work. The frame is the place `indexer` of the index surface. The
 * host gets its bridge events as from any surface frame, and can send it calls. IndexerApp.vue mounts the parts. The
 * loop is indexerLoop.ts. The index surface is the first surface with the capability `index` (`indexSurfaceOf`).
 */
import { INDEX_CAPABILITY, surfaceWith } from "@scenity/workbench-host/protocol";
import type { HostEndpoint, IndexProgress, SurfaceState } from "@scenity/workbench-host/protocol";
import { invokeShell } from "../desktop/shell";
import { HostClient } from "../host/hostClient";
import { createScratchModels } from "../imports/scratchModels";
import { createRelay, type SurfaceRelay } from "../surfaces/relay";
import type { IndexerParts } from "./indexerLoop";
import type { ShellState } from "./pacer";

/** The place of the frame in its surface. */
export const WHERE = "indexer";
/** The longest wait for the bridge and the scene of a new frame (ms). */
const LOAD_TIMEOUT_MS = 90_000;
/** The asset states of a settled scene (Room3DStats.assets). */
const SETTLED = new Set(["ready", "none", "failed"]);

/** The page parts that the indexer parts use. */
export interface IndexerPage {
  readonly client: HostClient;
  readonly relay: SurfaceRelay;
  /** Show the frame at a URL (null: no frame). */
  readonly setSrc: (url: string | null) => void;
  readonly dispose: () => void;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** The shell state; a page outside the app (a test) runs as on AC power without reports. */
async function shellState(working: boolean): Promise<ShellState> {
  const value = (await invokeShell("indexer_state", { working }).catch(() => null)) as Partial<ShellState> | null;
  if (value === null || typeof value.run !== "boolean") return { run: true, reason: null, main: null, report: 0 };
  return { run: value.run, reason: value.reason ?? null, main: value.main ?? null, report: value.report ?? 0 };
}

/** Make the host client and the relay of the indexer page. `onReady` gets each `ready` event of the frame. */
export function connectIndexer(endpoint: HostEndpoint, onReady: () => void): Omit<IndexerPage, "setSrc"> {
  const client = new HostClient({ endpoint, pageOrigin: globalThis.location.origin });
  const relay = createRelay({
    answer: (params, picture) => {
      let answer = params;
      if (picture !== undefined) {
        try {
          client.sendPicture(params.request, picture.mime, picture.bytes);
        } catch (error) {
          answer = { request: params.request, error: error instanceof Error ? error.message : String(error) };
        }
      }
      client.request("surface.call", answer).catch(() => undefined);
    },
    report: (params) => {
      if (params.where === WHERE && params.event.event === "ready") onReady();
      client.request("surface.report", params).catch(() => undefined);
    },
    // A job with scratch props loads a frame that needs their models from the host.
    onScratch: (surface, where, event) => {
      const call = (name: string, args: readonly unknown[]): Promise<unknown> => relay.call(surface, where, name, args);
      void createScratchModels({ endpoint: () => endpoint, call })(event);
    },
  });
  const onMessage = (event: MessageEvent): void => {
    relay.receive(event);
  };
  globalThis.addEventListener("message", onMessage);
  const stopRequests = client.on("surface.request", (payload) => {
    relay.request(payload);
  });
  client.connect();
  return {
    client,
    relay,
    dispose: () => {
      stopRequests();
      globalThis.removeEventListener("message", onMessage);
      relay.dispose();
      client.close();
    },
  };
}

/** The index surface of the host: the first surface with the capability `index`, or null. */
export function indexSurfaceOf(surfaces: readonly SurfaceState[]): SurfaceState | null {
  return surfaceWith(surfaces, INDEX_CAPABILITY);
}

/** The URL of the built lab for the indexer from the surface states of the host. */
export function indexerUrlOf(surfaces: readonly SurfaceState[]): string | null {
  return indexSurfaceOf(surfaces)?.indexerUrl ?? null;
}

/** The parts of the loop on a connected page. `ready` resolves at the next `ready` of the frame. */
export function indexerParts(
  page: IndexerPage,
  state: {
    readonly baseUrl: () => string | null;
    readonly nextReady: () => Promise<void>;
    /** The ID of the index surface, or null before the host lists one. */
    readonly surface: () => string | null;
  },
  onStatus: IndexerParts["onStatus"],
): IndexerParts {
  const { client, relay } = page;
  const callFrame = (call: string, args: readonly unknown[], timeoutMs?: number): Promise<unknown> => {
    const surface = state.surface();
    if (surface === null) return Promise.reject(new Error("The host lists no index surface."));
    return relay.call(surface, WHERE, call, args, timeoutMs);
  };
  async function waitForScene(start: number): Promise<void> {
    while (performance.now() - start < LOAD_TIMEOUT_MS) {
      const stats = (await callFrame("stats", [false], 5_000).catch(() => null)) as { assets?: unknown } | null;
      if (typeof stats?.assets === "string" && SETTLED.has(stats.assets)) return;
      await delay(250);
    }
    throw new Error("The lab frame of the indexer did not settle its assets in 90 s.");
  }
  return {
    request: (type, params) => client.request(type, params),
    sendIndexFrame: (job, mime, bytes) => {
      client.sendIndexFrame(job, mime, bytes);
    },
    callFrame,
    baseUrl: state.baseUrl,
    async load(url) {
      const start = performance.now();
      const ready = state.nextReady();
      page.setSrc(url);
      await Promise.race([
        ready,
        delay(LOAD_TIMEOUT_MS).then(() => {
          throw new Error("The lab frame of the indexer gave no ready in 90 s.");
        }),
      ]);
      await waitForScene(start);
    },
    shellState,
    waitForWork: (ms) =>
      new Promise<void>((resolve) => {
        const stop = client.on("index.progress", (progress: IndexProgress) => {
          if (progress.queued > 0) finish();
        });
        const timer = setTimeout(finish, ms);
        function finish(): void {
          clearTimeout(timer);
          stop();
          resolve();
        }
      }),
    sleep: delay,
    now: () => performance.now(),
    ...(onStatus === undefined ? {} : { onStatus }),
  };
}
