<!-- SPDX-License-Identifier: Apache-2.0 -->
<script setup lang="ts">
/**
 * The form of the selected key of the Timeline. It has the time, the ease and the fields of the key for each track
 * kind. The fields are a value, the parts of a transform, the visible flag, a sound, a clip, a camera, an attach
 * parent, an event name, or an action and its arguments. Apply runs `sequence.key.value`, and `sequence.key.move` for
 * a new time. Each command is one step of the history. A JSON field that does not parse shows a problem text.
 */
import { useI18n } from "@scenity/i18n";
import { EASE_NAMES, type Track } from "@scenity/scene/sequence";
import { computed, ref, useId, watch } from "vue";
import { button } from "../../core/labUi";
import { cameraRefs, keyFields } from "./keyForms";
import type { SequencerState } from "./useSequencer";

type FieldType = "json" | "text" | "number" | "boolean" | "camera" | "action" | "nullable";
interface FieldSpec {
  readonly name: string;
  readonly type: FieldType;
}

/** The fields of the key of each kind (the time and the ease are separate). */
const FIELDS: Readonly<Record<Track["kind"], readonly FieldSpec[]>> = {
  property: [{ name: "value", type: "json" }],
  transform: [
    { name: "position", type: "json" },
    { name: "rotation", type: "json" },
    { name: "scale", type: "json" },
  ],
  visibility: [{ name: "visible", type: "boolean" }],
  audio: [
    { name: "play", type: "boolean" },
    { name: "sound", type: "text" },
    { name: "offset", type: "number" },
  ],
  animation: [
    { name: "clip", type: "nullable" },
    { name: "speed", type: "number" },
    { name: "loop", type: "boolean" },
    { name: "blend", type: "number" },
  ],
  camera: [{ name: "camera", type: "camera" }],
  attach: [
    { name: "to", type: "nullable" },
    { name: "position", type: "json" },
    { name: "rotation", type: "json" },
  ],
  event: [
    { name: "name", type: "text" },
    { name: "args", type: "json" },
  ],
  action: [
    { name: "action", type: "action" },
    { name: "args", type: "json" },
  ],
};

const props = defineProps<{
  readonly state: SequencerState;
  /** The action names that the action field offers. */
  readonly actions: readonly string[];
}>();
const { $t } = useI18n();
const { sequence, selectedKey, scene } = props.state;
const ids = { time: useId(), field: useId(), ease: useId() };

const selected = computed(() => {
  const ref = selectedKey.value;
  const track = ref === null ? undefined : sequence.value.tracks[ref.track];
  const key = ref === null ? undefined : (track?.keys[ref.key] as Readonly<Record<string, unknown>> | undefined);
  return ref === null || track === undefined || key === undefined ? null : { ref, track, key };
});
const fields = computed(() => (selected.value === null ? [] : FIELDS[selected.value.track.kind]));
const eased = computed(() => selected.value?.track.kind === "property" || selected.value?.track.kind === "transform");
const cameras = computed(() => cameraRefs(scene.value));

/** The text or the flag of each field, the time and the ease, read from the selected key. */
const values = ref<Record<string, string | boolean>>({});
const time = ref("0");
const ease = ref("");
const problem = ref<string | null>(null);
watch(
  selected,
  (now) => {
    problem.value = null;
    if (now === null) return;
    const read = keyFields(now.key);
    values.value = Object.fromEntries(
      FIELDS[now.track.kind].map(({ name, type }): [string, string | boolean] => {
        const value = read[name];
        if (type === "boolean") return [name, value === true];
        if (value === undefined || value === null) return [name, ""];
        return [name, type !== "json" && typeof value === "string" ? value : JSON.stringify(value)];
      }),
    );
    time.value = String(now.key.t);
    ease.value =
      typeof now.key.ease === "string" ? now.key.ease : now.key.ease === undefined ? "" : JSON.stringify(now.key.ease);
  },
  { immediate: true },
);

/** The value of the form as key fields. A field that does not parse throws a problem text. */
function formValue(): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const { name, type } of fields.value) {
    const raw = values.value[name];
    if (type === "boolean") {
      out[name] = raw === true;
      continue;
    }
    const text = typeof raw === "string" ? raw.trim() : "";
    if (type === "nullable") out[name] = text === "" ? null : text;
    else if (text === "") continue;
    else if (type === "number") out[name] = Number(text);
    else if (type === "json") {
      try {
        out[name] = JSON.parse(text) as unknown;
      } catch {
        throw new Error($t("sequencer-key-json", { field: name }));
      }
    } else out[name] = text;
  }
  return out;
}

async function apply(): Promise<void> {
  const now = selected.value;
  if (now === null) return;
  let value: Record<string, unknown>;
  try {
    value = formValue();
  } catch (error) {
    problem.value = error instanceof Error ? error.message : String(error);
    return;
  }
  problem.value = null;
  const { track, key } = now.ref;
  // The form reads the key again after the first command, so the new time is read first.
  const t = Number(time.value);
  const done = await props.state.run("sequence.key.value", {
    track,
    key,
    // A property key takes the value itself; the other kinds take their fields.
    value: JSON.stringify(now.track.kind === "property" ? value.value : value),
    ...(eased.value && ease.value !== "" ? { ease: ease.value } : {}),
  });
  if (done && Number.isInteger(t) && t !== now.key.t) await props.state.run("sequence.key.move", { track, key, t });
}

const field = "h-7 rounded-control border border-border-subtle bg-surface-sunken px-1.5 text-caption text-text-primary";
</script>

<template>
  <form
    v-if="selected !== null"
    class="flex flex-wrap items-center gap-1 border-t border-border-subtle pt-1"
    :aria-label="$t('sequencer-key-form')"
    :data-kind="selected.track.kind"
    data-testid="sequencer-key-form"
    @submit.prevent="apply"
  >
    <label class="flex items-center gap-1" :for="ids.time">
      {{ $t("sequencer-key-time") }}
      <input
        :id="ids.time"
        v-model="time"
        type="number"
        min="0"
        :class="[field, 'w-20']"
        data-testid="sequencer-key-t"
      />
    </label>
    <label v-for="spec in fields" :key="spec.name" class="flex items-center gap-1" :for="`${ids.field}-${spec.name}`">
      <span translate="no">{{ spec.name }}</span>
      <input
        v-if="spec.type === 'boolean'"
        :id="`${ids.field}-${spec.name}`"
        v-model="values[spec.name]"
        type="checkbox"
        :data-testid="`sequencer-key-field-${spec.name}`"
      />
      <select
        v-else-if="spec.type === 'camera'"
        :id="`${ids.field}-${spec.name}`"
        v-model="values[spec.name]"
        :class="field"
        :data-testid="`sequencer-key-field-${spec.name}`"
      >
        <option v-for="camera in cameras" :key="camera" :value="camera" translate="no">{{ camera }}</option>
      </select>
      <template v-else>
        <input
          :id="`${ids.field}-${spec.name}`"
          v-model="values[spec.name]"
          type="text"
          :class="[field, spec.type === 'json' ? 'w-36 font-mono' : 'w-28']"
          :list="spec.type === 'action' ? 'sequencer-actions' : undefined"
          :data-testid="`sequencer-key-field-${spec.name}`"
        />
      </template>
    </label>
    <label v-if="eased" class="flex items-center gap-1" :for="ids.ease">
      {{ $t("sequencer-key-ease") }}
      <input
        :id="ids.ease"
        v-model="ease"
        type="text"
        list="sequencer-eases"
        :class="[field, 'w-24']"
        data-testid="sequencer-key-ease"
      />
    </label>
    <datalist id="sequencer-actions">
      <option v-for="action in actions" :key="action" :value="action" />
    </datalist>
    <datalist id="sequencer-eases">
      <option v-for="name in EASE_NAMES" :key="name" :value="name" />
    </datalist>
    <button type="submit" :class="button" data-testid="sequencer-key-apply">{{ $t("sequencer-key-apply") }}</button>
    <p v-if="problem !== null" class="text-status-negative" role="alert">{{ problem }}</p>
  </form>
</template>
