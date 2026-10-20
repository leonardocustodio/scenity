<!-- SPDX-License-Identifier: Apache-2.0 -->
<script setup lang="ts">
/**
 * The rules editor: the file of the rule (the scene, the sequence, the project file, a rules file or a new one), its
 * ID, the metric picker with the fields of its arguments (ruleForm.ts), the limits, the level, provisional, the note
 * and the scope. Save writes the rule into its file (ruleTargets.ts), and Remove removes it from the file. Thus a
 * person makes a rule with no text editor.
 */
import { useI18n } from "@scenity/i18n";
import type { Rule } from "@scenity/scene";
import { Button } from "@scenity/ui";
import { createMetricRegistry } from "@scenity/rules";
import { computed, onMounted, ref, shallowRef } from "vue";
import { draftOf, emptyDraft, metricChoices, ruleOf, SCOPE_KINDS, type RuleDraft } from "./ruleForm";
import { ruleTargets, rulesOf, withRule, writeRules, type RuleTarget, type RuleWriterParts } from "./ruleTargets";

const props = defineProps<{
  parts: RuleWriterParts;
  /** The rule to edit and its file, or null for a new rule. */
  editing: { readonly file: string; readonly rule: Rule } | null;
  /** The draft of a new rule ("Save as a rule"), or null. */
  initial?: RuleDraft | null;
}>();
const emit = defineEmits<{ done: [id: string | null]; cancel: [] }>();
const { $t } = useI18n();

const NEW_FILE = "*new";
/** The metrics of the picker: the built-in metrics, then the metrics of the plugins of the project. */
const choices = shallowRef(metricChoices());
onMounted(async () => {
  const project = /\/projects\/([a-z0-9-]+)\/$/.exec(props.parts.base)?.[1];
  if (project === undefined) return;
  const plugins = await import("./pluginMetrics").then(
    (chunk) => chunk.pluginMetrics(project),
    () => [],
  );
  if (plugins.length > 0) choices.value = metricChoices(createMetricRegistry(plugins).describe());
});
const targets = ruleTargets(props.parts);
const target = ref(props.editing?.file ?? targets[0]?.file ?? "");
const newFile = ref(`rules/${props.parts.editor.doc.id}.rules.json`);
const draft = ref<RuleDraft>(
  props.editing !== null ? draftOf(props.editing.rule) : (props.initial ?? emptyDraft(choices.value[0]?.id ?? "")),
);
const reason = ref<string | null>(null);
const choice = computed(() => choices.value.find((each) => each.id === draft.value.metric) ?? null);
const entities = computed(() => Object.keys(props.parts.editor.doc.entities));
const tags = computed(() => [
  ...new Set(Object.values(props.parts.editor.doc.entities).flatMap((entity) => entity.tags ?? [])),
]);

function setArg(name: string, value: string): void {
  draft.value = { ...draft.value, args: { ...draft.value.args, [name]: value } };
}
function set<K extends keyof RuleDraft>(key: K, value: RuleDraft[K]): void {
  draft.value = { ...draft.value, [key]: value };
}

/** The file of the form: a known file, or a new rules file. */
function targetNow(): RuleTarget {
  if (target.value === NEW_FILE) return { kind: "file", file: newFile.value.trim() };
  return targets.find((each) => each.file === target.value) ?? { kind: "scene", file: target.value };
}

async function save(): Promise<void> {
  if (choice.value === null) return;
  const made = ruleOf(draft.value, choice.value);
  if (!made.ok) {
    reason.value = $t("rules-edit-bad", { where: made.reason });
    return;
  }
  const to = targetNow();
  const moved = props.editing !== null && props.editing.file !== to.file;
  const list = withRule(rulesOf(props.parts, to), made.rule, moved ? null : (props.editing?.rule.id ?? null));
  if (typeof list === "string") {
    reason.value = list;
    return;
  }
  const failed = await writeRules(props.parts, to, list);
  if (failed === null && moved) await remove(false);
  reason.value = failed;
  if (failed === null) emit("done", made.rule.id);
}

/** Remove the rule from its file. */
async function remove(done = true): Promise<void> {
  const old = props.editing;
  if (old === null) return;
  const from = targets.find((each) => each.file === old.file);
  if (from === undefined) return;
  const failed = await writeRules(
    props.parts,
    from,
    rulesOf(props.parts, from).filter((rule) => rule.id !== old.rule.id),
  );
  reason.value = failed;
  if (failed === null && done) emit("done", null);
}

const input = "h-7 rounded-control border border-border-subtle bg-surface-sunken px-1.5 text-caption text-text-primary";
const row = "flex items-center gap-1";
const label = "w-24 shrink-0";
</script>

<template>
  <form
    class="flex min-w-0 flex-col gap-1 overflow-auto text-caption"
    :aria-label="$t('rules-edit')"
    data-testid="rule-editor"
    @submit.prevent="save"
  >
    <label :class="row" for="rule-target">
      <span :class="label">{{ $t("rules-edit-file") }}</span>
      <select id="rule-target" v-model="target" :class="[input, 'min-w-0 flex-1 font-mono']" data-testid="rule-target">
        <option v-for="each in targets" :key="each.file" :value="each.file" translate="no">{{ each.file }}</option>
        <option :value="NEW_FILE">{{ $t("rules-edit-new-file") }}</option>
      </select>
    </label>
    <label v-if="target === NEW_FILE" :class="row" for="rule-new-file">
      <span :class="label">{{ $t("rules-edit-new-path") }}</span>
      <input id="rule-new-file" v-model="newFile" :class="[input, 'flex-1 font-mono']" data-testid="rule-new-file" />
    </label>
    <label :class="row" for="rule-id">
      <span :class="label">{{ $t("rules-edit-id") }}</span>
      <input
        id="rule-id"
        :value="draft.id"
        :class="[input, 'w-40 font-mono']"
        :placeholder="$t('rules-edit-id-sample')"
        data-testid="rule-id"
        @input="set('id', ($event.target as HTMLInputElement).value)"
      />
    </label>
    <label :class="row" for="rule-metric">
      <span :class="label">{{ $t("rules-edit-metric") }}</span>
      <select
        id="rule-metric"
        :value="draft.metric"
        :class="[input, 'min-w-0 flex-1']"
        data-testid="rule-metric"
        @change="set('metric', ($event.target as HTMLSelectElement).value)"
      >
        <option v-for="each in choices" :key="each.id" :value="each.id" translate="no">
          {{ each.label }} ({{ each.id }}{{ each.plugin === null ? "" : `, ${each.plugin}` }})
        </option>
      </select>
    </label>
    <datalist id="rule-entities">
      <option v-for="id in entities" :key="id" :value="id" />
      <option v-for="tag in tags" :key="`tag:${tag}`" :value="`tag:${tag}`" />
    </datalist>
    <datalist id="rule-entity-refs">
      <option v-for="id in entities" :key="id" :value="`entity:${id}`" />
    </datalist>
    <fieldset class="flex flex-col gap-1 border-l border-border-subtle pl-2">
      <legend class="sr-only">{{ $t("rules-edit-args") }}</legend>
      <label
        v-for="field in choice?.fields ?? []"
        :key="field.name"
        :class="row"
        :title="field.description"
        :for="`rule-arg-${field.name}`"
      >
        <span :class="[label, 'font-mono']" translate="no">{{ field.name }}{{ field.required ? " *" : "" }}</span>
        <select
          v-if="field.kind === 'choice'"
          :id="`rule-arg-${field.name}`"
          :value="draft.args[field.name] ?? field.fallback"
          :class="input"
          :data-testid="`rule-arg-${field.name}`"
          @change="setArg(field.name, ($event.target as HTMLSelectElement).value)"
        >
          <option v-for="each in field.choices" :key="each" :value="each" translate="no">{{ each }}</option>
        </select>
        <input
          v-else-if="field.kind === 'boolean'"
          :id="`rule-arg-${field.name}`"
          type="checkbox"
          :checked="(draft.args[field.name] ?? field.fallback) === 'true'"
          :data-testid="`rule-arg-${field.name}`"
          @change="setArg(field.name, String(($event.target as HTMLInputElement).checked))"
        />
        <input
          v-else
          :id="`rule-arg-${field.name}`"
          :value="draft.args[field.name] ?? ''"
          :placeholder="field.fallback"
          :list="field.entityRef ? 'rule-entity-refs' : field.kind === 'selector' ? 'rule-entities' : undefined"
          :class="[input, 'min-w-0 flex-1 font-mono']"
          :data-testid="`rule-arg-${field.name}`"
          @input="setArg(field.name, ($event.target as HTMLInputElement).value)"
        />
      </label>
    </fieldset>
    <div :class="row">
      <label class="flex items-center gap-1" for="rule-min">
        <span>{{ $t("rules-edit-min") }}</span>
        <input
          id="rule-min"
          :value="draft.min"
          :class="[input, 'w-20']"
          data-testid="rule-min"
          @input="set('min', ($event.target as HTMLInputElement).value)"
        />
      </label>
      <label class="flex items-center gap-1" for="rule-max">
        <span>{{ $t("rules-edit-max") }}</span>
        <input
          id="rule-max"
          :value="draft.max"
          :class="[input, 'w-20']"
          data-testid="rule-max"
          @input="set('max', ($event.target as HTMLInputElement).value)"
        />
      </label>
      <label class="flex items-center gap-1" for="rule-unit">
        <span>{{ $t("rules-edit-unit") }}</span>
        <input
          id="rule-unit"
          :value="draft.unit"
          :placeholder="choice?.unit"
          :class="[input, 'w-16']"
          data-testid="rule-unit"
          @input="set('unit', ($event.target as HTMLInputElement).value)"
        />
      </label>
    </div>
    <div :class="row">
      <label class="flex items-center gap-1" for="rule-level">
        <span>{{ $t("rules-edit-level") }}</span>
        <select
          id="rule-level"
          :value="draft.level"
          :class="input"
          data-testid="rule-level"
          @change="set('level', ($event.target as HTMLSelectElement).value as RuleDraft['level'])"
        >
          <option value="warn">{{ $t("rules-edit-level-warn") }}</option>
          <option value="block">{{ $t("rules-edit-level-block") }}</option>
        </select>
      </label>
      <label class="flex items-center gap-1" for="rule-provisional">
        <input
          id="rule-provisional"
          type="checkbox"
          :checked="draft.provisional"
          data-testid="rule-provisional"
          @change="set('provisional', ($event.target as HTMLInputElement).checked)"
        />
        {{ $t("rules-edit-provisional") }}
      </label>
    </div>
    <div :class="row">
      <label class="flex items-center gap-1" for="rule-scope">
        <span>{{ $t("rules-edit-scope") }}</span>
        <select
          id="rule-scope"
          :value="draft.scope"
          :class="input"
          data-testid="rule-scope"
          @change="set('scope', ($event.target as HTMLSelectElement).value as RuleDraft['scope'])"
        >
          <option value="">{{ $t("rules-edit-scope-default") }}</option>
          <option v-for="kind in SCOPE_KINDS" :key="kind" :value="kind">{{ $t(`rules-edit-scope-${kind}`) }}</option>
        </select>
      </label>
      <input
        v-if="draft.scope === 'range'"
        :value="draft.from"
        :aria-label="$t('rules-edit-from')"
        :placeholder="$t('rules-edit-from')"
        :class="[input, 'w-20']"
        data-testid="rule-from"
        @input="set('from', ($event.target as HTMLInputElement).value)"
      />
      <input
        v-if="draft.scope === 'range'"
        :value="draft.to"
        :aria-label="$t('rules-edit-to')"
        :placeholder="$t('rules-edit-to')"
        :class="[input, 'w-20']"
        data-testid="rule-to"
        @input="set('to', ($event.target as HTMLInputElement).value)"
      />
      <input
        v-if="draft.scope === 'range'"
        :value="draft.step"
        :aria-label="$t('rules-edit-step')"
        :placeholder="$t('rules-edit-step')"
        :class="[input, 'w-16']"
        data-testid="rule-step"
        @input="set('step', ($event.target as HTMLInputElement).value)"
      />
      <input
        v-if="draft.scope === 'marker'"
        :value="draft.marker"
        :aria-label="$t('rules-edit-marker')"
        :placeholder="$t('rules-edit-marker')"
        :class="[input, 'w-32']"
        data-testid="rule-marker"
        @input="set('marker', ($event.target as HTMLInputElement).value)"
      />
      <input
        v-if="draft.scope === 'entity'"
        :value="draft.entity"
        list="rule-entities"
        :aria-label="$t('rules-edit-entity')"
        :placeholder="$t('rules-edit-entity')"
        :class="[input, 'w-32 font-mono']"
        data-testid="rule-entity"
        @input="set('entity', ($event.target as HTMLInputElement).value)"
      />
    </div>
    <label class="flex flex-col gap-0.5" for="rule-note">
      {{ $t("rules-edit-note") }}
      <textarea
        id="rule-note"
        :value="draft.note"
        rows="2"
        class="rounded-control border border-border-subtle bg-surface-sunken p-1.5 text-text-primary"
        data-testid="rule-note"
        @input="set('note', ($event.target as HTMLTextAreaElement).value)"
      />
    </label>
    <p v-if="reason !== null" class="text-status-negative" role="alert">{{ reason }}</p>
    <div class="flex gap-1">
      <Button size="sm" variant="primary" type="submit" data-testid="rule-save">{{ $t("rules-edit-save") }}</Button>
      <Button v-if="editing !== null" size="sm" variant="ghost" data-testid="rule-remove" @click="remove()">
        {{ $t("rules-edit-remove") }}
      </Button>
      <Button size="sm" variant="ghost" data-testid="rule-cancel" @click="emit('cancel')">
        {{ $t("rules-edit-cancel") }}
      </Button>
    </div>
  </form>
</template>
