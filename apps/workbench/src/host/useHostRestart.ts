// SPDX-License-Identifier: Apache-2.0
/**
 * The `Restart host` action of the page. The page sends `host.restart`. The host answers, sends `host.restarting` and
 * stops. Then its supervisor starts a new host on the same port with the same token. The client of the page connects
 * again by itself (in the meantime, the host connection shows "lost"). The new host gives the same checkout and
 * surfaces at the next hello. A host without a supervisor refuses with a reason, and the note shows the reason. In the
 * app, View > Restart Host restarts the host from the shell.
 */
import { ref, watch, type Ref } from "vue";
import type { HostApi } from "./useHost";

export interface HostRestart {
  /** True from the request to the next hello of a host. */
  readonly restarting: Ref<boolean>;
  /** The words for the status line, or null. */
  readonly note: Ref<string | null>;
  restart(): Promise<void>;
}

export function useHostRestart(host: Pick<HostApi, "request" | "client" | "checkout">): HostRestart {
  const restarting = ref(false);
  const note = ref<string | null>(null);
  let stopEvent: (() => void) | null = null;
  watch(
    () => host.client.value,
    (client) => {
      stopEvent?.();
      stopEvent =
        client?.on("host.restarting", () => {
          restarting.value = true;
          note.value = "The host restarts. The page connects again by itself.";
        }) ?? null;
    },
    { immediate: true },
  );
  // A hello of the new host gives a new checkout object: the restart is done.
  watch(
    () => host.checkout.value,
    () => {
      if (!restarting.value) return;
      restarting.value = false;
      note.value = null;
    },
  );

  async function restart(): Promise<void> {
    if (restarting.value) return;
    restarting.value = true;
    note.value = "The host restarts. The page connects again by itself.";
    try {
      await host.request("host.restart", {});
    } catch (reason) {
      restarting.value = false;
      note.value = `Restart host: ${reason instanceof Error ? reason.message : String(reason)}`;
    }
  }

  return { restarting, note, restart };
}
