<!-- SPDX-License-Identifier: Apache-2.0 -->
<script setup lang="ts">
/**
 * The two live regions of the app: one polite region and one assertive region. Render it once,
 * near the root. The text of each region changes only through the announcer queue, which limits the rate.
 * To make a screen reader read the same text again, the region is empty for a short moment first.
 */
import { inject, nextTick, ref, watch } from "vue";
import { ANNOUNCER_KEY } from "./announcer";

const announcer = inject(ANNOUNCER_KEY, null);
const polite = ref("");
const assertive = ref("");

if (announcer !== null) {
  watch(announcer.current.polite, async (item) => {
    polite.value = "";
    await nextTick();
    polite.value = item?.text ?? "";
  });
  watch(announcer.current.assertive, async (item) => {
    assertive.value = "";
    await nextTick();
    assertive.value = item?.text ?? "";
  });
}
</script>

<template>
  <div class="sr-only">
    <div role="status" aria-live="polite" aria-atomic="true" data-testid="live-polite">{{ polite }}</div>
    <div aria-live="assertive" aria-atomic="true" data-testid="live-assertive">{{ assertive }}</div>
  </div>
</template>
