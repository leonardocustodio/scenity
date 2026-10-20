// SPDX-License-Identifier: Apache-2.0
/**
 * The import by drop in the workbench page: the handler of the `import` events
 * of the frames for the relay (surfaces/useSurface.ts). Each drop uploads its file and shows the result in the frame of
 * the drop (importDrop.ts).
 */
import type { BridgeImportEvent, BridgeScratchEvent, SurfaceWhere } from "@scenity/workbench-host/protocol";
import type { HostApi } from "../host/useHost";
import type { SurfaceRelay } from "../surfaces/relay";
import { createImportDrop } from "./importDrop";
import { createScratchModels } from "./scratchModels";

/**
 * The handler of the drops; `relay` gives the relay of the page (it exists when a drop comes). `pathOf` gives the file
 * path of a drop of the desktop shell (desktop/shellDrop.ts `take`).
 */
export function importDropHandler(
  host: Pick<HostApi, "endpoint" | "client">,
  relay: () => SurfaceRelay,
  pathOf?: (drop: string) => string | null,
): (surface: string, event: BridgeImportEvent) => void {
  return (surface, event) => {
    const run = createImportDrop({
      endpoint: () => host.endpoint.value,
      onRunDone: (listener) => host.client.value?.on("runs.done", listener) ?? (() => undefined),
      call: (call, args) => relay().call(surface, "visible", call, args),
      ...(pathOf === undefined ? {} : { pathOf }),
    });
    void run(event);
  };
}

/** The handler of the `scratch` events of the frames: the models go to the frame that asked (scratchModels.ts). */
export function scratchModelHandler(
  host: Pick<HostApi, "endpoint">,
  relay: () => SurfaceRelay,
): (surface: string, where: SurfaceWhere, event: BridgeScratchEvent) => void {
  return (surface, where, event) => {
    const run = createScratchModels({
      endpoint: () => host.endpoint.value,
      call: (call, args) => relay().call(surface, where, call, args),
    });
    void run(event);
  };
}
