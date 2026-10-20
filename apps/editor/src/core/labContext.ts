// SPDX-License-Identifier: Apache-2.0
/**
 * The context of the 3D room lab that the page gives its panel components: the live take, the clock, the camera, the
 * renderer options and the frame statistics.
 */
import type { BackendChoice } from "@scenity/runtime/backend";
import type { ProbeResult } from "@scenity/runtime/probe";
import type { Tier } from "@scenity/runtime/protocol";
import type { DebugLayer } from "../plugins";
import { inject, type InjectionKey, type Ref, type ShallowRef } from "vue";
import type { LabBrowser } from "./browser/useBrowser";
import type { LabPanes } from "./panes/usePanes";
import type { LabCamera } from "./useLabCamera";
import type { LabClock } from "./useLabClock";
import type { LabStats, ViewHandle } from "./useLabStats";
import type { LabTake } from "./useLabTake";
import type { LabMock, TrackSource } from "./sceneSource";

export interface LabRenderer {
  readonly tier: Ref<Tier>;
  readonly useWorker: Ref<boolean>;
  readonly reduced: Ref<boolean>;
  readonly showCards: Ref<boolean>;
  readonly useAssets: Ref<boolean>;
  readonly probe: ProbeResult;
  /** A fixed frame of the visual tests (`freeze`): no adaptive quality, no dock, no frame rate readout. */
  readonly frozen: boolean;
  /** The debug layers over the scene (the URL parameter `debug`). */
  readonly debug: Ref<DebugLayer[]>;
  /** The room view: its statistics, its frame mark and its inspect report. */
  readonly view: ShallowRef<ViewHandle | null>;
  /** The tune values (the URL parameter `tune`): path → number. */
  readonly tunes: Ref<Record<string, number>>;
  /** The choice of the renderer backend, or null until the page makes it. */
  readonly backend: ShallowRef<BackendChoice | null>;
  /** The scratch props as the text of the `scratch` URL parameter ("" for none): an input of the frame key. */
  readonly scratch?: Readonly<Ref<string>>;
}

export interface LabContext {
  readonly take: LabTake;
  readonly clock: LabClock;
  readonly camera: LabCamera;
  readonly renderer: LabRenderer;
  readonly stats: LabStats;
  /** The member of the team tab (and of the keys P and K). */
  readonly selectedId: Ref<string>;
  /** The recorded case of the URL (`source=track:<name>`), or null: the views of the take. */
  readonly track: ShallowRef<TrackSource | null>;
  /** The name of the track of the URL, or null. */
  readonly trackName: string | null;
  /** The live session of the mock engine (`source=mock`), or null. */
  readonly mock: LabMock | null;
  /** The content browser, or null for a fixed frame. */
  readonly browser: LabBrowser | null;
  /** The split screen of 1 to 4 panes; absent in a test. */
  readonly panes?: LabPanes;
  /** On a phone in portrait, the panel covers the scene. Hide it after a choice, thus the scene shows the motion. */
  showScene(): void;
}

export const LAB_CONTEXT: InjectionKey<LabContext> = Symbol("room3d-lab");

export function useLab(): LabContext {
  const context = inject(LAB_CONTEXT);
  if (context === undefined) throw new Error("The lab panel needs the lab page.");
  return context;
}
