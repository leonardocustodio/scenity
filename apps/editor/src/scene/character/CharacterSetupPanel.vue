<!-- SPDX-License-Identifier: Apache-2.0 -->
<script setup lang="ts">
/**
 * The Character setup window of the selected entity with a skinned model. It shows the rig profile (Detect takes the
 * profile that fits the bone names best). It shows the bone map: each canonical bone, its node from the profile or from
 * the `bones` of the component, a choice of another node, and the required bones with no node. It shows the clip source
 * of the animator: the clips of another model, retargeted through the rig profiles. The look variant chooses a key of
 * `variants`. With "Move the IK targets in the view", each target entity of the IK goals has a handle in the Scene
 * view. A release of a drag moves the entity (`entity.move`). The retarget preview plays a clip of the clip source on
 * the entity in the Scene view (with an open sequence), and the sequence does not change. Each change is a command and
 * one step of the history.
 */
import { useI18n } from "@scenity/i18n";
import type { SceneDocument } from "@scenity/scene/schema/documents";
import { Select } from "@scenity/ui";
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from "vue";
import { usePanelVisible } from "../../studio/shell/panelState";
import { startToolHandles, viewportView } from "../extensions/toolHandles";
import { button } from "../inspector/inspectorUi";
import { bestProfile, boneRows, ikHandles, missingRows, RIG_IDS, type CharacterIkGoal } from "./characterSetup";

const props = defineProps<{
  doc: { readonly value: SceneDocument };
  selected: { readonly value: readonly string[] };
  /** The bone names of the model of each entity (the inspect report). */
  report(): Promise<{
    entities: readonly { id: string; parts?: { bones?: readonly string[]; sourceClips?: readonly string[] } }[];
  } | null>;
  /** Run a command; the reason of a refusal, or null. */
  run(command: string, args: Readonly<Record<string, unknown>>): Promise<string | null>;
  /** The canvas of the Scene view (the IK handles go over it). */
  canvas?: HTMLCanvasElement;
  /** Play a clip on an entity in the Scene view (null: stop). With no function, the window has no retarget preview. */
  preview?(value: { readonly entity: string; readonly clip: string; readonly name: string } | null): void;
}>();
const { $t } = useI18n();
const visible = usePanelVisible();

const entity = computed(() => {
  const id = props.selected.value[0];
  return id !== undefined && props.doc.value.entities[id]?.components.model !== undefined ? id : null;
});
const components = computed(() =>
  entity.value === null ? undefined : props.doc.value.entities[entity.value]?.components,
);
const character = computed(
  () =>
    components.value?.character as
      { rig?: string; bones?: Record<string, string>; variant?: string; variants?: object; ik?: unknown } | undefined,
);
const rig = computed(() => character.value?.rig ?? "none");
const names = shallowRef<readonly string[]>([]);
const rows = computed(() => boneRows(rig.value, names.value, character.value?.bones ?? {}));
const missing = computed(() => missingRows(rows.value));
/** The choice "the node of the profile" (a select item needs a value that is not empty). */
const PROFILE = "*profile";
/** The choice "the clips of the own model". */
const OWN = "*own";
const nodeOptions = computed(() => [
  { value: PROFILE, label: $t("character-node-profile") },
  ...names.value.map((value) => ({ value, label: value })),
]);
// A rig profile is an ID; "none" is a word of the window.
const rigOptions = computed(() =>
  RIG_IDS.map((value) => ({ value, label: value === "none" ? $t("character-rig-none") : value })),
);

/** The other model assets of the scene (the clip sources). */
const sources = computed(() => {
  const own = (components.value?.model as { asset?: string } | undefined)?.asset;
  const found = new Map<string, string>();
  for (const [id, item] of Object.entries(props.doc.value.entities)) {
    const asset = (item.components.model as { asset?: string } | undefined)?.asset;
    if (asset !== undefined && asset !== own && !found.has(asset)) found.set(asset, item.name ?? id);
  }
  return [...found].map(([value, label]) => ({ value, label: `${label} (${value})` }));
});
const clipSource = computed(
  () => (components.value?.animator as { clipSource?: { asset: string } } | undefined)?.clipSource?.asset ?? "",
);

/** The choice "no variant". */
const NO_VARIANT = "*none";
const variantOptions = computed(() => [
  { value: NO_VARIANT, label: $t("character-variant-none") },
  ...Object.keys(character.value?.variants ?? {}).map((value) => ({ value, label: value })),
]);

const GOAL_TEXT: Readonly<Record<CharacterIkGoal, string>> = {
  leftHand: "character-ik-left-hand",
  rightHand: "character-ik-right-hand",
  look: "character-ik-look",
};
const handles = computed(() => ikHandles(props.doc.value, character.value?.ik));
const moveTargets = ref(false);
let stopHandles: (() => void) | null = null;
watch(
  () => moveTargets.value && visible.value && entity.value !== null && props.canvas !== undefined,
  (on) => {
    stopHandles?.();
    stopHandles = null;
    if (!on || props.canvas === undefined) return;
    stopHandles = startToolHandles(props.canvas, {
      handles: () =>
        handles.value.map((handle) => ({
          id: handle.entity,
          point: handle.point,
          label: $t("character-ik-handle", {
            goal: handle.goals.map((goal) => $t(GOAL_TEXT[goal])).join(", "),
            name: props.doc.value.entities[handle.entity]?.name ?? handle.entity,
          }),
        })),
      move: (id, point, done) => {
        if (!done) return;
        void props.run("entity.move", { entity: id, x: point[0], z: point[2] }).then((refusal) => {
          reason.value = refusal;
        });
      },
      view: () => viewportView(props.doc.value),
    });
  },
  { immediate: true },
);

let timer: ReturnType<typeof setInterval> | null = null;
async function refresh(): Promise<void> {
  if (!visible.value || entity.value === null) return;
  const report = await props.report();
  const parts = report?.entities.find((item) => item.id === entity.value)?.parts;
  names.value = parts?.bones ?? [];
  sourceClips.value = parts?.sourceClips ?? [];
}

/** The clips of the clip source, the clip of the retarget preview, and true while the preview plays. */
const sourceClips = shallowRef<readonly string[]>([]);
const previewName = ref("");
const previewing = ref(false);
function stopPreview(): void {
  if (!previewing.value) return;
  previewing.value = false;
  props.preview?.(null);
}
function togglePreview(): void {
  const name = previewName.value === "" ? sourceClips.value[0] : previewName.value;
  if (previewing.value || entity.value === null || clipSource.value === "" || name === undefined) {
    stopPreview();
    return;
  }
  previewing.value = true;
  props.preview?.({ entity: entity.value, clip: clipSource.value, name });
}
// A new entity or a new clip source stops the preview.
watch([entity, clipSource], () => {
  sourceClips.value = [];
  stopPreview();
});
onMounted(() => {
  void refresh();
  timer = setInterval(() => void refresh(), 500);
});
onBeforeUnmount(() => {
  if (timer !== null) clearInterval(timer);
  stopHandles?.();
  stopPreview();
});

const reason = ref<string | null>(null);
/** Set a field of the `character` component (it comes first when the entity has none). */
async function setCharacter(fieldName: string, value: unknown): Promise<void> {
  if (entity.value === null) return;
  const base = { entity: entity.value, component: "character" };
  reason.value =
    character.value === undefined
      ? await props.run("component.add", { ...base, value: JSON.stringify({ [fieldName]: value }) })
      : await props.run("component.set", { ...base, field: fieldName, value: JSON.stringify(value) });
}
function setNode(bone: string, node: string): void {
  const kept = Object.entries(character.value?.bones ?? {}).filter(([key]) => key !== bone);
  void setCharacter("bones", Object.fromEntries(node === PROFILE ? kept : [...kept, [bone, node]]));
}
/** The look variant: a key of `variants`, or none. */
async function setVariant(value: string): Promise<void> {
  if (entity.value === null) return;
  if (value !== NO_VARIANT) return setCharacter("variant", value);
  reason.value = await props.run("component.reset", { entity: entity.value, component: "character", field: "variant" });
}
/** The clip source of the animator: another model asset, or none (the clips of the own model). */
async function setClipSource(asset: string): Promise<void> {
  if (entity.value === null) return;
  const base = { entity: entity.value, component: "animator", field: "clipSource" };
  reason.value =
    asset === OWN
      ? await props.run("component.reset", base)
      : await props.run("component.set", { ...base, value: JSON.stringify({ asset }) });
}
</script>

<template>
  <section
    class="flex h-full min-h-0 flex-col gap-2 overflow-auto p-2 text-caption"
    :aria-label="$t('panel-character')"
    :data-entity="entity ?? ''"
    :data-rig="rig"
    :data-missing="missing.length"
    data-testid="character-panel"
  >
    <p v-if="entity === null" class="text-text-secondary">{{ $t("character-none") }}</p>
    <template v-else>
      <div class="flex items-center gap-1">
        <span>{{ $t("character-rig") }}</span>
        <Select
          :model-value="rig"
          :options="rigOptions"
          class="w-32"
          :aria-label="$t('character-rig')"
          data-testid="character-rig"
          @update:model-value="setCharacter('rig', $event)"
        />
        <button
          type="button"
          :class="button"
          data-testid="character-detect"
          @click="setCharacter('rig', bestProfile(names))"
        >
          {{ $t("character-detect") }}
        </button>
      </div>
      <p :class="missing.length > 0 ? 'text-status-negative' : 'text-text-secondary'" data-testid="character-missing">
        {{ missing.length > 0 ? $t("character-missing", { bones: missing.join(", ") }) : $t("character-complete") }}
      </p>
      <table class="w-full text-left" :aria-label="$t('character-bones')">
        <tbody>
          <tr
            v-for="row in rows"
            :key="row.bone"
            :data-bone="row.bone"
            :data-from="row.from ?? 'none'"
            data-testid="character-bone"
          >
            <th scope="row" class="font-mono font-normal" translate="no">
              {{ row.bone }}{{ row.required ? " *" : "" }}
            </th>
            <td>
              <Select
                :model-value="character?.bones?.[row.bone] ?? PROFILE"
                :options="nodeOptions"
                class="w-44"
                :aria-label="$t('character-node', { bone: row.bone })"
                @update:model-value="setNode(row.bone, String($event))"
              />
            </td>
            <td class="truncate font-mono text-text-secondary" translate="no" data-testid="character-node">
              {{ row.node ?? "—" }}
            </td>
          </tr>
        </tbody>
      </table>
      <div v-if="components?.animator !== undefined" class="flex items-center gap-1">
        <span>{{ $t("character-clip-source") }}</span>
        <Select
          :model-value="clipSource === '' ? OWN : clipSource"
          :options="[{ value: OWN, label: $t('character-clip-own') }, ...sources]"
          class="w-64"
          :aria-label="$t('character-clip-source')"
          data-testid="character-clip-source"
          @update:model-value="setClipSource(String($event))"
        />
      </div>
      <div v-if="preview !== undefined && sourceClips.length > 0" class="flex items-center gap-1">
        <span>{{ $t("character-retarget") }}</span>
        <Select
          :model-value="previewName === '' ? (sourceClips[0] ?? '') : previewName"
          :options="sourceClips.map((value) => ({ value, label: value }))"
          class="w-44"
          :aria-label="$t('character-retarget-clip')"
          data-testid="character-retarget-clip"
          @update:model-value="((previewName = String($event)), stopPreview())"
        />
        <button
          type="button"
          :class="button"
          :aria-pressed="previewing"
          :title="$t('character-retarget-title')"
          data-testid="character-retarget-preview"
          @click="togglePreview"
        >
          {{ previewing ? $t("clips-preview-stop") : $t("clips-preview") }}
        </button>
      </div>
      <div v-if="variantOptions.length > 1" class="flex items-center gap-1">
        <span>{{ $t("character-variant") }}</span>
        <Select
          :model-value="character?.variant ?? NO_VARIANT"
          :options="variantOptions"
          class="w-44"
          :aria-label="$t('character-variant')"
          data-testid="character-variant"
          @update:model-value="setVariant(String($event))"
        />
      </div>
      <label for="character-ik-handles" class="flex items-center gap-1" :title="$t('character-ik-handles-title')">
        <input
          id="character-ik-handles"
          v-model="moveTargets"
          type="checkbox"
          :disabled="handles.length === 0 || canvas === undefined"
          :data-handles="handles.length"
          data-testid="character-ik-handles"
        />
        {{ $t("character-ik-handles") }}
      </label>
      <p v-if="handles.length === 0" class="text-text-secondary">{{ $t("character-ik-none") }}</p>
      <p v-if="reason !== null" class="text-status-negative" role="alert">{{ reason }}</p>
    </template>
  </section>
</template>
