<!-- SPDX-License-Identifier: Apache-2.0 -->
<script setup lang="ts">
/**
 * The scratch prop part of the selection card. It shows the import of the model, its budget, and the source and
 * licence answers of the owner. A "rights not known" mark shows the answer of the licence register: the reason that
 * the source or the licence is not allowed. The card also has Duplicate, Delete and "Promote to the room". A dry run
 * asks the host what the promote writes. "Promote" makes the project asset and the entity of the room document (no
 * Claude prompt). The host writes the files. The release gate stops the asset until the owner records its rights. A
 * project that needs a code change to show the entity gets the lines of that change.
 *
 * The texts are Fluent messages of `src/i18n/en-US/scratch.ftl`. The texts of the host (a refusal, the rights note,
 * the follow-up lines) show as the host gives them.
 */
import { useI18n } from "@scenity/i18n";
import { computed } from "vue";
import { button } from "../labUi";
import { promoteBlock, rightsGap, type PromoteView } from "./scratchInfo";
import type { ScratchItem } from "./useScratch";

const props = defineProps<{
  readonly item: ScratchItem;
  readonly inWorkbench: boolean;
  readonly promotion: PromoteView | null;
}>();

const emit = defineEmits<{ duplicate: []; remove: []; promote: [dry: boolean] }>();
const { $t } = useI18n();

const gap = computed(() => rightsGap(props.item.info));
const blocked = computed(() => (props.inWorkbench ? promoteBlock(props.item.info) : $t("scratch-promote-needs-host")));
const shown = computed(() => (props.promotion?.id === props.item.id ? props.promotion : null));
const budget = computed(() => {
  const info = props.item.info;
  if (info === null) return props.item.error ?? (props.item.loaded ? "" : $t("scratch-loading"));
  return $t("scratch-budget", {
    triangles: String(info.triangles ?? "?"),
    kb: String(info.kb ?? "?"),
    pass: info.pass === true ? "yes" : "no",
  });
});
</script>

<template>
  <div class="flex flex-col gap-1 border-t border-border-subtle pt-1.5" data-testid="lab-scratch">
    <span class="text-text-secondary">
      {{ $t("scratch-intro", { name: item.info?.name || item.model, import: item.model }) }}
    </span>
    <span v-if="budget !== ''" class="font-mono" data-testid="lab-scratch-budget">{{ budget }}</span>
    <dl class="m-0 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5">
      <dt class="text-text-secondary">{{ $t("scratch-field-source") }}</dt>
      <dd class="m-0 truncate" :translate="item.info?.source ? 'no' : undefined" data-testid="lab-scratch-source">
        {{ item.info?.source || $t("scratch-not-given") }}
      </dd>
      <dt class="text-text-secondary">{{ $t("scratch-field-licence") }}</dt>
      <dd class="m-0 truncate" :translate="item.info?.licence ? 'no' : undefined" data-testid="lab-scratch-licence">
        {{ item.info?.licence || $t("scratch-not-given") }}
      </dd>
    </dl>
    <p v-if="gap !== null" class="m-0 text-status-caution" role="status" data-testid="lab-scratch-rights">
      {{ $t("scratch-rights", { gap }) }}
    </p>
    <div class="flex flex-wrap gap-1">
      <button type="button" :class="button" data-testid="lab-scratch-duplicate" @click="emit('duplicate')">
        {{ $t("scratch-duplicate") }}
      </button>
      <button type="button" :class="button" data-testid="lab-scratch-delete" @click="emit('remove')">
        {{ $t("scratch-delete") }}
      </button>
      <button
        type="button"
        :class="button"
        :disabled="blocked !== null"
        :title="blocked ?? $t('scratch-promote-dry-title')"
        data-testid="lab-scratch-promote"
        @click="emit('promote', true)"
      >
        {{ $t("scratch-promote-dry") }}
      </button>
    </div>
    <p v-if="blocked !== null" class="m-0 text-text-secondary">
      {{ $t("scratch-promote-blocked", { reason: blocked }) }}
    </p>
    <template v-if="shown !== null">
      <p v-if="shown.status === 'running'" class="m-0 text-text-secondary" role="status">
        {{ $t("scratch-promoting") }}
      </p>
      <p
        v-else-if="shown.refused !== null"
        class="m-0 text-status-caution"
        role="status"
        data-testid="lab-promote-refused"
      >
        {{ shown.refused }}
      </p>
      <template v-else>
        <span class="text-text-secondary">
          {{ shown.dry ? $t("scratch-promote-changes") : $t("scratch-promoted", { entity: shown.entity ?? "?" }) }}
        </span>
        <ul
          class="m-0 list-disc pl-4 font-mono"
          translate="no"
          :data-testid="shown.dry ? 'lab-promote-changes' : 'lab-promote-done'"
        >
          <li v-for="line in shown.changes" :key="line">{{ line }}</li>
        </ul>
        <p v-if="shown.rights !== ''" class="m-0 text-status-caution" data-testid="lab-promote-rights">
          {{ shown.rights }}
        </p>
        <ul v-if="shown.followUp.length > 0" class="m-0 list-disc pl-4" data-testid="lab-promote-follow">
          <li v-for="line in shown.followUp" :key="line">{{ line }}</li>
        </ul>
        <button
          v-if="shown.dry"
          type="button"
          :class="button"
          data-testid="lab-promote-send"
          @click="emit('promote', false)"
        >
          {{ $t("scratch-promote") }}
        </button>
      </template>
    </template>
  </div>
</template>
