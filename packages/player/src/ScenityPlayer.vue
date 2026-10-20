<!-- SPDX-License-Identifier: Apache-2.0 -->
<script setup lang="ts">
/**
 * The Vue component of the player: a container of `createPlayer`. The props are the player options. A change of
 * `camera` changes the camera. A change of another prop starts the player again. The component emits each event of
 * the player with its detail, and `defineExpose` gives the player handle.
 *
 *     <ScenityPlayer project="/projects/showroom/scenity.project.json" camera="front" autoplay @ready="onReady" />
 *
 * The embed API: `inputs` (the plugin inputs by plugin ID), `source` (a simulation source) and `points` (the
 * references of the projected points) go to the player when they change, and to each new player. `core` and
 * `schemas` are player options. The component emits `pick`, `points` and `time`, and exposes `send(event)`.
 */
import type { SceneDocument } from "@scenity/scene/schema/documents";
import type { SequenceDocument, SimulationPlugin, SimulationSource } from "@scenity/scene/sequence";
import type { InputSchema, Tier } from "@scenity/runtime/protocol";
import { onBeforeUnmount, onMounted, ref, shallowRef, watch } from "vue";
import { PLAYER_EVENTS } from "./attributes";
import { createPlayer } from "./index";
import type {
  Player,
  PlayerBackend,
  PlayerEventName,
  PlayerEvents,
  PlayerInputEvent,
  PlayerInputResult,
  PlayerOptions,
  PlayerPluginCore,
} from "./types";

const props = withDefaults(
  defineProps<{
    project?: string | undefined;
    manifestUrl?: string | undefined;
    scene?: string | SceneDocument | undefined;
    sequence?: string | SequenceDocument | null | undefined;
    simulation?: SimulationPlugin | undefined;
    backend?: PlayerBackend | undefined;
    worker?: boolean | undefined;
    tier?: Tier | undefined;
    autoplay?: boolean | undefined;
    loop?: boolean | undefined;
    camera?: string | undefined;
    audio?: boolean | undefined;
    start?: number | undefined;
    /** The poster URL, or null for no poster. */
    poster?: string | null | undefined;
    /** The adaptive quality ladder. */
    adaptive?: boolean | undefined;
    /** A plugin core in place of the document core. */
    core?: PlayerPluginCore | undefined;
    /** The input schemas of the plugins, by plugin ID. */
    schemas?: Readonly<Record<string, InputSchema<unknown>>> | undefined;
    /** The plugin inputs by plugin ID. A changed value goes to the player. */
    inputs?: Readonly<Record<string, unknown>> | undefined;
    /** The simulation source. */
    source?: SimulationSource | null | undefined;
    /** The references of the projected points of the `points` event. */
    points?: readonly string[] | undefined;
  }>(),
  // An undefined default keeps the default of the player. Without it, Vue gives an absent boolean prop the value false.
  {
    project: undefined,
    manifestUrl: undefined,
    scene: undefined,
    sequence: undefined,
    simulation: undefined,
    backend: undefined,
    worker: undefined,
    tier: undefined,
    autoplay: undefined,
    loop: undefined,
    camera: undefined,
    audio: undefined,
    start: undefined,
    poster: undefined,
    adaptive: undefined,
    core: undefined,
    schemas: undefined,
    inputs: undefined,
    source: undefined,
    points: undefined,
  },
);

const emit = defineEmits<{
  ready: [PlayerEvents["ready"]];
  play: [PlayerEvents["play"]];
  pause: [PlayerEvents["pause"]];
  seek: [PlayerEvents["seek"]];
  timeupdate: [PlayerEvents["timeupdate"]];
  ended: [PlayerEvents["ended"]];
  marker: [PlayerEvents["marker"]];
  event: [PlayerEvents["event"]];
  camera: [PlayerEvents["camera"]];
  error: [PlayerEvents["error"]];
  fallback: [PlayerEvents["fallback"]];
  quality: [PlayerEvents["quality"]];
  pick: [PlayerEvents["pick"]];
  points: [PlayerEvents["points"]];
  time: [PlayerEvents["time"]];
}>();

const container = ref<HTMLDivElement | null>(null);
const player = shallowRef<Player | null>(null);

/** The props of the embed API, which are not player options. */
const EMBED_PROPS = new Set(["inputs", "source", "points"]);

/** The player options of the props, with no undefined values (exactOptionalPropertyTypes). */
function optionsOf(): PlayerOptions {
  const options: PlayerOptions = Object.fromEntries(
    Object.entries({ ...props }).filter(([key, value]) => value !== undefined && !EMBED_PROPS.has(key)),
  );
  return options;
}

/** Give the player the inputs that changed (all of them for a new player). */
function applyInputs(next: Player, before: Readonly<Record<string, unknown>> | undefined): void {
  const inputs = props.inputs ?? {};
  for (const [plugin, input] of Object.entries(inputs)) {
    if (before?.[plugin] !== input) next.setInput(plugin, input);
  }
  for (const plugin of Object.keys(before ?? {})) {
    if (!Object.hasOwn(inputs, plugin)) next.setInput(plugin, null);
  }
}

function restart(): void {
  player.value?.dispose();
  player.value = null;
  if (container.value === null) return;
  const next = createPlayer(container.value, optionsOf());
  for (const name of PLAYER_EVENTS) {
    next.on(name, (detail) => {
      (emit as (event: PlayerEventName, value: unknown) => void)(name, detail);
    });
  }
  player.value = next;
  applyInputs(next, undefined);
  if (props.source != null) next.setSource(props.source);
  if (props.points !== undefined) next.watchPoints(props.points);
}

watch(
  () => props.inputs,
  (inputs, before) => {
    if (player.value !== null && inputs !== before) applyInputs(player.value, before);
  },
);
watch(
  () => props.source,
  (source) => player.value?.setSource(source ?? null),
);
watch(
  () => props.points,
  (refs) => player.value?.watchPoints(refs ?? []),
);

watch(
  () => props.camera,
  (camera) => {
    if (player.value?.state === "ready") void player.value.setCamera(camera ?? null);
  },
);
// Each prop but `camera`: the getter reads only them, so a camera change does not start the player again.
watch(
  () => [
    props.project,
    props.manifestUrl,
    props.scene,
    props.sequence,
    props.simulation,
    props.backend,
    props.worker,
    props.tier,
    props.autoplay,
    props.loop,
    props.audio,
    props.start,
    props.poster,
    props.adaptive,
    props.core,
    props.schemas,
  ],
  restart,
);

onMounted(restart);
onBeforeUnmount(() => {
  player.value?.dispose();
  player.value = null;
});

/** Send an event to the plugin systems of the player. */
function send(event: PlayerInputEvent): PlayerInputResult {
  return player.value?.send(event) ?? { ok: false, problems: [{ plugin: "", path: "", message: "no player" }] };
}

defineExpose({ player, send });
</script>

<template>
  <div ref="container" class="scenity-player" data-testid="scenity-player"></div>
</template>

<style scoped>
.scenity-player {
  position: relative;
  width: 100%;
  height: 100%;
}
</style>
