<!-- SPDX-License-Identifier: Apache-2.0 -->
<script setup lang="ts">
/**
 * The card of the proposals. It shows each edit that waits for the owner: the author, the title of its command and its
 * ops. It has the buttons Accept, Reject, Accept all and Reject all. Each op tells how the scene shows it: a ghost (a
 * translucent copy of the prop at its proposed place), a marker (a ring on the floor at the target anchor of a team
 * place) or only the card. The buttons run the owner-only commands `proposal.*` of the registry (SceneEditLayer.vue).
 * The lab shows the card only while proposals wait.
 *
 * With `layouts`, each proposal shows the layout checks that its ops break and repair, with their numbers. A broken
 * check passes on the current scene and fails with the proposal. Thus the owner sees if a proposal of Claude breaks a
 * check.
 *
 * The texts are Fluent messages of `src/i18n/en-US/palette.ftl`. A proposal ID and a tune op are data values
 * (`translate="no"`). The layout check lines come from the plugin.
 */
import { useI18n } from "@scenity/i18n";
import { button } from "../labUi";
import { opShown, opText, type OpShown } from "./ghosts";
import { checkLine, type ProposalLayout } from "./layout";
import type { Proposal } from "./useCommands";

const props = defineProps<{
  readonly proposals: readonly Proposal[];
  /** The layout checks of each proposal against the current scene, by the proposal ID. */
  readonly layouts?: ReadonlyMap<string, ProposalLayout>;
}>();

const emit = defineEmits<{
  accept: [id: string];
  reject: [id: string];
  acceptAll: [];
  rejectAll: [];
}>();

/** The layout checks of a proposal, or null. */
function layoutOf(id: string): ProposalLayout | null {
  return props.layouts?.get(id) ?? null;
}

/** True when a proposal does not break or repair a layout check. */
function unchanged(id: string): boolean {
  const layout = layoutOf(id);
  return layout !== null && layout.breaks.length + layout.mends.length === 0;
}

const { $t } = useI18n();

/** The message IDs of how the scene shows an op. */
const SHOWN: Readonly<Record<OpShown, string>> = {
  ghost: "palette-shown-ghost",
  marker: "palette-shown-marker",
  card: "palette-shown-card",
};
/** The message IDs of the author of a proposal. */
const BY: Readonly<Record<Proposal["by"], string>> = {
  owner: "palette-by-owner",
  claude: "palette-by-claude",
  script: "palette-by-script",
};

/** True when the text of an op is only data: a tune path and its value (ghosts.ts `opText`). */
function dataOp(op: Proposal["edit"]["ops"][number]): boolean {
  return op.kind === "tune" && op.value !== null;
}

/** The value of a layout check with its unit (a count has no unit). */
function checkValue(check: { readonly value: unknown; readonly unit: string }): string {
  return check.unit === "count" ? String(check.value) : `${String(check.value)} ${check.unit}`;
}
</script>

<template>
  <section
    class="flex w-80 max-w-[calc(100vw-2rem)] flex-col gap-1.5 rounded-card bg-surface-overlay/95 px-3 py-2 text-caption shadow-overlay"
    :aria-label="$t('palette-proposals')"
    data-scene-control
    data-testid="lab-proposals"
  >
    <header class="flex items-center gap-2">
      <span class="text-label">{{ $t("palette-proposals-count", { count: String(proposals.length) }) }}</span>
      <span class="text-text-secondary">{{ $t("palette-proposals-hint") }}</span>
    </header>
    <ol class="m-0 flex max-h-72 list-none flex-col gap-1.5 overflow-auto p-0">
      <li
        v-for="proposal in proposals"
        :key="proposal.id"
        class="flex flex-col gap-1 rounded-control bg-surface-sunken p-1.5"
        :data-testid="`lab-proposal-${proposal.id}`"
      >
        <div class="flex items-baseline gap-2">
          <span class="font-mono text-text-secondary" translate="no">{{ proposal.id }}</span>
          <span class="min-w-0 flex-1 truncate text-label" :title="proposal.command">{{ proposal.edit.title }}</span>
          <span class="text-text-secondary">{{ $t(BY[proposal.by]) }}</span>
        </div>
        <ul class="m-0 list-none p-0 font-mono tabular-nums" :aria-label="$t('palette-operations')">
          <li v-for="(op, index) in proposal.edit.ops" :key="index" class="flex gap-2">
            <span class="min-w-0 flex-1 truncate" :title="opText(op)" :translate="dataOp(op) ? 'no' : undefined">{{
              opText(op)
            }}</span>
            <span
              :class="opShown(op) === 'card' ? 'text-text-secondary' : 'text-text-primary'"
              data-testid="lab-proposal-op-shown"
              >{{ $t(SHOWN[opShown(op)]) }}</span
            >
          </li>
        </ul>
        <div v-if="layoutOf(proposal.id) !== null" class="flex flex-col gap-0.5" data-testid="lab-proposal-layout">
          <span
            v-for="check in layoutOf(proposal.id)?.breaks ?? []"
            :key="`b-${check.id}`"
            class="truncate font-mono text-status-caution"
            :title="checkLine(check)"
            data-testid="lab-proposal-breaks"
            >{{
              $t("palette-proposal-breaks", { id: check.id, value: checkValue(check), limit: String(check.limit) })
            }}</span
          >
          <span
            v-for="check in layoutOf(proposal.id)?.mends ?? []"
            :key="`m-${check.id}`"
            class="truncate font-mono text-text-secondary"
            :title="checkLine(check)"
            >{{ $t("palette-proposal-mends", { id: check.id }) }}</span
          >
          <span v-if="unchanged(proposal.id)" class="text-text-secondary">{{
            $t("palette-proposal-no-change", { summary: layoutOf(proposal.id)?.report.summary ?? "" })
          }}</span>
        </div>
        <div class="flex gap-1">
          <button
            type="button"
            :class="button"
            data-testid="lab-proposal-accept"
            :aria-label="$t('palette-proposal-accept-label', { id: proposal.id })"
            @click="emit('accept', proposal.id)"
          >
            {{ $t("palette-proposal-accept") }}
          </button>
          <button
            type="button"
            :class="button"
            data-testid="lab-proposal-reject"
            :aria-label="$t('palette-proposal-reject-label', { id: proposal.id })"
            @click="emit('reject', proposal.id)"
          >
            {{ $t("palette-proposal-reject") }}
          </button>
        </div>
      </li>
    </ol>
    <div class="flex gap-1">
      <button type="button" :class="button" data-testid="lab-proposals-accept-all" @click="emit('acceptAll')">
        {{ $t("palette-proposals-accept-all") }}
      </button>
      <button type="button" :class="button" data-testid="lab-proposals-reject-all" @click="emit('rejectAll')">
        {{ $t("palette-proposals-reject-all") }}
      </button>
    </div>
  </section>
</template>
