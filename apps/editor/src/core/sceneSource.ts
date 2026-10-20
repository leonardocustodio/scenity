// SPDX-License-Identifier: Apache-2.0
/**
 * The scene of the editor: the plugin gives the view of its scene and the source of the views of the page
 * (`EditorPlugin.scene`). A source is the take of the lab (the state at the clock time), a recorded track of a case
 * (`source=track:<name>`, a recorded state stream) or a live session of the plugin (`source=mock`).
 *
 * A function reads the plugin when it runs, never when the module loads.
 */
import type { RecordedSource } from "@scenity/scene/sequence";
import type { Component, ComputedRef, Ref, ShallowRef } from "vue";
import type {
  DebugLayer,
  InspectReport,
  LabMock,
  MetricValue,
  Room3DManifest,
  RoomKit,
  RoomLight,
  SceneInput,
} from "../plugins";
import { editorPlugin } from "./plugin";
import type { LabEvent, PhaseMark } from "./sequence";
import type { LabClock } from "./useLabClock";
import type { LabTake } from "./useLabTake";

export type { LabMock };

/** A recorded case of the plugin: the recorded source of a state stream. The plugin gives its state type. */
export type TrackSource = RecordedSource<unknown>;

/** What a source reads of the page. */
export interface SourceParts {
  readonly take: LabTake;
  readonly clock: LabClock;
  readonly params: URLSearchParams;
  /** Show a failure of the source on the page (for example a track that does not load). */
  fail(reason: string): void;
}

/** The source of the views of the page. */
export interface SceneSource {
  /** `take`, `track:<name>`, or the name of a live session of the plugin (`mock`). */
  readonly name: string;
  /** The name of the track of the URL, or null. */
  readonly trackName: string | null;
  /** The loaded track, or null (no track, or before its load). */
  readonly track: ShallowRef<TrackSource | null>;
  /** The live session, or null: the clock, the time line, the takes, the checks and the frame index do not apply. */
  readonly session: LabMock | null;
  /** The props of the scene view of the plugin: the views of the take, of the track or of the live session. */
  readonly props: ComputedRef<Readonly<Record<string, unknown>>>;
  /** The simulation time of the scene: the clock of a live session, else the clock of the lab. */
  simNow(): number | null;
  /** The scene input at a time (the sweeps, the onion skin), or null for a live session. */
  readonly inputAt: ((at: number) => SceneInput) | null;
}

/** The scene of a plugin. */
export interface EditorScene {
  /**
   * The view of the scene: a Vue component over SceneView with the labs renderer. It takes the props of the page (the
   * camera, the panes, the clock, the debug layers, the tunes, the selection, the renderer options) and the props of
   * the source. It emits `address` (a press on a member) and `failed`.
   */
  readonly view: Component;
  /** The source of the views of the page from the URL (`source`). */
  useSource(parts: SourceParts): SceneSource;
  /** The names of the recorded tracks. */
  readonly trackNames: readonly string[];
  /** The marks of the time line of a track (the phase changes of its tasks). */
  trackMarks(track: TrackSource): readonly PhaseMark[];
  /** The scene input of the events at a time (the frame index): of the track when there is one. */
  inputAt(events: readonly LabEvent[], at: number, track: TrackSource | null): SceneInput;
  /** The keys of the plugin on the page (for example the keys of the selected member). */
  useKeys(take: LabTake, selectedId: Ref<string>): void;
  /** The parts of the room model that the core tools read. */
  readonly room: EditorRoom;
  /** The URLs of the render workers of the scene. */
  readonly workers: EditorWorkers;
}

/**
 * The render workers of the scene: same-origin URLs of `?worker&url` imports in the plugin. The lab workers have the
 * dev tools. The runtime workers are the workers of the player, for the parity check (`runtime=1`).
 */
export interface EditorWorkers {
  /** The lab worker with the WebGL backend. */
  readonly lab: string;
  /** The lab worker with the WebGPU backend. */
  readonly labGpu: string;
  /** The runtime worker with the WebGL backend. */
  readonly runtime: string;
  /** The runtime worker with the WebGPU backend. */
  readonly runtimeGpu: string;
}

/**
 * The room of the scene: the parts of the room model of the plugin that the core tools read. Thus the core imports no
 * room module.
 */
export interface EditorRoom {
  /** The room kit: the snap scene, the framing of the default camera and the place markers of the proposals. */
  readonly kit: RoomKit;
  /** The first floor point (x, z) of a named anchor of a kit, or null when the kit does not know the anchor. */
  anchorPoint(kit: RoomKit, anchor: string): readonly [number, number] | null;
  /** The metric values of an inspect report (the metrics of the pictures of the frame index). */
  measure(report: InspectReport): MetricValue[];
  /** The names of the debug layers over the scene, in their order. */
  readonly debugLayers: readonly DebugLayer[];
  /** The key light of the runtime: the start values of the light edit. Its module registers the tunable `light`. */
  readonly light: RoomLight;
  /** The asset manifest of the built room, or null before it loads. */
  manifest(): Room3DManifest | null;
}

/** The scene of the plugin. */
export function editorScene(): EditorScene {
  return editorPlugin().scene;
}

/** The room of the scene of the plugin. */
export function editorRoom(): EditorRoom {
  return editorPlugin().scene.room;
}
