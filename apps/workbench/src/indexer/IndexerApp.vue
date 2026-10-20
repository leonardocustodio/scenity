<!-- SPDX-License-Identifier: Apache-2.0 -->
<script setup lang="ts">
/**
 * The page of the indexer window of the labs app: `index.html?indexer=1`. The shell opens it off the screen after the
 * main window shows (frontend/labs-desktop `indexer.rs`), so nobody sees it. It connects to the host of the main
 * window. It shows the built lab of the host in one frame (the place `indexer` of the index surface). It draws the
 * jobs of the frame index (indexerLoop.ts). The text of the page is for a developer who opens the window by hand. The
 * state is on `globalThis.__labsIndexer` for the measurement scripts. A host restart gives a new endpoint, and the
 * shell loads the page again. The page is also a WebKit page of the render pool (poolWorker.ts). A tool shot with
 * `--engine webkit` borrows its frame.
 */
import { hasCapability, INDEX_CAPABILITY, type SurfaceState } from "@scenity/workbench-host/protocol";
import { nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from "vue";
import { findEndpoint, type EndpointWindow } from "../host/endpoint";
import { LAB_FRAME_SANDBOX } from "../surfaces/frameSandbox";
import { originOf } from "../surfaces/useSurface";
import { IndexerLoop, type IndexerStatus } from "./indexerLoop";
import { connectIndexer, indexerParts, indexSurfaceOf, WHERE, type IndexerPage } from "./indexerPage";
import { PoolWorker, type PoolWorkerEndpoint } from "./poolWorker";

declare global {
  // The state of the indexer for the measurement scripts (also of the WebKit page of the pool).
  var __labsIndexer:
    { status(): IndexerStatus; worker(): { id: string; lease: string | null; done: number } | null } | undefined;
}

const src = ref<string | null>(null);
const frame = ref<HTMLIFrameElement | null>(null);
const status = shallowRef<IndexerStatus | null>(null);
const note = ref("Looking for the host.");
let page: IndexerPage | null = null;
let loop: IndexerLoop | null = null;
let worker: PoolWorker | null = null;
let baseUrl: string | null = null;
/** The ID of the index surface of the host. */
let surfaceId: string | null = null;
let workerEndpoint: PoolWorkerEndpoint | null = null;
let readyWaiters: (() => void)[] = [];

function onReady(): void {
  const waiters = readyWaiters;
  readyWaiters = [];
  for (const done of waiters) done();
}

const STOPPED: IndexerStatus = {
  phase: "stopped",
  reason: null,
  done: 0,
  failed: 0,
  rate: 0,
  yields: 0,
  lastJobMs: null,
  lastError: null,
  main: null,
};

// The relay knows the window and the origin of the frame before its page sends `ready`.
let detach: (() => void) | null = null;
watch(
  [frame, src],
  ([element, current]) => {
    detach?.();
    detach = null;
    const target = element?.contentWindow ?? null;
    const origin = current === null ? null : originOf(current);
    if (page !== null && target !== null && origin !== null && surfaceId !== null)
      detach = page.relay.attach(surfaceId, WHERE, { window: target, origin });
  },
  { flush: "post" },
);

function keepSurfaces(surfaces: readonly SurfaceState[]): void {
  const surface = indexSurfaceOf(surfaces);
  surfaceId = surface?.id ?? surfaceId;
  baseUrl = surface?.indexerUrl ?? baseUrl;
  workerEndpoint = surface?.indexerWorker ?? workerEndpoint;
}

onMounted(async () => {
  const found = await findEndpoint(globalThis as unknown as EndpointWindow).catch(() => null);
  if (found === null) {
    note.value = "No host: the indexer runs only in the labs app.";
    return;
  }
  const connected = connectIndexer(found.endpoint, onReady);
  // The same URL again loads the frame again (a new build of the lab): the frame goes and comes back.
  const setSrc = (url: string | null): void => {
    if (url === null || url !== src.value) {
      src.value = url;
      return;
    }
    src.value = null;
    void nextTick(() => {
      src.value = url;
    });
  };
  page = { ...connected, setSrc };
  connected.client.onHello((hello) => {
    keepSurfaces(hello.surfaces);
    note.value = "Connected.";
  });
  connected.client.on("surface.state", ({ surface }) => {
    if (hasCapability(surface, INDEX_CAPABILITY)) {
      surfaceId = surface.id;
      baseUrl = surface.indexerUrl ?? null;
      workerEndpoint = surface.indexerWorker ?? null;
    }
  });
  const parts = indexerParts(
    page,
    {
      baseUrl: () => baseUrl,
      nextReady: () => new Promise<void>((resolve) => readyWaiters.push(resolve)),
      surface: () => surfaceId,
    },
    (next) => (status.value = next),
  );
  const indexer = new IndexerLoop(parts);
  loop = indexer;
  worker = new PoolWorker({
    endpoint: () => workerEndpoint,
    baseUrl: () => baseUrl,
    lend: () => indexer.lend(),
    giveBack: () => {
      indexer.giveBack();
    },
    load: (url) => parts.load(url),
    frameSrc: () => src.value,
    callFrame: (call, args, timeoutMs) => parts.callFrame(call, args, timeoutMs),
    fetch: (url, init) => fetch(url, init),
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    agent: navigator.userAgent,
  });
  const pool = worker;
  globalThis.__labsIndexer = {
    status: () => loop?.status ?? STOPPED,
    worker: () => ({ id: pool.id, lease: pool.lease, done: pool.done }),
  };
  indexer.start();
  pool.start();
});

onBeforeUnmount(() => {
  void worker?.stop();
  void loop?.stop();
  detach?.();
  page?.dispose();
  globalThis.__labsIndexer = undefined;
});
</script>

<template>
  <main class="flex h-screen w-screen flex-col bg-neutral-950 text-xs text-neutral-300">
    <p class="px-2 py-1" data-testid="indexer-status">
      Indexer · {{ status?.phase ?? note }} · {{ status?.done ?? 0 }} frames · {{ status?.failed ?? 0 }} failed
      <span v-if="status?.reason"> · {{ status.reason }}</span>
    </p>
    <iframe
      v-if="src !== null"
      ref="frame"
      :src="src"
      title="The lab of the indexer"
      data-frame="lab-indexer"
      :sandbox="LAB_FRAME_SANDBOX"
      class="w-full flex-1 border-0"
    />
  </main>
</template>
