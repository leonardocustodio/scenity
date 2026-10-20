<!-- SPDX-License-Identifier: Apache-2.0 -->
<script setup lang="ts">
import type { AvatarImageProps } from "reka-ui";
import { AvatarImage } from "reka-ui";
import { forwardable } from "../../../lib/utils";

const props = defineProps<AvatarImageProps>();
</script>

<template>
  <AvatarImage data-slot="avatar-image" v-bind="forwardable(props)" class="aspect-square size-full">
    <slot />
  </AvatarImage>
</template>
