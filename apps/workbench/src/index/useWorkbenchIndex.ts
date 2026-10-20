// SPDX-License-Identifier: Apache-2.0
/**
 * The frame index in the workbench page: the index reads of the lab frames (indexReads.ts) and the browser path of the
 * indexer, the shadow frame at idle time (useShadowIndexer.ts). In the labs app with an indexer window (the shell
 * lists the feature `indexer`), the indexer window renders the jobs. Then the shadow frame takes no job, but the page
 * still sends the plans.
 */
import { shellFeature } from "@scenity/labs-platform";
import { getCurrentScope, onScopeDispose } from "vue";
import type { HostApi } from "../host/useHost";
import type { SurfaceRelay } from "../surfaces/relay";
import { startIndexReads } from "./indexReads";
import { useShadowIndexer, type ShadowIndexer } from "./useShadowIndexer";

/** The feature of the desktop shell when its indexer window renders the index. */
export const INDEXER_FEATURE = "indexer";

export function useWorkbenchIndex(host: HostApi, relay: SurfaceRelay): ShadowIndexer | null {
  const stopReads = startIndexReads(relay, () => host.endpoint.value);
  if (getCurrentScope() !== undefined) onScopeDispose(stopReads);
  // The page still sends the plans and tells the readers. The indexer window takes the jobs.
  const indexerWindow = shellFeature(globalThis, INDEXER_FEATURE);
  return useShadowIndexer(host, relay, { jobs: !indexerWindow });
}
