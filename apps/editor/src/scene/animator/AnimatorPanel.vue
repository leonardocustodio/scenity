<!-- SPDX-License-Identifier: Apache-2.0 -->
<script setup lang="ts">
/**
 * The Animator window, a list editor of the `animator` component of an entity. It edits the parameters (with a preview
 * value: the value of the component, which the view shows immediately) and the layers (weight, blend). It also edits
 * the states of a layer (the clip, the start, a rename) and its transitions (from, to, the conditions as JSON, the exit
 * time, the crossfade). Each edit sets the controller as one step (animatorEdits.ts). The core gives the state that
 * each layer plays at the time of the clock (the inspect report). This state has a mark: the preview.
 */
import { useI18n } from "@scenity/i18n";
import type { AnimatorController } from "@scenity/scene/components";
import type { SceneDocument } from "@scenity/scene/schema/documents";
import { Select } from "@scenity/ui";
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, useId } from "vue";
import { usePanelVisible } from "../../studio/shell/panelState";
import { button, field } from "../inspector/inspectorUi";
import * as edits from "./animatorEdits";
import { motionWords } from "./animatorEdits";

const props = defineProps<{
  doc: { readonly value: SceneDocument };
  selected: { readonly value: readonly string[] };
  /** The state of each layer of each animator, and the clips of each model, at the time of the clock. */
  report(): Promise<{
    animators?: readonly { entity: string; layers: readonly { name: string; state: string }[] }[];
    entities: readonly { id: string; parts?: { clips?: readonly string[] } }[];
  } | null>;
  /** Run a command. Return the reason of a refusal, or null. */
  run(command: string, args: Readonly<Record<string, unknown>>): Promise<string | null>;
}>();
const { $t } = useI18n();
const visible = usePanelVisible();
const ids = { name: useId() };

const animated = computed(() =>
  Object.keys(props.doc.value.entities).filter((id) => props.doc.value.entities[id]?.components.animator !== undefined),
);
const picked = ref<string>("");
const entity = computed(() => {
  const selected = props.selected.value.find((id) => animated.value.includes(id));
  return selected ?? (animated.value.includes(picked.value) ? picked.value : (animated.value[0] ?? ""));
});
const value = computed(
  () =>
    props.doc.value.entities[entity.value]?.components.animator as
      { controller: AnimatorController; parameters?: Record<string, number | boolean> } | undefined,
);
const controller = computed(() => value.value?.controller ?? null);
const layerIndex = ref(0);
const layer = computed(() => controller.value?.layers[layerIndex.value] ?? null);

// The preview: the current state of each layer, and the clips of the model.
const active = shallowRef<Readonly<Record<string, string>>>({});
const clips = shallowRef<readonly string[]>([]);
let timer: ReturnType<typeof setInterval> | null = null;
async function refresh(): Promise<void> {
  if (!visible.value || entity.value === "") return;
  const report = await props.report();
  const found = report?.animators?.find((item) => item.entity === entity.value);
  active.value = Object.fromEntries((found?.layers ?? []).map((item) => [item.name, item.state]));
  clips.value = report?.entities.find((item) => item.id === entity.value)?.parts?.clips ?? [];
}
onMounted(() => {
  void refresh();
  timer = setInterval(() => void refresh(), 300);
});
onBeforeUnmount(() => {
  if (timer !== null) clearInterval(timer);
});

const reason = ref<string | null>(null);
/** Set the controller after an edit (one step); a refusal shows its words. */
async function edit(change: (now: AnimatorController) => AnimatorController): Promise<void> {
  const now = controller.value;
  if (now === null) return;
  try {
    const next = change(now);
    reason.value = await props.run("component.set", {
      entity: entity.value,
      component: "animator",
      field: "controller",
      value: JSON.stringify(next),
    });
  } catch (error) {
    reason.value = error instanceof Error ? error.message : String(error);
  }
}

/** The preview value of a parameter (the value of the component). */
async function setValue(name: string, next: number | boolean): Promise<void> {
  reason.value = await props.run("component.set", {
    ...{ entity: entity.value, component: "animator", field: `parameters.${name}` },
    value: JSON.stringify(next),
  });
}
const parameterValue = (name: string, fallback: number | boolean): number | boolean =>
  value.value?.parameters?.[name] ?? fallback;

const newParameter = ref("");
const newType = ref<"number" | "bool">("number");
const newState = ref("");
const newClip = ref("");
const newFrom = ref("*");
const newTo = ref("");
const states = computed(() => Object.keys(layer.value?.states ?? {}).sort());
const clipOptions = computed(() => clips.value.map((clip) => ({ value: clip, label: clip })));
const stateOptions = computed(() => states.value.map((name) => ({ value: name, label: name })));

// The actions of the template (a template does not call the module of the edits).
const removeParameter = (name: string) => edit((now) => edits.withoutParameter(now, name));
const addParameter = () => edit((now) => edits.withParameter(now, newParameter.value.trim(), newType.value));
const setStart = (name: string) => edit((now) => edits.withStart(now, layerIndex.value, name));
const removeState = (name: string) => edit((now) => edits.withoutState(now, layerIndex.value, name));
const addState = () => edit((now) => edits.withState(now, layerIndex.value, newState.value.trim(), newClip.value));
const removeTransition = (index: number) => edit((now) => edits.withoutTransition(now, layerIndex.value, index));

function addTransition(): void {
  const to = newTo.value || states.value[0];
  if (to === undefined) return;
  void edit((now) => edits.withTransition(now, layerIndex.value, { from: newFrom.value, to }));
}
function setConditions(index: number, text: string): void {
  try {
    const when = JSON.parse(text === "" ? "[]" : text) as edits.Condition[];
    void edit((now) => edits.withTransitionPatch(now, layerIndex.value, index, { when }));
  } catch {
    reason.value = $t("animator-conditions-json");
  }
}
</script>

<template>
  <section
    class="flex h-full min-h-0 flex-col gap-2 overflow-auto p-2 text-caption"
    :aria-label="$t('panel-animator')"
    :data-entity="entity"
    data-testid="animator-panel"
  >
    <p v-if="controller === null" class="text-text-secondary" data-testid="animator-empty">{{ $t("animator-none") }}</p>
    <template v-else>
      <Select
        v-if="animated.length > 1"
        :model-value="entity"
        :options="animated.map((id) => ({ value: id, label: doc.value.entities[id]?.name ?? id }))"
        class="w-48"
        :aria-label="$t('animator-entity')"
        @update:model-value="picked = String($event)"
      />
      <h3 class="font-semibold">{{ $t("animator-parameters") }}</h3>
      <ul class="flex flex-col gap-1">
        <li
          v-for="(parameter, name) in controller.parameters ?? {}"
          :key="name"
          class="flex items-center gap-1"
          :data-parameter="name"
          data-testid="animator-parameter"
        >
          <span class="w-24 truncate font-mono" translate="no">{{ name }}</span>
          <input
            v-if="parameter.type === 'bool'"
            type="checkbox"
            :checked="parameterValue(String(name), parameter.default) === true"
            :aria-label="$t('animator-preview', { name })"
            data-testid="animator-parameter-value"
            @change="setValue(String(name), ($event.target as HTMLInputElement).checked)"
          />
          <input
            v-else
            type="number"
            step="0.1"
            :class="[field, 'w-20']"
            :value="parameterValue(String(name), parameter.default)"
            :aria-label="$t('animator-preview', { name })"
            data-testid="animator-parameter-value"
            @change="setValue(String(name), Number(($event.target as HTMLInputElement).value))"
          />
          <button type="button" :class="button" @click="removeParameter(String(name))">×</button>
        </li>
      </ul>
      <div class="flex items-center gap-1">
        <input
          v-model="newParameter"
          :class="[field, 'w-28']"
          :aria-label="$t('animator-new-parameter')"
          data-testid="animator-new-parameter"
        />
        <select v-model="newType" :class="field" :aria-label="$t('animator-parameter-type')">
          <option value="number">{{ $t("animator-type-number") }}</option>
          <option value="bool">{{ $t("animator-type-bool") }}</option>
        </select>
        <button type="button" :class="button" data-testid="animator-add-parameter" @click="addParameter()">
          {{ $t("animator-add") }}
        </button>
      </div>
      <div class="flex items-center gap-1">
        <h3 class="font-semibold">{{ $t("animator-layer") }}</h3>
        <select
          v-model.number="layerIndex"
          :class="field"
          :aria-label="$t('animator-layer')"
          data-testid="animator-layer"
        >
          <option v-for="(item, index) in controller.layers" :key="item.name" :value="index" translate="no">
            {{ item.name }}
          </option>
        </select>
      </div>
      <template v-if="layer !== null">
        <table class="w-full text-left" :aria-label="$t('animator-states')">
          <tbody>
            <tr
              v-for="name in states"
              :key="name"
              :data-state="name"
              :data-active="active[layer.name] === name ? '1' : undefined"
              data-testid="animator-state"
            >
              <td class="w-4">{{ active[layer.name] === name ? "▶" : "" }}</td>
              <td class="font-mono" translate="no">{{ name }}</td>
              <td class="truncate" translate="no">{{ motionWords(layer.states[name]!) }}</td>
              <td>
                <input
                  type="radio"
                  :checked="layer.start === name"
                  :aria-label="$t('animator-start', { name })"
                  @change="setStart(name)"
                />
              </td>
              <td>
                <button type="button" :class="button" @click="removeState(name)">×</button>
              </td>
            </tr>
          </tbody>
        </table>
        <div class="flex items-center gap-1">
          <label :for="ids.name" class="flex items-center gap-1">
            {{ $t("animator-new-state") }}
            <input :id="ids.name" v-model="newState" :class="[field, 'w-24']" data-testid="animator-new-state" />
          </label>
          <Select
            v-model="newClip"
            :options="clipOptions"
            class="w-32"
            :aria-label="$t('animator-clip')"
            data-testid="animator-new-clip"
          />
          <button type="button" :class="button" data-testid="animator-add-state" @click="addState()">
            {{ $t("animator-add") }}
          </button>
        </div>
        <h3 class="font-semibold">{{ $t("animator-transitions") }}</h3>
        <ul class="flex flex-col gap-1">
          <li
            v-for="(move, index) in layer.transitions ?? []"
            :key="`${index}-${move.from}-${move.to}`"
            class="flex items-center gap-1"
            :data-transition="`${move.from}>${move.to}`"
            data-testid="animator-transition"
          >
            <span class="font-mono" translate="no">{{ move.from }} → {{ move.to }}</span>
            <input
              :value="JSON.stringify(move.when ?? [])"
              :class="[field, 'w-56 font-mono']"
              :aria-label="$t('animator-conditions')"
              data-testid="animator-conditions"
              @change="setConditions(index, ($event.target as HTMLInputElement).value)"
            />
            <button type="button" :class="button" @click="removeTransition(index)">×</button>
          </li>
        </ul>
        <div class="flex items-center gap-1">
          <Select
            v-model="newFrom"
            :options="[{ value: '*', label: $t('animator-any') }, ...stateOptions]"
            class="w-28"
            :aria-label="$t('animator-from')"
          />
          <Select
            v-model="newTo"
            :options="stateOptions"
            class="w-28"
            :aria-label="$t('animator-to')"
            data-testid="animator-new-to"
          />
          <button type="button" :class="button" data-testid="animator-add-transition" @click="addTransition">
            {{ $t("animator-add") }}
          </button>
        </div>
      </template>
      <p v-if="reason !== null" class="text-status-negative" role="alert">{{ reason }}</p>
    </template>
  </section>
</template>
