<!-- SPDX-License-Identifier: Apache-2.0 -->
<script setup lang="ts">
/**
 * A tile of the asset browser: the still of the asset (or the icon of its kind when the still is missing or does not
 * load), its name and its kind. A drag of the tile carries `asset:<id>` and the name, so the viewport can accept the
 * asset (scene/assetDrop.ts).
 *
 * The texts are Fluent messages of `src/i18n/en-US/assets.ftl`. The name and the kind are data values.
 */
import { useI18n } from "@scenity/i18n";
import { cn } from "@scenity/ui";
import { computed, ref, watch } from "vue";
import { actorColour } from "../scene/actorColour";
import { kindIcon } from "./assetIcons";
import {
  ASSET_DRAG_TYPE,
  ASSET_NAME_DRAG_TYPE,
  ASSET_KIND_DRAG_TYPE,
  assetDragValue,
  type AssetListEntry,
  type StillState,
} from "./assetTypes";

const props = defineProps<{
  readonly asset: AssetListEntry;
  /** The URL of the project folder, with a "/" at the end. Null when the server gives no project files. */
  readonly base: string | null;
  readonly selected: boolean;
  /** The state of the still in the stills plan (none: the source has no plan). */
  readonly stillState?: StillState | undefined;
  /** It changes after a make step, so the tile loads its still again. */
  readonly stillKey?: number | undefined;
  /** True for a picked asset. Mod or Shift and a click picks it, for one rights record of many assets. */
  readonly picked?: boolean | undefined;
  /** The problems of the release gate for this asset (none: the gate accepts it). */
  readonly rightsProblems?: readonly string[] | undefined;
  /** The session and the turn of an agent that wrote a file of the asset (none: no agent wrote one). */
  readonly agentMark?: { readonly name: string; readonly colour: string; readonly turn: number } | null | undefined;
}>();
const emit = defineEmits<{ select: [id: string]; pick: [id: string] }>();

/** A click selects the asset. With Mod or Shift, a click picks the asset. */
function onClick(event: MouseEvent): void {
  if (event.metaKey || event.ctrlKey || event.shiftKey) emit("pick", props.asset.id);
  else emit("select", props.asset.id);
}
const { $t } = useI18n();

const broken = ref(false);
watch(
  () => [props.asset.still, props.stillKey],
  () => {
    broken.value = false;
  },
);
const still = computed(() =>
  props.asset.still === null || props.base === null || broken.value
    ? null
    : `${props.base}${encodeURI(props.asset.still)}${props.stillKey ? `?v=${String(props.stillKey)}` : ""}`,
);
// One message gives the source, the ID and the tags. The problems of the asset database follow it.
const hint = computed(() => {
  const { source, id, tags, problems } = props.asset;
  const head =
    tags.length === 0
      ? $t("assets-tile-hint-untagged", { source, id })
      : $t("assets-tile-hint", { source, id, tags: tags.join(", ") });
  return [head, ...problems].join("\n");
});

function onDragStart(event: DragEvent): void {
  const data = event.dataTransfer;
  if (data === null) return;
  data.effectAllowed = "copy";
  data.setData(ASSET_DRAG_TYPE, assetDragValue(props.asset.id));
  data.setData(ASSET_NAME_DRAG_TYPE, props.asset.name);
  data.setData(ASSET_KIND_DRAG_TYPE, props.asset.kind);
  data.setData("text/plain", assetDragValue(props.asset.id));
}
</script>

<template>
  <button
    type="button"
    draggable="true"
    :class="
      cn(
        'flex min-w-0 flex-col gap-1 rounded-control p-1 text-left outline-none',
        'hover:bg-surface-raised focus-visible:ring-2 focus-visible:ring-focus-ring',
        selected && 'bg-accent-brand/15 ring-1 ring-accent-brand',
        picked && 'ring-2 ring-focus-ring',
      )
    "
    :title="hint"
    :aria-pressed="selected"
    :data-testid="`asset-tile-${asset.id}`"
    :data-kind="asset.kind"
    :data-still="still === null ? '0' : '1'"
    :data-still-state="stillState"
    :data-picked="picked ? '1' : undefined"
    :data-rights="rightsProblems === undefined ? undefined : 'blocked'"
    :data-agent="agentMark?.name"
    @click="onClick"
    @dragstart="onDragStart"
  >
    <span
      class="relative grid aspect-[4/3] w-full place-items-center overflow-hidden rounded-[0.3rem] bg-surface-sunken text-text-secondary"
    >
      <img
        v-if="still !== null"
        :src="still"
        alt=""
        class="size-full object-cover"
        draggable="false"
        data-testid="asset-still"
        @error="broken = true"
      />
      <component :is="kindIcon(asset.kind)" v-else class="size-7" aria-hidden="true" data-testid="asset-kind-icon" />
      <span
        v-if="asset.problems.length > 0"
        class="absolute bottom-1 left-1 rounded-pill bg-status-caution px-1.5 text-[0.625rem] text-text-on-accent"
        >{{ $t("assets-problem") }}</span
      >
      <span
        v-if="agentMark != null"
        class="absolute top-1 left-1 size-2.5 rounded-full ring-2 ring-surface-base"
        :style="{ background: actorColour({ colour: agentMark.colour }) }"
        :title="$t('assets-agent-mark', { name: agentMark.name, turn: agentMark.turn })"
        role="img"
        :aria-label="$t('assets-agent-mark', { name: agentMark.name, turn: agentMark.turn })"
        data-testid="asset-agent-mark"
      />
      <span
        v-if="rightsProblems !== undefined"
        class="absolute right-1 bottom-1 rounded-pill bg-status-negative px-1.5 text-[0.625rem] text-text-on-accent"
        :title="rightsProblems.join('\n')"
        data-testid="asset-rights-mark"
        >{{ $t("assets-rights-mark") }}</span
      >
      <span
        v-if="stillState === 'stale' || (stillState === 'missing' && asset.still !== null)"
        class="absolute top-1 right-1 rounded-pill bg-status-caution px-1.5 text-[0.625rem] text-text-on-accent"
        :title="$t('assets-still-stale-hint')"
        data-testid="asset-still-stale"
        >{{ $t("assets-still-stale") }}</span
      >
    </span>
    <span class="min-w-0 truncate text-caption text-text-primary" translate="no">{{ asset.name }}</span>
    <span class="min-w-0 truncate text-[0.6875rem] text-text-secondary" translate="no">{{ asset.kind }}</span>
  </button>
</template>
