// SPDX-License-Identifier: Apache-2.0
/**
 * The dev document client: the document client of the runtime over the dev document core, with the debug layers, the
 * inspect report and the rule check. With a worker (the dev scene worker, worker.ts), the dev methods are messages. On
 * the main thread, they call the core.
 *
 *     import devSceneWorkerUrl from "@scenity/runtime-dev/document/worker?worker&url";
 *     const client = await createDevDocumentClient(canvas, { workerUrl: devSceneWorkerUrl, ... });
 *     client.setDebug(["bounds", "skeleton"]);
 *     const report = await client.inspect();
 *     const results = await client.checkRules({ rules });
 *     const picture = await client.previewCamera("front", 320);
 */
import type { ClipPreview } from "@scenity/runtime";
import { createSceneClient, type SceneLink } from "@scenity/runtime/client";
import type { MetricPlugin } from "@scenity/rules";
import { mainPlugins, type DocumentClient, type DocumentClientOptions } from "@scenity/runtime/documentClient";
import type { ExtensionMessage } from "@scenity/runtime/protocol";
import type { DevDocumentCore } from "./devDocumentCore";
import { plainGhosts, type GhostSpec } from "./ghostCopies";
import { plainOnion, type OnionCopiesSpec } from "./onionCopies";
import type { RuleResult } from "@scenity/rules";
import type { SceneDevFromWorker, SceneDevToWorker } from "./messages";
import type { SceneInspectReport } from "./report";
import type { RuleCheckRequest } from "./ruleCheck";
import { plainScenePanes, type ScenePanes } from "./splitView";

/** The dev methods of the client. */
export interface SceneDevMethods {
  /** Show the debug layers of the names and hide every other layer. */
  setDebug(layers: readonly string[]): void;
  /** The inspect report of the last frame, or null when the client stops first. */
  inspect(): Promise<SceneInspectReport | null>;
  /** The results of rules on the scene (ruleCheck.ts), or null when the client stops first. */
  checkRules(request: RuleCheckRequest): Promise<readonly RuleResult[] | null>;
  /**
   * A picture of the view of a document camera (null: the first one), `width` pixels wide with the aspect of the
   * canvas, or null. The canvas never shows the preview. `at` gives the scene at that time, only for the picture.
   */
  previewCamera(name: string | null, width: number, at?: number | null): Promise<ImageBitmap | null>;
  /** Divide the canvas into the panes of the split view (splitView.ts). */
  setPanes(panes: ScenePanes): void;
  /** The onion skins of an entity (onionCopies.ts); null removes them. */
  setOnion(spec: OnionCopiesSpec | null): void;
  /** The ghosts of the changes that wait (ghostCopies.ts); null removes them. */
  setGhosts(spec: GhostSpec | null): void;
  /** Play a clip on an entity at the time of each frame (the clip browser); null stops it. */
  previewClip(preview: ClipPreview | null): void;
  /** The simulation states of the plugins at the time of the last frame, or null when the client stops first. */
  simulations(): Promise<Record<string, unknown> | null>;
}

export type DevDocumentClient = DocumentClient & SceneDevMethods;

/** A plain copy of a preview clip (a Vue proxy does not go through `postMessage`). */
function plainPreview(preview: ClipPreview | null): ClipPreview | null {
  if (preview === null) return null;
  const { entity, clip, name } = preview;
  return { entity, clip, ...(name === undefined ? {} : { name }) };
}

/** The dev methods as messages to the dev scene worker. `stop` ends the requests that wait. */
function workerMethods(link: Extract<SceneLink<DevDocumentCore>, { mode: "worker" }>) {
  const waiting = new Map<number, (answer: SceneDevFromWorker | null) => void>();
  let nextId = 1;
  link.listen((message: ExtensionMessage) => {
    if (!["sceneInspected", "rulesChecked", "cameraPreviewed", "simulationsInspected"].includes(message.type)) return;
    const answer = message as SceneDevFromWorker;
    waiting.get(answer.id)?.(answer);
    waiting.delete(answer.id);
  });
  /** Send a request with a new ID and wait for its answer (null when the client stops first). */
  const ask = (make: (id: number) => SceneDevToWorker): Promise<SceneDevFromWorker | null> =>
    new Promise((resolve) => {
      const id = nextId;
      nextId += 1;
      waiting.set(id, resolve);
      link.send(make(id));
    });
  return {
    setDebug: (layers: readonly string[]) => {
      link.send({ type: "debug", layers: [...layers] } satisfies SceneDevToWorker);
    },
    inspect: async () => {
      const answer = await ask((id) => ({ type: "inspectScene", id }));
      return answer?.type === "sceneInspected" ? answer.report : null;
    },
    checkRules: async (request: RuleCheckRequest) => {
      const answer = await ask((id) => ({ type: "checkRules", id, request }));
      return answer?.type === "rulesChecked" ? answer.results : null;
    },
    previewCamera: async (name: string | null, width: number, at: number | null = null) => {
      const answer = await ask((id) => ({ type: "previewCamera", id, name, width, at }));
      return answer?.type === "cameraPreviewed" ? answer.picture : null;
    },
    setPanes: (panes: ScenePanes) => {
      link.send({ type: "scenePanes", panes: plainScenePanes(panes) } satisfies SceneDevToWorker);
    },
    setOnion: (spec: OnionCopiesSpec | null) => {
      link.send({ type: "sceneOnion", spec: plainOnion(spec) } satisfies SceneDevToWorker);
    },
    setGhosts: (spec: GhostSpec | null) => {
      link.send({ type: "sceneGhosts", spec: plainGhosts(spec) } satisfies SceneDevToWorker);
    },
    previewClip: (preview: ClipPreview | null) => {
      link.send({ type: "sceneClipPreview", preview: plainPreview(preview) } satisfies SceneDevToWorker);
    },
    simulations: async () => {
      const answer = await ask((id) => ({ type: "inspectSimulations", id }));
      return answer?.type === "simulationsInspected" ? answer.states : null;
    },
    stop: () => {
      for (const done of waiting.values()) done(null);
      waiting.clear();
    },
  };
}

/** The dev methods on the core of the main thread. */
function mainMethods(core: DevDocumentCore): SceneDevMethods {
  return {
    setDebug: (layers) => {
      core.setDebug(layers);
    },
    inspect: () => Promise.resolve(core.inspect()),
    checkRules: (request) => Promise.resolve(core.checkRules(request)),
    previewCamera: (name, width, at) => core.previewCamera(name, width, at ?? null),
    setPanes: (panes) => {
      core.setPanes(plainScenePanes(panes));
    },
    setOnion: (spec) => {
      core.setOnion(plainOnion(spec));
    },
    setGhosts: (spec) => {
      core.setGhosts(plainGhosts(spec));
    },
    previewClip: (preview) => {
      core.previewClip(plainPreview(preview));
    },
    simulations: () => Promise.resolve(core.simulations()),
  };
}

/**
 * Create the dev document client on a canvas: the dev scene worker when the page gives its URL and the browser can run
 * it, else the dev document core on the main thread (one chunk per backend).
 */
export async function createDevDocumentClient(
  canvas: HTMLCanvasElement,
  options: DocumentClientOptions & {
    /** The metric faces of the plugins for the main-thread core (a worker loads its own). */
    readonly metrics?: () => Promise<readonly MetricPlugin[]>;
  },
): Promise<DevDocumentClient> {
  let link: SceneLink<DevDocumentCore> | null = null;
  const client = await createSceneClient<unknown, DevDocumentCore>(
    canvas,
    {
      ...(options as Omit<DocumentClientOptions, "link">),
      link: (made) => {
        link = made;
        // The page can also read the link (for example, for the selection outline).
        options.link?.(made);
      },
    },
    async (backend) => {
      const entry = await (backend === "webgpu" ? import("./coreGpu") : import("./coreGl"));
      // The main-thread core gets the project plugins of the page.
      return (base) => {
        const core = entry.createDocumentCore({ ...base, ...mainPlugins(options) });
        void options.metrics?.().then((list) => {
          core.useMetrics(list);
        });
        return Promise.resolve(core);
      };
    },
  );
  const made = link as SceneLink<DevDocumentCore> | null;
  if (made === null) throw new Error("the scene client gave no link");
  if (made.mode === "main") return { ...client, ...mainMethods(made.core) };
  const { stop, ...methods } = workerMethods(made);
  return {
    ...client,
    ...methods,
    dispose: () => {
      stop();
      client.dispose();
    },
  };
}
