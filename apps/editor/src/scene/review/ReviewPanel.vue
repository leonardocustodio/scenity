<!-- SPDX-License-Identifier: Apache-2.0 -->
<script setup lang="ts">
/**
 * The Review panel: each change set that waits, with its session, its title and Preview. The panel also shows its ops
 * by entity, each with ＋ ~ − and the old and new value. A check box chooses an op or all ops of an entity. ✓ accepts
 * and ✕ rejects an op, an entity or the set. "Accept checked" applies the checked ops as one
 * step of the history. On a check box ↩ accepts, ⌫ rejects, ↑ ↓ move. A row selects its entity.
 */
import { computed, ref } from "vue";
import { useI18n } from "@scenity/i18n";
import { Button, Switch } from "@scenity/ui";
import { Check, X } from "lucide-vue-next";
import type { ChangeSet } from "@scenity/editor-core";
import type { SceneDocument } from "@scenity/scene/schema/documents";
import { actorColour } from "../actorColour";
import type { PageOp } from "../hierarchy/sceneCommands";
import { reviewSet, type ReviewRow } from "./reviewModel";
import type { ReviewState } from "./reviewState";
import type { ReviewPreview } from "./startReview";
import EmptyState from "../../studio/shell/EmptyState.vue";
import type { ComponentRegistry } from "@scenity/scene/components";
import ReviewCheck from "./ReviewCheck.vue";

const props = defineProps<{
  review: ReviewState;
  doc: () => SceneDocument;
  select: (ids: readonly string[]) => void;
  /** The change set in Preview, and its switch. */
  preview: ReviewPreview;
  /** The components of the page (the diff of a change set). */
  registry: ComponentRegistry;
}>();
const { $t } = useI18n();
const error = ref<string | null>(null);
const previewKey = computed(() => props.preview.key.value);
const MARKS = { added: "＋", removed: "−", changed: "~", moved: "~" } as const;

const sets = computed(() => props.review.sets.value.map((set) => ({ set, view: reviewSet(set, props.doc()) })));
const unchecked = computed(() => props.review.unchecked.value);
const checkedCount = (set: ChangeSet<PageOp>): number => {
  const reads = [unchecked.value];
  return reads.length > 0 ? props.review.checked(set).length : 0;
};

function accept(set: ChangeSet<PageOp>, keys: readonly string[]): void {
  if (keys.length === 0) return;
  error.value = props.review.accept(set, keys);
}

function reject(set: ChangeSet<PageOp>, keys: readonly string[]): void {
  if (keys.length > 0) props.review.reject(set, keys);
}

const rowKeys = (row: ReviewRow): string[] => row.ops.map((op) => op.key);
const allChecked = (keys: readonly string[]): boolean => keys.every((key) => !unchecked.value.has(key));

function togglePreview(key: string, on: boolean): void {
  props.preview.set(on ? key : null);
}

/** ↩ accepts, ⌫ rejects, ↑ ↓ move between the check boxes. */
function onKey(event: KeyboardEvent, set: ChangeSet<PageOp>, keys: readonly string[]): void {
  if (event.key === "Enter") accept(set, keys);
  else if (event.key === "Backspace" || event.key === "Delete") reject(set, keys);
  else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
    const boxes = [...document.querySelectorAll<HTMLInputElement>('[data-testid="review-check"]')];
    const at = boxes.indexOf(event.target as HTMLInputElement);
    boxes[at + (event.key === "ArrowDown" ? 1 : -1)]?.focus();
  } else return;
  event.preventDefault();
}
</script>

<template>
  <section
    class="flex h-full min-h-0 flex-col text-caption"
    :aria-label="$t('panel-review')"
    data-testid="review-panel"
  >
    <EmptyState v-if="sets.length === 0" panel="review" :text="$t('review-empty')" />
    <p v-if="error !== null" class="px-2 text-status-negative" role="alert">{{ error }}</p>
    <div class="min-h-0 flex-1 overflow-auto">
      <article
        v-for="{ set, view } in sets"
        :key="set.key"
        class="border-b border-border-subtle"
        data-testid="review-set"
        :data-set="set.key"
      >
        <header class="flex flex-wrap items-center gap-2 px-2 py-1">
          <span
            class="size-2 flex-none rounded-full"
            :style="{ background: actorColour(set.actor) }"
            aria-hidden="true"
          />
          <strong class="min-w-0 truncate">{{ set.actor.name ?? $t(`activity-${set.actor.kind}`) }}</strong>
          <span v-if="set.actor.turn !== undefined" class="text-text-secondary">
            {{ $t("review-turn", { turn: set.actor.turn }) }}
          </span>
          <span class="min-w-0 flex-1 truncate">{{ set.title }}</span>
          <span class="flex items-center gap-1">
            <Switch
              :model-value="previewKey === set.key"
              :aria-label="$t('review-preview')"
              data-testid="review-preview"
              @update:model-value="(on: boolean) => togglePreview(set.key, on)"
            />
            <span aria-hidden="true">{{ $t("review-preview") }}</span>
          </span>
        </header>
        <!-- The rules line, the Before and After pictures, and the semantic diff of the set. -->
        <ReviewCheck :set="set" :doc="doc" :registry="registry" :select="select" />
        <ul :aria-label="$t('review-changes')">
          <li
            v-for="row in view.rows"
            :key="row.entity ?? '#doc'"
            data-testid="review-row"
            :data-entity="row.entity ?? ''"
          >
            <div class="flex items-center gap-2 px-2 py-0.5 hover:bg-surface-sunken">
              <input
                type="checkbox"
                :checked="allChecked(rowKeys(row))"
                :aria-label="$t('review-check-entity', { name: row.name || $t('review-document') })"
                data-testid="review-check"
                @change="review.toggle(rowKeys(row), ($event.target as HTMLInputElement).checked)"
                @keydown="onKey($event, set, rowKeys(row))"
              />
              <span class="w-4 flex-none text-center" :title="$t(`review-change-${row.change}`)">{{
                MARKS[row.change]
              }}</span>
              <button
                type="button"
                class="min-w-0 flex-1 truncate text-left"
                :disabled="row.entity === null"
                data-testid="review-entity"
                @click="row.entity !== null && select([row.entity])"
              >
                {{ row.name || $t("review-document") }}
              </button>
              <button
                type="button"
                class="flex min-h-6 min-w-6 items-center justify-center rounded-control hover:bg-surface-overlay"
                :aria-label="$t('review-accept-entity', { name: row.name })"
                data-testid="review-accept-entity"
                @click="accept(set, rowKeys(row))"
              >
                <Check class="size-icon-sm" aria-hidden="true" />
              </button>
              <button
                type="button"
                class="flex min-h-6 min-w-6 items-center justify-center rounded-control hover:bg-surface-overlay"
                :aria-label="$t('review-reject-entity', { name: row.name })"
                data-testid="review-reject-entity"
                @click="reject(set, rowKeys(row))"
              >
                <X class="size-icon-sm" aria-hidden="true" />
              </button>
            </div>
            <ul class="pl-8">
              <li
                v-for="op in row.ops"
                :key="op.key"
                class="flex items-center gap-2 py-0.5 pr-2"
                data-testid="review-op"
                :data-op="op.key"
              >
                <input
                  type="checkbox"
                  :checked="!unchecked.has(op.key)"
                  :aria-label="$t('review-check-op', { field: op.field || row.name })"
                  data-testid="review-check"
                  @change="review.toggle([op.key], ($event.target as HTMLInputElement).checked)"
                  @keydown="onKey($event, set, [op.key])"
                />
                <span class="w-40 flex-none truncate text-text-secondary" translate="no">{{
                  op.field || $t(`review-change-${op.change}`)
                }}</span>
                <span class="min-w-0 flex-1 truncate" translate="no">
                  <span class="text-text-secondary">{{ op.before }}</span> → <span>{{ op.after }}</span>
                </span>
                <span
                  v-if="review.conflicts.value.has(op.key)"
                  class="flex-none text-status-caution"
                  :title="$t('review-conflict-title')"
                  data-testid="review-conflict"
                  >{{ $t("review-conflict") }}</span
                >
                <button
                  type="button"
                  class="flex min-h-6 min-w-6 items-center justify-center rounded-control hover:bg-surface-overlay"
                  :aria-label="$t('review-accept-op')"
                  data-testid="review-accept-op"
                  @click="accept(set, [op.key])"
                >
                  <Check class="size-icon-sm" aria-hidden="true" />
                </button>
                <button
                  type="button"
                  class="flex min-h-6 min-w-6 items-center justify-center rounded-control hover:bg-surface-overlay"
                  :aria-label="$t('review-reject-op')"
                  data-testid="review-reject-op"
                  @click="reject(set, [op.key])"
                >
                  <X class="size-icon-sm" aria-hidden="true" />
                </button>
              </li>
            </ul>
          </li>
        </ul>
        <footer class="flex flex-wrap items-center gap-2 px-2 py-1">
          <Button size="sm" data-testid="review-reject-all" @click="reject(set, view.keys)">{{
            $t("review-reject-all")
          }}</Button>
          <span class="flex-1" />
          <Button size="sm" data-testid="review-accept-checked" @click="accept(set, review.checked(set))">
            {{ $t("review-accept-checked", { count: checkedCount(set) }) }}
          </Button>
          <Button size="sm" variant="primary" data-testid="review-accept-all" @click="accept(set, view.keys)">
            {{ $t("review-accept-all") }}
          </Button>
        </footer>
      </article>
    </div>
  </section>
</template>
