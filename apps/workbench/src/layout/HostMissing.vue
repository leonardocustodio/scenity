<!-- SPDX-License-Identifier: Apache-2.0 -->
<script setup lang="ts">
/**
 * The page without a working host: the search for the endpoint, no endpoint (the
 * page tells how to start a host), or a host that does not answer yet.
 */
import { PROTOCOL_VERSION } from "@scenity/workbench-host/protocol";
import { LoaderCircle, Unplug } from "lucide-vue-next";

defineProps<{
  /** `looking`: the search runs; `none`: no endpoint; `waiting`: an endpoint, no answer yet. */
  readonly mode: "looking" | "none" | "waiting";
  readonly origin: string | null;
}>();
</script>

<template>
  <section
    class="grid min-h-0 place-items-center p-6"
    :data-testid="mode === 'none' ? 'workbench-no-host' : `workbench-host-${mode}`"
  >
    <div v-if="mode === 'none'" class="flex max-w-xl flex-col items-center gap-3 text-center">
      <Unplug class="size-8 text-text-secondary" aria-hidden="true" />
      <h2 class="text-title">The host is not connected.</h2>
      <p class="text-caption text-text-secondary">
        Start the host with <code>bun packages/workbench-host/src/main.ts --checkout &lt;path&gt;</code> and open this
        page with <code>?host=&lt;origin&gt;#token=&lt;token&gt;</code>. Protocol {{ PROTOCOL_VERSION }}.
      </p>
    </div>
    <p v-else class="flex items-center gap-2 text-text-secondary" role="status">
      <LoaderCircle class="size-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />
      <template v-if="mode === 'looking'">Looking for the host</template>
      <template v-else>Connecting to the host at {{ origin }}</template>
    </p>
  </section>
</template>
