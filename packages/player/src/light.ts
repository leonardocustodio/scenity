// SPDX-License-Identifier: Apache-2.0
/**
 * The light player: a player of a plugin core with no document reader. The core of a project plugin draws its own
 * scene, so the page needs no zod, no scene schemas, no evaluator, no generic scene worker and no plugin bundle. The
 * page gives the scene document and the plugin core. A simulation source or `setInput` gives the input. The clock,
 * the fallbacks, the poster, the quality ladder and the embed API are those of the full player.
 *
 *     import { createLightPlayer } from "@scenity/player/light";
 *     const player = createLightPlayer(container, { scene, core, source, tier: "high" });
 *     player.watchPoints(["entity:member-ada"]);
 *     player.on("points", (frame) => place(frame));
 */
import { chooseBackend } from "@scenity/runtime/backend";
import { ASSET_MANIFEST_FORMAT } from "@scenity/scene/manifest";
import type { SceneDocument } from "@scenity/scene/schema/documents";
import { browserBase } from "./browserBase";
import type { PlayerDeps } from "./deps";
import { createPlayerWith } from "./player";
import type { PlayerContent } from "./project";
import { loadPluginCore } from "./source";
import type { Player, PlayerOptions, PlayerPluginCore } from "./types";

/** The options of a light player: the scene is a document, and the core is a plugin core. */
export interface LightPlayerOptions extends Omit<PlayerOptions, "scene" | "sequence" | "simulation"> {
  readonly scene: SceneDocument;
  readonly core: PlayerPluginCore;
}

/** The content of a light player: the scene document of the options, with no sequence and no asset manifest. */
export function lightContent(options: PlayerOptions): Promise<PlayerContent> {
  if (typeof options.scene !== "object") {
    return Promise.reject(new Error("the light player needs a scene document"));
  }
  if (options.sequence !== undefined && options.sequence !== null) {
    return Promise.reject(new Error("the light player plays no sequence: use createPlayer"));
  }
  return Promise.resolve({
    scene: options.scene,
    sequence: null,
    manifest: { format: ASSET_MANIFEST_FORMAT, tiers: [], records: [] },
    files: {},
    origin: "none",
    warnings: [],
    project: null,
    sceneUrl: null,
  });
}

/** The browser parts of a light player. The client and the worker come from the plugin core (player.ts). */
export function lightDeps(): PlayerDeps {
  return {
    ...browserBase(),
    content: lightContent,
    load: loadPluginCore,
    timeline: () => {
      throw new Error("the light player plays no sequence: use createPlayer");
    },
    createClient: () => Promise.reject(new Error("the light player needs a plugin core")),
    chooseBackend: () => chooseBackend(),
    workerUrl: null,
    loadPlugins: () => Promise.resolve([]),
    decoders: {},
    createAudio: null,
  };
}

/** Make a light player on a canvas, or on a container element where the player makes a canvas that fills it. */
export function createLightPlayer(target: HTMLCanvasElement | HTMLElement, options: LightPlayerOptions): Player {
  return createPlayerWith(target, options, lightDeps());
}
