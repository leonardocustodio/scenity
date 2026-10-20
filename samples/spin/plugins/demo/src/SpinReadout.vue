<!-- SPDX-License-Identifier: Apache-2.0 -->
<script setup lang="ts">
/** The overlay of the demo plugin (the `overlays` point): the count of the spinners over the Scene view. */
import type { StudioContext } from "@scenity/editor/studio";
import { onBeforeUnmount, ref } from "vue";

const props = defineProps<{ ctx: StudioContext }>();
const count = ref(props.ctx.documents.entities("demo.spin").length);
const stop = props.ctx.documents.listen(() => {
  count.value = props.ctx.documents.entities("demo.spin").length;
});
onBeforeUnmount(stop);
</script>

<template>
  <p class="px-1.5 py-0.5 text-caption text-text-primary" data-testid="demo-readout">
    {{ ctx.t("demo-readout", { count }) }}
  </p>
</template>
