<!-- SPDX-License-Identifier: Apache-2.0 -->
<script setup lang="ts">
/**
 * The check of a change set in the Review panel: Check gives the rules line (the rules of the project on the scene
 * after the change sets of the session) and the Before and After pictures of the view camera (the task gate of the
 * page, taskGate.ts). The diff shows the change set as the semantic diff view of the Version control panel.
 */
import { useI18n } from "@scenity/i18n";
import type { ComponentRegistry } from "@scenity/scene/components";
import type { SceneDocument } from "@scenity/scene/schema/documents";
import type { ChangeSet } from "@scenity/editor-core";
import { computed, onBeforeUnmount, ref, toRaw } from "vue";
import SemanticDiff from "../diff/SemanticDiff.vue";
import { entityDiff } from "../diff/semanticDiff";
import type { PageOp } from "../hierarchy/sceneCommands";
import { proposedDoc } from "./reviewModel";
import { pageTaskGate } from "./taskGate";

const props = defineProps<{
  set: ChangeSet<PageOp>;
  doc: () => SceneDocument;
  registry: ComponentRegistry;
  select: (ids: readonly string[]) => void;
}>();
const { $t } = useI18n();
const busy = ref(false);
const rules = ref<{ passed: boolean; message: string } | null>(null);
const pictures = ref<string[]>([]);
const session = computed(() => props.set.actor.session ?? null);
// The registry has private fields: a reactive proxy of it cannot read them.
const diff = computed(() =>
  entityDiff(props.doc(), proposedDoc(props.doc(), toRaw(props.set), toRaw(props.registry)) ?? props.doc()),
);

function forget(): void {
  for (const url of pictures.value) URL.revokeObjectURL(url);
  pictures.value = [];
}
onBeforeUnmount(forget);

async function check(): Promise<void> {
  const gate = pageTaskGate();
  if (gate === null || session.value === null) return;
  busy.value = true;
  try {
    const answer = await gate.gate(session.value);
    rules.value = { passed: answer.passed, message: answer.message };
    const frames = await gate.frames(session.value);
    forget();
    pictures.value = frames.map((frame) => URL.createObjectURL(new Blob([frame.bytes], { type: frame.mime })));
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div class="flex flex-col gap-1 px-2 py-1" data-testid="review-check-set">
    <div class="flex items-center gap-2">
      <button
        v-if="session !== null"
        type="button"
        class="rounded-control border border-border-subtle px-1.5 py-0.5 hover:bg-surface-raised disabled:opacity-50"
        :disabled="busy"
        data-testid="review-check-run"
        @click="check"
      >
        {{ busy ? $t("review-checking") : $t("review-check-run") }}
      </button>
      <p
        v-if="rules !== null"
        class="m-0 min-w-0 flex-1 truncate"
        :class="rules.passed ? 'text-status-positive' : 'text-status-negative'"
        :data-passed="rules.passed ? '1' : '0'"
        :title="rules.message"
        data-testid="review-rules"
      >
        {{ rules.passed ? $t("review-rules-pass") : $t("review-rules-fail") }} · {{ rules.message }}
      </p>
    </div>
    <div v-if="pictures.length === 2" class="grid grid-cols-2 gap-1" data-testid="review-pictures">
      <figure v-for="(url, at) in pictures" :key="url" class="m-0 flex flex-col gap-0.5">
        <img :src="url" :alt="$t(at === 0 ? 'review-before' : 'review-after')" class="w-full rounded-control" />
        <figcaption class="text-caption text-text-secondary">
          {{ $t(at === 0 ? "review-before" : "review-after") }}
        </figcaption>
      </figure>
    </div>
    <details data-testid="review-diff">
      <summary class="cursor-default text-caption text-text-secondary">{{ $t("review-diff") }}</summary>
      <SemanticDiff :diff="diff" :select="(id: string) => select([id])" />
    </details>
  </div>
</template>
