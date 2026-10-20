// SPDX-License-Identifier: Apache-2.0
/**
 * The dev messages of a document core in the "extension" envelope of the protocol: the debug layers, the inspect
 * report of the scene, the rule check, the camera preview, the split view, the onion skins, the ghosts, the clip
 * preview and the simulation states. The dev scene worker (worker.ts) handles them. The dev document client
 * (client.ts) sends them.
 */
import type { ClipPreview } from "@scenity/runtime";
import type { ExtensionMessage } from "@scenity/runtime/protocol";
import type { RuleResult } from "@scenity/rules";
import type { SceneInspectReport } from "./report";
import type { RuleCheckRequest } from "./ruleCheck";
import type { ScenePanes } from "./splitView";
import type { GhostSpec } from "./ghostCopies";
import type { OnionCopiesSpec } from "./onionCopies";

export type SceneDevToWorker =
  /** The debug layers over the scene: the core hides each other layer. */
  | { readonly type: "debug"; readonly layers: readonly string[] }
  /** Answer "sceneInspected" with the inspect report of the last frame. */
  | { readonly type: "inspectScene"; readonly id: number }
  /** Answer "rulesChecked" with the results of the rules on the scene. */
  | { readonly type: "checkRules"; readonly id: number; readonly request: RuleCheckRequest }
  /** Answer "cameraPreviewed" with a picture of the view of a document camera. */
  | {
      readonly type: "previewCamera";
      readonly id: number;
      readonly name: string | null;
      readonly width: number;
      /** The time of the picture (ms), or null for the time of the page. */
      readonly at?: number | null;
    }
  /** The panes of the split view of the Scene view. */
  | { readonly type: "scenePanes"; readonly panes: ScenePanes }
  /** The onion skins of an entity (null: none). */
  | { readonly type: "sceneOnion"; readonly spec: OnionCopiesSpec | null }
  /** The ghosts of the changes that wait (null: none). */
  | { readonly type: "sceneGhosts"; readonly spec: GhostSpec | null }
  /** The preview clip of the clip browser (null: none). */
  | { readonly type: "sceneClipPreview"; readonly preview: ClipPreview | null }
  /** Answer "simulationsInspected" with the simulation states of the last frame. */
  | { readonly type: "inspectSimulations"; readonly id: number };

export type SceneDevFromWorker =
  | { readonly type: "sceneInspected"; readonly id: number; readonly report: SceneInspectReport }
  | { readonly type: "rulesChecked"; readonly id: number; readonly results: readonly RuleResult[] }
  | { readonly type: "cameraPreviewed"; readonly id: number; readonly picture: ImageBitmap | null }
  | { readonly type: "simulationsInspected"; readonly id: number; readonly states: Record<string, unknown> };

/** The dev methods of a document core that the messages call. */
export interface SceneDevCore {
  setDebug(layers: readonly string[]): void;
  inspect(): SceneInspectReport;
  checkRules(request: RuleCheckRequest): RuleResult[];
  previewCamera(name: string | null, width: number, at?: number | null): Promise<ImageBitmap | null>;
  setPanes(panes: ScenePanes): void;
  setOnion(spec: OnionCopiesSpec | null): void;
  setGhosts(spec: GhostSpec | null): void;
  previewClip(preview: ClipPreview | null): void;
  simulations(): Record<string, unknown>;
}

/**
 * Handle a dev message of the page with a dev document core; the answers go to `post`. False for another message: the
 * worker gives it to the handler of the document core.
 */
export function handleSceneDevMessage(
  input: ExtensionMessage,
  core: SceneDevCore,
  post: (message: ExtensionMessage) => void,
): boolean {
  if (input.type === "debug") {
    core.setDebug((input as Extract<SceneDevToWorker, { type: "debug" }>).layers);
    return true;
  }
  if (input.type === "scenePanes") {
    core.setPanes((input as Extract<SceneDevToWorker, { type: "scenePanes" }>).panes);
    return true;
  }
  if (input.type === "sceneOnion") {
    core.setOnion((input as Extract<SceneDevToWorker, { type: "sceneOnion" }>).spec);
    return true;
  }
  if (input.type === "sceneGhosts") {
    core.setGhosts((input as Extract<SceneDevToWorker, { type: "sceneGhosts" }>).spec);
    return true;
  }
  if (input.type === "sceneClipPreview") {
    core.previewClip((input as Extract<SceneDevToWorker, { type: "sceneClipPreview" }>).preview);
    return true;
  }
  if (input.type === "inspectSimulations") {
    const { id } = input as Extract<SceneDevToWorker, { type: "inspectSimulations" }>;
    post({ type: "simulationsInspected", id, states: core.simulations() } satisfies SceneDevFromWorker);
    return true;
  }
  if (input.type === "checkRules") {
    const { id, request } = input as Extract<SceneDevToWorker, { type: "checkRules" }>;
    post({ type: "rulesChecked", id, results: core.checkRules(request) } satisfies SceneDevFromWorker);
    return true;
  }
  if (input.type === "previewCamera") {
    const { id, name, width, at } = input as Extract<SceneDevToWorker, { type: "previewCamera" }>;
    void core.previewCamera(name, width, at ?? null).then((picture) => {
      post({ type: "cameraPreviewed", id, picture } satisfies SceneDevFromWorker);
    });
    return true;
  }
  if (input.type !== "inspectScene") return false;
  const { id } = input as Extract<SceneDevToWorker, { type: "inspectScene" }>;
  post({ type: "sceneInspected", id, report: core.inspect() } satisfies SceneDevFromWorker);
  return true;
}
