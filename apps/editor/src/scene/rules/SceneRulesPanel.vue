<!-- SPDX-License-Identifier: Apache-2.0 -->
<script setup lang="ts">
/**
 * The rules tab of the bottom dock of the scene page: the rules panel of the editor (core/rules/RulesPanel.vue) over
 * the rule check of the page core, and beside it the metric graph of the picked rule (core/rules/RuleGraph.vue). The
 * panel tells the state when it shows, so a hidden tab does not check. "New rule" and "Edit the rule" open the rules
 * editor (RuleEditor.vue) in the place of the graph.
 *
 * The texts are Fluent messages of `src/i18n/en-US/rules.ftl`.
 */
import { useI18n } from "@scenity/i18n";
import type { Rule } from "@scenity/scene";
import { Button } from "@scenity/ui";
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from "vue";
import RuleGraph from "../../core/rules/RuleGraph.vue";
import RulesPanel from "../../core/rules/RulesPanel.vue";
import RuleEditor from "./RuleEditor.vue";
import RulesLog from "./RulesLog.vue";
import { checkReport, differences, ruleStatuses } from "../problems/checkJob";
import type { RuleDraft } from "./ruleForm";
import { ruleRequest } from "./ruleRequest";
import { rulesOf, ruleTargets, type RuleWriterParts } from "./ruleTargets";
import { useSceneRules, type SceneRulesParts } from "./useSceneRules";

const { $t } = useI18n();
const props = defineProps<{ readonly parts: SceneRulesParts }>();
const state = useSceneRules(props.parts);
const { rows, busy, error, checks, selected, series, graphBusy, graphError, time } = state;

/** The rules editor: closed, a new rule, or a rule of a file. */
const writer: RuleWriterParts = { ...props.parts, base: props.parts.base ?? "" };
const editing = shallowRef<{ readonly file: string; readonly rule: Rule } | null | undefined>(undefined);
const pickedRule = computed(() => {
  const row = rows.value.find((each) => each.id === selected.value);
  const target = row === undefined ? undefined : ruleTargets(writer).find((each) => each.file === row.source);
  const rule = target === undefined ? undefined : rulesOf(writer, target).find((each) => each.id === row?.id);
  return target === undefined || rule === undefined ? null : { file: target.file, rule };
});
/** The rules of the scene whose status in the last check job differs from the page check. */
const compare = computed(() => {
  const report = checkReport.value;
  if (report === null) return null;
  const scene = props.parts.editor.file.path;
  return { count: ruleStatuses(report.rows, scene).size, differ: differences(report.rows, scene, rows.value) };
});

/** The draft of "Save as a rule" (a readout of a layout tool) for a new rule. */
const initial = shallowRef<RuleDraft | null>(null);
watch(
  ruleRequest,
  (request) => {
    if (request === null) return;
    initial.value = request.draft;
    editing.value = null;
  },
  { immediate: true },
);
function edited(id: string | null): void {
  editing.value = undefined;
  selected.value = id;
  state.recheck();
}

const root = ref<HTMLElement | null>(null);
let observer: IntersectionObserver | null = null;
onMounted(() => {
  if (root.value === null || typeof IntersectionObserver === "undefined") return;
  observer = new IntersectionObserver((entries) => {
    const entry = entries[entries.length - 1];
    if (entry !== undefined) state.setShown(entry.isIntersecting);
  });
  observer.observe(root.value);
});
onBeforeUnmount(() => observer?.disconnect());
</script>

<template>
  <section
    ref="root"
    class="flex min-h-0 gap-3 p-1.5 text-caption text-text-primary"
    :aria-label="$t('rules-tab')"
    data-testid="scene-rules"
    :data-checks="checks"
    :data-busy="busy ? '1' : '0'"
  >
    <div class="flex min-w-0 flex-1 flex-col gap-1">
      <div class="flex gap-1">
        <Button size="sm" data-testid="rules-new" @click="((initial = null), (editing = null))">{{
          $t("rules-edit-new")
        }}</Button>
        <Button
          size="sm"
          variant="ghost"
          :disabled="pickedRule === null"
          data-testid="rules-edit"
          @click="editing = pickedRule"
        >
          {{ $t("rules-edit-open") }}
        </Button>
      </div>
      <RulesPanel
        class="min-w-0 flex-1"
        :rows="rows"
        :selected="selected"
        :busy="busy"
        :error="error"
        @pick="state.pick"
      />
      <p
        v-if="compare !== null"
        :class="compare.differ.length === 0 ? 'text-status-positive' : 'text-status-caution'"
        :data-same="compare.differ.length === 0 ? '1' : '0'"
        data-testid="rules-cli-compare"
      >
        {{
          compare.differ.length === 0
            ? $t("check-compare-same", { count: compare.count })
            : $t("check-compare-differs", { rules: compare.differ.join(", ") })
        }}
      </p>
      <RulesLog v-if="parts.base !== undefined" :editor="parts.editor" :base="parts.base" />
    </div>
    <RuleEditor
      v-if="editing !== undefined"
      :key="
        editing === null ? `*new:${ruleRequest?.count ?? 0}:${initial === null}` : `${editing.file}:${editing.rule.id}`
      "
      class="w-[45%] shrink-0"
      :parts="writer"
      :editing="editing"
      :initial="initial"
      @done="edited"
      @cancel="editing = undefined"
    />
    <RuleGraph
      v-else
      class="w-[45%] shrink-0"
      :series="series"
      :time="time"
      :loading="graphBusy"
      :error="graphError"
      @seek="state.seek"
    />
  </section>
</template>
