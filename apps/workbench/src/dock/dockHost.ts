// SPDX-License-Identifier: Apache-2.0
/**
 * The host for the dock tabs: the requests, the events and the files of the runs. A test gives a fake. `makeDockHost`
 * makes it from the host of the page.
 */
import { runFileUrl, TOKEN_HEADER, type EventPayload, type EventType } from "@scenity/workbench-host/protocol";
import { watch } from "vue";
import type { HostApi, HostRequest } from "../host/useHost";

export interface DockHost {
  readonly request: HostRequest;
  /** Listen to an event of the host. The result stops the listener. */
  on<T extends EventType>(type: T, listener: (payload: EventPayload<T>) => void): () => void;
  /** A file of the output folder of a run (with the launch token in the header). */
  fetchRunFile(run: string, path: string): Promise<Blob>;
  /** The default sequence of the project (`host.hello`), or null. A fake of a test can leave it out. */
  defaultSequence?(): string | null;
}

/** Make the dock host from the host of the page. A listener follows the client when the page gets a new one. */
export function makeDockHost(host: HostApi): DockHost {
  return {
    request: host.request,
    on(type, listener) {
      let stop: (() => void) | null = null;
      const unwatch = watch(
        host.client,
        (client) => {
          stop?.();
          stop = client === null ? null : client.on(type, listener);
        },
        { immediate: true },
      );
      return () => {
        unwatch();
        stop?.();
      };
    },
    async fetchRunFile(run, path) {
      const endpoint = host.endpoint.value;
      if (endpoint === null) throw new Error("The host is not connected.");
      const response = await fetch(runFileUrl(endpoint.origin, run, path), {
        headers: { [TOKEN_HEADER]: endpoint.token },
      });
      if (!response.ok) throw new Error(`The file ${path} is not available (${String(response.status)}).`);
      return response.blob();
    },
    defaultSequence: () => host.access?.value?.project.defaultSequence ?? null,
  };
}
