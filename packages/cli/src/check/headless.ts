// SPDX-License-Identifier: Apache-2.0
/**
 * The scene core of `scenity check` with no GPU and no DOM. The check runs the dev document core of
 * `@scenity/runtime-dev` in Bun, as the metric tests do: a backend that draws nothing, a timer scheduler and a stopped
 * clock. The rule check of the core goes to each time of the scopes with an update and no render
 * (`DevDocumentCore.checkRules`), so the page and the CLI measure with the same code.
 */
import type { ComponentRegistry, SceneDocument } from "@scenity/scene";
import type { SequenceDocument } from "@scenity/scene/sequence";
import type { MetricPlugin, RuleResult } from "@scenity/rules";
import type { DocumentCoreOptions } from "@scenity/runtime/documentCore";
import type { RuntimePlugin } from "@scenity/runtime/plugins";
import { DevDocumentCore } from "@scenity/runtime-dev/document/devDocumentCore";
import type { RuleCheckRequest } from "@scenity/runtime-dev/document/ruleCheck";

type BackendFactory = DocumentCoreOptions["backend"];
/** The asset source of a core (the check gives its own: assets.ts). */
export type AssetSource = ReturnType<DocumentCoreOptions["assetSource"]>;
type PresenterRegistry = NonNullable<DocumentCoreOptions["presenters"]>;
type Renderer = ReturnType<BackendFactory>["renderer"];

/** A backend with no GPU: it draws nothing and gives no compressed texture format. */
const noGpuBackend: BackendFactory = () => {
  const renderer = {
    domElement: {} as OffscreenCanvas,
    shadowMap: { enabled: false, type: 1 },
    setPixelRatio: () => undefined,
    setSize: () => undefined,
    getSize: (target) => target,
    render: () => undefined,
    getPixelRatio: () => 1,
    setViewport: () => undefined,
    setScissor: () => undefined,
    setScissorTest: () => undefined,
  } as Renderer;
  return {
    kind: "webgl",
    renderer,
    isReady: () => true,
    ready: Promise.resolve(),
    render: () => undefined,
    info: () => ({ calls: 0, triangles: 0 }),
    memory: () => ({ geometries: 0, textures: 0, programs: 0 }),
    timer: () => null,
    textureSupport: () => ({ gpuFeatures: { has: () => false } }),
    dispose: () => undefined,
  };
};

/** The registries of the plugins of the project; absent: the built-in ones. */
export interface HeadlessRegistries {
  readonly registry?: ComponentRegistry;
  readonly presenters?: PresenterRegistry;
  /** The metric faces of the plugins: their metrics go to the registry of the rule check. */
  readonly metrics?: readonly MetricPlugin[];
  /**
   * The runtime faces of the plugins. The core runs their simulations and systems, so a rule measures the
   * outputs of the systems (the place of a car of a simulation). With plugins, the core makes its own registries.
   */
  readonly plugins?: readonly RuntimePlugin[];
}

/** The registry options of the core: the plugins, else the registries of the plugin host, else none. */
function registryOptions(registries: HeadlessRegistries): Partial<DocumentCoreOptions> {
  if (registries.plugins !== undefined && registries.plugins.length > 0) return { plugins: registries.plugins };
  return {
    ...(registries.registry === undefined ? {} : { registry: registries.registry }),
    ...(registries.presenters === undefined ? {} : { presenters: registries.presenters }),
  };
}

/** A dev document core with no GPU over an asset source. The clock stands at 0 ms. */
export class HeadlessScene {
  readonly #core: DevDocumentCore;

  constructor(assets: AssetSource, registries: HeadlessRegistries = {}) {
    this.#core = new DevDocumentCore({
      canvas: {} as OffscreenCanvas,
      surface: { width: 640, height: 400, dpr: 1 },
      tier: "high",
      flags: { reducedMotion: false, paused: true, visible: true },
      clock: () => 0,
      now: () => performance.now(),
      scheduler: {
        request: (callback) => setTimeout(callback, 0) as unknown as number,
        cancel: (handle) => {
          clearTimeout(handle);
        },
      },
      mode: "main",
      events: { ready: () => undefined, anchors: () => undefined, hit: () => undefined, context: () => undefined },
      backend: noGpuBackend,
      assetSource: () => assets,
      ...registryOptions(registries),
    });
    for (const plugin of registries.metrics ?? []) {
      this.#core.useDevPlugin({ id: plugin.id, layers: [], library: plugin.library ?? [] }, () => undefined);
    }
    this.#core.start();
  }

  /** Load a scene and an optional sequence over it, and wait for the frame that shows them with their assets. */
  async load(scene: SceneDocument, sequence: SequenceDocument | null): Promise<void> {
    const result = await this.#core.load({ documents: { scene, ...(sequence === null ? {} : { sequence }) } });
    if (!result.ok) throw new Error(`the scene ${scene.id} does not load: ${result.reason}`);
    await this.#core.patch([]);
  }

  /** Evaluate rules on the loaded scene at the times of their scopes. */
  check(request: RuleCheckRequest): RuleResult[] {
    return this.#core.checkRules(request);
  }

  dispose(): void {
    this.#core.dispose();
  }
}
