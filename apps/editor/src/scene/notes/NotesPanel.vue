<!-- SPDX-License-Identifier: Apache-2.0 -->
<script setup lang="ts">
/**
 * The Notes panel: the notes of the scene, from its note file and from its note entities. It has a filter (all, open,
 * done, none), and the pins of the Scene view follow the filter. A press on a note selects its entity. Done and Open
 * change the status. Remove deletes a file note. Send asks the agent of the window. Add puts a new note on the
 * selected entity, or at the target of the view with no selection.
 */
import { useI18n } from "@scenity/i18n";
import { Select } from "@scenity/ui";
import { computed, inject, onBeforeUnmount, ref } from "vue";
import { PANEL_VISIBLE_KEY } from "../../studio/shell/panelState";
import { button, field } from "../inspector/inspectorUi";
import { NOTE_FILTERS, shownBy, type NoteFilter, type NoteItem, type PageNotes } from "./pageNotes";

const props = defineProps<{
  notes: PageNotes;
  items: { readonly value: readonly NoteItem[] };
  press(item: NoteItem): void;
  /** Add a note with a text on the selection or at the view; the reason of a refusal, or null. */
  add(text: string): Promise<string | null>;
  /** Reply in the thread of a note of the file; the reason of a refusal, or null. */
  reply(id: string, text: string): Promise<string | null>;
  /** Change the status of a note entity (a command of the scene). */
  setEntityStatus(id: string, status: "open" | "done"): void;
  /** Ask the agent of the window, or null. */
  ask: () => ((text: string) => void) | null;
}>();
const { $t } = useI18n();

const filter = computed({
  get: () => props.notes.filter.value,
  set: (value: string) => props.notes.setFilter(value as NoteFilter),
});
const filterOptions = computed(() => NOTE_FILTERS.map((value) => ({ value, label: $t(`notes-filter-${value}`) })));
const shown = computed(() =>
  props.items.value.filter((item) => props.notes.filter.value === "none" || shownBy(props.notes.filter.value, item)),
);
const text = ref("");
const reason = ref<string | null>(null);
const asker = computed(() => props.ask());
// The thread that shows (the key of its note), and the text of a new reply.
const thread = ref<string | null>(null);
const answer = ref("");
const visible = inject(PANEL_VISIBLE_KEY, null);
// The other people of the team can add replies: the panel reads the note file again while it shows.
const timer = setInterval(() => {
  if (visible?.value !== false) void props.notes.load();
}, 5000);
onBeforeUnmount(() => {
  clearInterval(timer);
});
const when = (at: string): string =>
  new Date(at).toLocaleString(document.documentElement.lang || undefined, { dateStyle: "short", timeStyle: "short" });

async function onReply(item: NoteItem): Promise<void> {
  const value = answer.value.trim();
  if (value === "") return;
  reason.value = await props.reply(item.id, value);
  if (reason.value === null) answer.value = "";
}

async function onAdd(): Promise<void> {
  const value = text.value.trim();
  if (value === "") return;
  reason.value = await props.add(value);
  if (reason.value === null) text.value = "";
}

function toggle(item: NoteItem): void {
  const next = item.status === "open" ? "done" : "open";
  if (item.kind === "file") void props.notes.setStatus(item.id, next);
  else props.setEntityStatus(item.id, next);
}
</script>

<template>
  <section
    class="flex h-full min-h-0 flex-col gap-1 p-1 text-caption"
    :aria-label="$t('panel-notes')"
    data-testid="notes-panel"
  >
    <div class="flex items-center gap-1">
      <Select v-model="filter" :options="filterOptions" class="w-32" :aria-label="$t('notes-filter')" />
      <span class="text-text-secondary" data-testid="notes-count">{{
        $t("notes-count", { count: items.value.length })
      }}</span>
    </div>
    <div class="flex gap-1">
      <input
        v-model="text"
        type="text"
        :class="field"
        :placeholder="$t('notes-new')"
        :aria-label="$t('notes-new')"
        data-testid="notes-new-text"
        @keydown.enter="onAdd"
      />
      <button type="button" :class="button" data-testid="notes-add" @click="onAdd">{{ $t("notes-add") }}</button>
    </div>
    <p v-if="reason !== null || notes.error.value !== null" class="text-text-secondary" role="alert">
      {{ reason ?? notes.error.value }}
    </p>
    <ul class="min-h-0 flex-1 overflow-auto">
      <li
        v-for="item in shown"
        :key="item.key"
        class="flex flex-col border-b border-border-subtle py-0.5"
        :data-note="item.key"
        :data-status="item.status"
        data-testid="notes-row"
      >
        <div class="flex items-center gap-1">
          <button
            type="button"
            class="min-w-0 flex-1 truncate text-left hover:underline"
            :title="item.text"
            @click="press(item)"
          >
            <span :class="item.status === 'done' && 'line-through text-text-secondary'" translate="no">{{
              item.text
            }}</span>
            <span v-if="item.entity !== null" class="text-text-secondary" translate="no"> · {{ item.entity }}</span>
          </button>
          <button type="button" :class="button" data-testid="notes-toggle" @click="toggle(item)">
            {{ item.status === "open" ? $t("notes-done") : $t("notes-open") }}
          </button>
          <button
            v-if="asker !== null"
            type="button"
            :class="button"
            data-testid="notes-send"
            @click="
              asker(
                item.entity === null ? item.text : $t('notes-send-prompt', { text: item.text, entity: item.entity }),
              )
            "
          >
            {{ $t("notes-send") }}
          </button>
          <button
            v-if="item.kind === 'file'"
            type="button"
            :class="button"
            data-testid="notes-remove"
            @click="notes.remove(item.id)"
          >
            {{ $t("notes-remove") }}
          </button>
          <button
            v-if="item.kind === 'file'"
            type="button"
            :class="button"
            :aria-expanded="thread === item.key"
            data-testid="notes-thread"
            @click="thread = thread === item.key ? null : item.key"
          >
            {{ $t("notes-thread", { count: item.replies.length }) }}
          </button>
        </div>
        <div v-if="thread === item.key" class="flex flex-col gap-0.5 pl-3" data-testid="notes-replies">
          <p v-for="(each, at) in item.replies" :key="at" class="m-0" data-testid="notes-reply">
            <span class="font-medium" translate="no">{{ each.author ?? $t("notes-reply-anonymous") }}</span>
            <span class="text-text-secondary"> · {{ when(each.at) }} · </span>
            <span translate="no">{{ each.text }}</span>
          </p>
          <div class="flex gap-1">
            <input
              v-model="answer"
              type="text"
              :class="field"
              :placeholder="$t('notes-reply')"
              :aria-label="$t('notes-reply')"
              data-testid="notes-reply-text"
              @keydown.enter="onReply(item)"
            />
            <button type="button" :class="button" data-testid="notes-reply-send" @click="onReply(item)">
              {{ $t("notes-reply-send") }}
            </button>
          </div>
        </div>
      </li>
    </ul>
  </section>
</template>
