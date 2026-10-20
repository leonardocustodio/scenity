<!-- SPDX-License-Identifier: Apache-2.0 -->
<script setup lang="ts">
/**
 * A plan card of the transcript: the title, the steps with their ticks (☐ to do, ◐ doing, ☑ done, ⊘ skipped), the
 * files, the risks and the summary at the end. While the plan waits, the buttons are Approve, Edit (the steps as
 * lines, then Approve) and Deny. An approved plan names its file.
 */
import { computed, ref } from "vue";
import { useI18n } from "@scenity/i18n";
import { Button } from "@scenity/ui";
import { ListChecks } from "lucide-vue-next";
import type { AgentItem, ApprovalDecision } from "./agentClient";

const props = defineProps<{ item: Extract<AgentItem, { kind: "plan" }> }>();
const emit = defineEmits<{ answer: [decision: ApprovalDecision, steps?: readonly string[]] }>();
const { $t } = useI18n();
const editing = ref(false);
const text = ref("");
const MARKS = { todo: "☐", doing: "◐", done: "☑", skipped: "⊘" } as const;
const ticked = computed(() => props.item.steps.filter((step) => step.state === "done").length);

function edit(): void {
  text.value = props.item.steps.map((step) => step.text).join("\n");
  editing.value = true;
}

function approve(): void {
  const steps = editing.value
    ? text.value
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line !== "")
    : undefined;
  editing.value = false;
  emit("answer", "once", steps);
}
</script>

<template>
  <article
    class="rounded-control border border-border-strong px-2 py-1"
    data-testid="agent-plan"
    :data-decision="item.decision ?? 'waiting'"
  >
    <header class="flex items-center gap-2">
      <ListChecks class="size-icon-sm flex-none" aria-hidden="true" />
      <span class="min-w-0 flex-1 truncate font-medium">{{ item.title }}</span>
      <span class="flex-none text-text-secondary" data-testid="agent-plan-count">
        {{ $t("agent-plan-count", { done: ticked, total: item.steps.length }) }}
      </span>
    </header>
    <textarea
      v-if="editing"
      v-model="text"
      rows="5"
      class="mt-1 w-full rounded-control border border-border-strong bg-surface-raised p-1"
      :aria-label="$t('agent-plan-edit-steps')"
      data-testid="agent-plan-text"
    />
    <ol v-else class="mt-1" :aria-label="$t('agent-plan-steps')">
      <li
        v-for="(step, index) in item.steps"
        :key="index"
        class="flex gap-2"
        data-testid="agent-plan-step"
        :data-state="step.state"
      >
        <span aria-hidden="true">{{ MARKS[step.state] }}</span>
        <span :class="step.state === 'skipped' && 'line-through'">{{ step.text }}</span>
        <span class="sr-only">{{ $t(`agent-plan-${step.state}`) }}</span>
      </li>
    </ol>
    <p v-if="item.files.length > 0" class="mt-1 text-text-secondary">
      {{ $t("agent-plan-files", { list: item.files.join(", ") }) }}
    </p>
    <p v-if="item.risks.length > 0" class="text-status-caution">
      {{ $t("agent-plan-risks", { list: item.risks.join("; ") }) }}
    </p>
    <p v-if="item.summary !== null" class="mt-1" data-testid="agent-plan-summary">{{ item.summary }}</p>
    <div v-if="item.decision === null" class="mt-1 flex flex-wrap gap-1">
      <Button size="sm" variant="primary" data-testid="agent-plan-approve" @click="approve">
        {{ $t("agent-plan-approve") }}
      </Button>
      <Button v-if="!editing" size="sm" data-testid="agent-plan-edit" @click="edit">{{ $t("agent-plan-edit") }}</Button>
      <Button size="sm" data-testid="agent-plan-deny" @click="emit('answer', 'deny')">{{
        $t("agent-plan-deny")
      }}</Button>
    </div>
    <p v-else class="mt-1 text-text-secondary">
      {{
        item.decision === "approved" ? $t("agent-plan-approved", { path: item.path ?? "" }) : $t("agent-plan-denied")
      }}
    </p>
  </article>
</template>
