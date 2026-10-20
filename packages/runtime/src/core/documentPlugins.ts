// SPDX-License-Identifier: Apache-2.0
/**
 * The plugins of a document core: the runtime faces of the project plugins in the core of the generic scene worker, of
 * the main thread and of the player.
 *
 * - The plugin host (`PluginHost`) checks the plugins. Their components go to the component registry of the scene
 *   builder (the read, the checks and the defaults of the values), and their presenters go to its presenter registry
 *   (one presenter for each component type).
 * - The simulations of the plugins go to the evaluator of the time line: it replays their action keys.
 * - The systems of the plugins run in fixed steps (systemSteps.ts) after the evaluator. Their transform and
 *   visibility outputs change the scene of the frame before the build. A system of a plugin with a simulation gets
 *   the `project` output of the simulation as its input; else the page input of its plugin ID, when the page gives one.
 * - The input events of the play mode (documentInputs.ts) go to the systems as `ctx.inputs` at the step
 *   boundaries, and to the simulations as action keys. A late event makes the steps from its time run again.
 * - With no plugins, the core has no plugin cost: the time line gets no step, and the registries stay as they are.
 *
 * The plugins can come as a promise (a render worker loads them after "init"). The core waits for them before the
 * first "load".
 */
import type { SceneDocument } from "@scenity/scene/schema/documents";
import type { FrameState } from "@scenity/scene/sequence";
import { PluginHost } from "../plugins/host";
import type { PluginInputs } from "../plugins/systems";
import type { RuntimePlugin } from "../plugins/types";
import type { SceneCoreOptions } from "../protocol";
import type { InputEvent } from "@scenity/scene/input";
import type { SequenceDocument } from "@scenity/scene/sequence";
import type { SceneBuilder } from "../scene/builder";
import { SceneTimeline, type ClipPreview, type SceneTimelineOptions } from "../scene/timeline";
import { DocumentInputs, withInputSystems } from "./documentInputs";
import type { PresenterOutputs } from "../systems/outputs";
import { SystemSteps } from "./systemSteps";

/** The runtime faces of the project plugins, or a promise of them. */
export type DocumentPluginSource = readonly RuntimePlugin[] | Promise<readonly RuntimePlugin[]>;

/** The options of a document core before the backend entry adds its parts: the core options and the plugins. */
export type DocumentBaseOptions = Omit<SceneCoreOptions, "backend"> & {
  /** The runtime faces of the project plugins. Absent: no plugins. */
  readonly plugins?: DocumentPluginSource;
};

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The scene with the transform and visibility outputs of the systems over the values of the documents. */
export function withOutputs(scene: SceneDocument, out: PresenterOutputs | null): SceneDocument {
  if (out === null || out.size === 0) return scene;
  const entities = { ...scene.entities };
  for (const id of out.entities()) {
    const entity = entities[id];
    const output = out.get(id);
    if (entity === undefined || output === undefined) continue;
    const components = { ...entity.components };
    if (output.transform !== undefined) {
      const transform = isRecord(components.transform) ? components.transform : {};
      components.transform = { ...transform, ...output.transform };
    }
    if (output.visible !== undefined) {
      const visibility = isRecord(components.visibility) ? components.visibility : {};
      components.visibility = { ...visibility, visible: output.visible };
    }
    entities[id] = { ...entity, components };
  }
  return { ...scene, entities };
}

/** The error text of a plugin load or check. */
function reasonOf(error: unknown): string {
  return `the plugins did not load: ${error instanceof Error ? error.message : String(error)}`;
}

export class DocumentPlugins {
  readonly #builder: SceneBuilder;
  readonly #core: unknown;
  readonly #ready: Promise<string | null>;
  #host: PluginHost | null = null;
  #steps: SystemSteps<PluginInputs> | null = null;
  /** The last time line: a new one (or none) releases its clip assets. */
  #timeline: SceneTimeline | null = null;
  /** The preview clip of the clip browser; each new time line also plays it. */
  #preview: ClipPreview | null = null;
  /** The input events of the play mode. */
  readonly #inputs = new DocumentInputs();

  /** `core` is the document core: each system factory gets it (`PluginRunnerOptions.core`). */
  constructor(builder: SceneBuilder, source: DocumentPluginSource | undefined, core: unknown) {
    this.#builder = builder;
    this.#core = core;
    if (source === undefined) this.#ready = Promise.resolve(null);
    else if (Array.isArray(source)) this.#ready = Promise.resolve(this.#install(source as readonly RuntimePlugin[]));
    else this.#ready = Promise.resolve(source).then((plugins) => this.#install(plugins), reasonOf);
  }

  /** Wait for the plugins: null when they are in, else the reason of the failure. */
  ready(): Promise<string | null> {
    return this.#ready;
  }

  /** The options of a time line: the simulations and the system step of the plugins. Empty with no plugins. */
  timeline(input: () => unknown): SceneTimelineOptions {
    const host = this.#host;
    if (host === null) return {};
    // A new time line gets a new runner: the systems start with new memory and the seeds of its scene.
    this.#steps = null;
    const simulations = host.simulations.length === 0 ? {} : { simulations: host.simulations };
    if (!host.plugins.some((plugin) => plugin.systems.length > 0)) return simulations;
    const systems = (scene: SceneDocument, t: number, frameAt: (t: number) => FrameState): SceneDocument => {
      this.#steps ??= new SystemSteps(host.createRunner({ core: this.#core, documentId: scene.id }));
      return withOutputs(
        scene,
        this.#steps.at(t, frameAt, (frame) => this.#inputOf(host, frame, input())),
      );
    };
    return { ...simulations, systems };
  }

  /**
   * The time line of a sequence over a scene, with the options of `timeline`, or null for no sequence. With a
   * plugin simulation, the sequence of the time line holds the input events as action keys. The time line before it
   * releases its assets.
   */
  sceneTimeline(scene: SceneDocument, sequence: SequenceDocument | null, input: () => unknown): SceneTimeline | null {
    this.#timeline?.dispose();
    this.#timeline = null;
    if (sequence === null) return null;
    const options = this.timeline(input);
    const timed = this.#inputs.sequence(sequence, this.#simulates());
    this.#timeline = new SceneTimeline(this.#builder, scene, timed, options);
    this.#timeline.previewClip(this.#preview);
    return this.#timeline;
  }

  /** Play a clip on an entity at the time of each frame of the time lines (null: none). */
  previewClip(preview: ClipPreview | null): void {
    this.#preview = preview;
    this.#timeline?.previewClip(preview);
  }

  /**
   * Add input events, or replace all of them. The steps from the earliest changed time run again. The result
   * is true when the time line needs a new sequence (a plugin simulation reduces the events as action keys).
   */
  setInputs(events: readonly InputEvent[], replace: boolean): boolean {
    const t = this.#inputs.set(events, replace);
    if (t === null) return false;
    this.#steps?.forget(t);
    return this.#simulates();
  }

  /** True when a plugin has a simulation. */
  #simulates(): boolean {
    return (this.#host?.simulations.length ?? 0) > 0;
  }

  /** Forget the system memory: a load or a patch changes the documents. */
  reset(): void {
    this.#steps?.reset();
  }

  /** Check the plugins and add their components and presenters to the registries of the builder. */
  #install(plugins: readonly RuntimePlugin[]): string | null {
    if (plugins.length === 0) return null;
    try {
      // The systems of the host get the input events of each step.
      const host = new PluginHost(withInputSystems(plugins, this.#inputs.track));
      for (const plugin of plugins) {
        for (const component of plugin.components) this.#builder.registry.register(component);
        for (const presenter of Object.values(plugin.presenters)) this.#builder.presenters.register(presenter);
      }
      this.#host = host;
      return null;
    } catch (error) {
      return reasonOf(error);
    }
  }

  /** The input of each plugin at a frame: the projection of its simulation, else its key of the page input. */
  #inputOf(host: PluginHost, frame: FrameState, input: unknown): PluginInputs {
    const out: Record<string, unknown> = {};
    for (const plugin of host.plugins) {
      if (Object.hasOwn(frame.projections, plugin.id)) out[plugin.id] = frame.projections[plugin.id];
      else if (isRecord(input) && Object.hasOwn(input, plugin.id)) out[plugin.id] = input[plugin.id];
    }
    return out;
  }
}
