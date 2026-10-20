<!-- SPDX-License-Identifier: Apache-2.0 -->
<script setup lang="ts">
/**
 * A tile of the grid of the content browser: the picture of the item (or the icon of its kind), its name, and the
 * status dot and the priority of a clip. An item that the lab cannot play has a dimmed tile. The title attribute gives
 * the first sentence of the catalog.
 *
 * The texts are Fluent messages of `src/i18n/en-US/browser.ftl`.
 */
import { cn } from "@scenity/ui";
import { useI18n } from "@scenity/i18n";
import { computed } from "vue";
import { iconOf, STATUS_STYLE, stillStale, stillUrl, tileNote } from "./dockUi";
import type { BrowserItem } from "./tree";

const props = defineProps<{
  readonly item: BrowserItem;
  readonly open: boolean;
  readonly focused: boolean;
}>();
const { $t } = useI18n();

const picture = computed(() => stillUrl(props.item));
const stale = computed(() => picture.value !== null && stillStale(props.item));
const folder = computed(() => props.item.children.length > 0);
const playable = computed(() => folder.value || props.item.scene !== null);
const status = computed(() => (props.item.clip === undefined ? null : (STATUS_STYLE[props.item.clip.status] ?? null)));
const hint = computed(() =>
  [
    props.item.key,
    props.item.clip?.summary,
    status.value?.words,
    props.item.scene?.exact === false ? $t("browser-tile-family-scene") : undefined,
    !playable.value ? $t("browser-tile-not-playable") : undefined,
    picture.value === null && props.item.scene !== null
      ? $t("browser-tile-no-picture", { key: props.item.key })
      : undefined,
    stale.value ? $t("browser-tile-stale-picture", { key: props.item.key }) : undefined,
  ]
    .filter((part) => part !== undefined && part !== "")
    .join("\n"),
);
/** True when the second line of the tile is the subtitle of the plugin (a data value), not a message. */
const noteIsData = computed(() => props.item.scene !== null || props.item.children.length > 0);
</script>

<template>
  <button
    type="button"
    :tabindex="focused ? 0 : -1"
    :class="
      cn(
        'dock-tile group flex min-w-0 flex-col gap-1 rounded-control p-1 text-left outline-none',
        'hover:bg-surface-raised focus-visible:ring-2 focus-visible:ring-focus-ring',
        open && 'bg-accent-brand/15 ring-1 ring-accent-brand',
        !playable && 'opacity-55',
      )
    "
    :title="hint"
    :aria-current="open ? 'true' : undefined"
    :data-testid="`dock-tile-${item.key}`"
    :data-key="item.key"
  >
    <span
      class="relative grid aspect-[4/3] w-full place-items-center overflow-hidden rounded-[0.3rem] bg-surface-sunken text-text-secondary"
    >
      <img v-if="picture !== null" :src="picture" alt="" class="size-full object-cover" draggable="false" />
      <component :is="iconOf(item)" v-else :class="cn('size-7', folder && 'text-status-caution')" aria-hidden="true" />
      <span
        v-if="stale"
        class="absolute bottom-1 left-1 rounded-pill bg-status-caution px-1.5 text-[0.625rem] text-text-on-accent"
        data-testid="dock-tile-stale"
        >{{ $t("browser-tile-stale") }}</span
      >
      <span
        v-if="folder"
        class="absolute right-1 bottom-1 rounded-pill bg-surface-overlay/90 px-1.5 text-[0.625rem] tabular-nums"
        >{{ item.children.length }}</span
      >
      <span
        v-if="item.scene?.exact === false"
        class="absolute top-1 left-1 rounded-pill bg-surface-overlay/90 px-1.5 text-[0.625rem]"
        :title="$t('browser-tile-family-title')"
        >{{ $t("browser-tile-family") }}</span
      >
      <component
        :is="iconOf(item)"
        v-if="picture !== null && item.clip !== undefined"
        class="absolute top-1 right-1 size-4 rounded-pill bg-surface-overlay/90 p-0.5"
        aria-hidden="true"
      />
    </span>
    <span class="flex min-w-0 items-center gap-1.5">
      <span v-if="status !== null" :class="cn('size-2 shrink-0 rounded-pill', status.dot)" aria-hidden="true" />
      <span class="min-w-0 truncate text-caption text-text-primary" translate="no">{{ item.title }}</span>
    </span>
    <span class="min-w-0 truncate text-[0.6875rem] text-text-secondary" :translate="noteIsData ? 'no' : undefined">{{
      tileNote(item)
    }}</span>
  </button>
</template>
