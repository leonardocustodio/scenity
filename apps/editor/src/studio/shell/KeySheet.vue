<!-- SPDX-License-Identifier: Apache-2.0 -->
<script setup lang="ts">
/**
 * The key sheet: each key of the key map by its context, also the held keys and the modal keys, with a filter. The
 * rows come from the key map of the page when the sheet opens.
 */
import { computed, ref, shallowRef, watch } from "vue";
import { useI18n } from "@scenity/i18n";
import { Dialog } from "@scenity/ui";
import { keyGroups, type KeyRow, type WindowKeySheet } from "./keySheet";

const props = defineProps<{ sheet: WindowKeySheet; rows: () => readonly KeyRow[] }>();
const { $t } = useI18n();
const filter = ref("");
const all = shallowRef<readonly KeyRow[]>([]);
watch(
  () => props.sheet.state.open,
  (open) => {
    if (!open) return;
    filter.value = "";
    all.value = props.rows();
  },
);
const groups = computed(() => keyGroups(all.value, filter.value));
const contextLabel = (context: string): string => $t(`keys-context-${context}`);
</script>

<template>
  <Dialog
    :open="props.sheet.state.open"
    :title="$t('keys-title')"
    @update:open="$event ? props.sheet.open() : props.sheet.close()"
  >
    <div class="flex max-h-[70vh] flex-col gap-3" data-testid="key-sheet">
      <input
        v-model="filter"
        type="search"
        class="min-h-9 rounded-control border border-border-strong bg-surface-raised px-2"
        :aria-label="$t('keys-filter')"
        :placeholder="$t('keys-filter')"
        data-testid="key-sheet-filter"
      />
      <div class="overflow-auto">
        <section v-for="group in groups" :key="group.context" class="mb-3" :data-context="group.context">
          <h3 class="mb-1 text-label font-semibold">{{ contextLabel(group.context) }}</h3>
          <table class="w-full text-label">
            <tbody>
              <tr
                v-for="row in group.rows"
                :key="row.id"
                :data-testid="`key-sheet-row-${row.id}`"
                :data-kind="row.keyKind"
              >
                <td class="py-0.5 pr-2">{{ row.label }}</td>
                <td class="text-right whitespace-nowrap">
                  <kbd
                    v-for="key in row.keys"
                    :key="key"
                    translate="no"
                    class="ml-1 rounded-control border border-border-subtle px-1"
                    >{{ key }}</kbd
                  >
                  <span v-if="row.keyKind !== 'press'" class="ml-1 text-caption text-text-secondary">{{
                    $t(`keys-kind-${row.keyKind}`)
                  }}</span>
                </td>
              </tr>
            </tbody>
          </table>
        </section>
      </div>
    </div>
  </Dialog>
</template>
