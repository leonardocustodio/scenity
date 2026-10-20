// SPDX-License-Identifier: Apache-2.0
/**
 * The scene file requests of the host (sceneFileProtocol.ts): `scene.read` gives the
 * text and the hash of a `*.scene.json` file of the project, and `scene.save` writes the canonical form of a scene
 * document atomically with the writer of `@scenity/cli/sceneFile`. The path is relative to the project folder. The
 * denylist of the workbench (denylist.ts) also applies to its path in the checkout. The role check of the router
 * refuses a save of a viewer page (roleProtocol.ts). A save that changed the file sends `scene.saved`, so the Changes
 * tab loads again and shows the JSON diff of the file.
 *
 * The writer runs the rule gate (`@scenity/cli/sceneFile` ruleGate.ts): a failed `block` rule refuses the save
 * unless the request carries a reason of the owner. The host keeps that reason for the commit message proposal of the
 * Changes tab (commitNotes.ts), as the reason of a layout override of "Save placement".
 *
 * `scene.create` writes a new empty scene file with the same writer (`createSceneFile`): the path checks, the
 * denylist and the role check of a save apply. A project file that lists its scenes also lists the new path. A save
 * as is a `scene.save` to a new path with no base hash, so the rule gate applies to it.
 *
 * A save with no rule results for its text (a save of Claude or of a tool) gets the results of `scenity
 * check` (`saveMeasured` of `@scenity/cli/check`). The host loads that entry on demand: it holds the runtime.
 */
import { join, relative, sep } from "node:path";
import {
  createSceneFile,
  isSceneSaveParams,
  readSceneFile,
  saveSceneFile,
  sceneTextHash,
  type SceneCreateParams,
  type SceneCreateResult,
  type SceneSaveParams,
  type SceneSaveResult,
} from "@scenity/cli/sceneFile";
import { isDenied } from "./denylist";
import type { HostEvent } from "./protocol";
import { needString, type Router } from "./router";

/** The parts of the host that the scene file requests use. A test gives fakes. */
export interface SceneFileDeps {
  /** The project folder of the open checkout (absolute). */
  readonly projectDir: () => string;
  /** The open checkout (absolute): the paths of the `scene.saved` event are relative to it. */
  readonly current: () => string;
  readonly broadcast: (event: HostEvent) => void;
  /** Keep the reason of a rule override for the commit message proposal. Absent: the log file only. */
  readonly noteOverride?: (reason: string) => void;
}

/** The path of a project file relative to the checkout, with "/". */
function checkoutPath(deps: SceneFileDeps, path: string): string {
  return relative(deps.current(), join(deps.projectDir(), ...path.split("/")))
    .split(sep)
    .join("/");
}

/** The denylist check of a project path: the path itself and its path in the checkout. */
function deniedFor(deps: SceneFileDeps): (path: string) => boolean {
  return (path) => isDenied(path) || isDenied(checkoutPath(deps, path)) || isDenied(join(deps.projectDir(), path));
}

/** Save with the writer. The writer gate measures the rules when the page sent no results for the text. */
async function writeSave(dir: string, params: SceneSaveParams, denied: (path: string) => boolean) {
  if (params.checks?.hash === sceneTextHash(params.text)) return saveSceneFile(dir, params, { denied });
  const { saveMeasured } = await import("@scenity/cli/check");
  return saveMeasured(dir, params, { denied });
}

/** Save a scene file (the handler of `scene.save`). */
export async function saveScene(deps: SceneFileDeps, params: unknown): Promise<SceneSaveResult> {
  if (!isSceneSaveParams(params)) {
    throw new Error(
      'A save needs "path" and "text" (texts) and "baseHash" (a SHA-256 in hex, or null); "checks" and "reason" are optional.',
    );
  }
  const { path, text, baseHash, force, checks, reason } = params;
  const result = await writeSave(
    deps.projectDir(),
    {
      ...{ path, text, baseHash },
      ...(force === undefined ? {} : { force }),
      ...(checks === undefined ? {} : { checks }),
      ...(reason === undefined ? {} : { reason }),
    },
    deniedFor(deps),
  );
  if (result.ok && result.override !== undefined) deps.noteOverride?.(`${path}: ${result.override}`);
  if (result.ok && result.changed) {
    deps.broadcast({ type: "scene.saved", path: checkoutPath(deps, path), hash: result.hash });
  }
  return result;
}

/** Create a new scene file (the handler of `scene.create`). A create sends `scene.saved` for the new file. */
export function createScene(deps: SceneFileDeps, params: unknown): SceneCreateResult {
  const fields = (typeof params === "object" && params !== null ? params : {}) as Partial<SceneCreateParams>;
  const result = createSceneFile(deps.projectDir(), fields as SceneCreateParams, { denied: deniedFor(deps) });
  if (result.ok) deps.broadcast({ type: "scene.saved", path: checkoutPath(deps, result.path), hash: result.hash });
  return result;
}

/** Add the handlers of the scene file requests to the router of the host. */
export function addSceneFileHandlers(router: Router, deps: SceneFileDeps): void {
  router
    .on("scene.read", (params) =>
      readSceneFile(deps.projectDir(), needString(params, "path"), { denied: deniedFor(deps) }),
    )
    .on("scene.save", (params) => saveScene(deps, params))
    .on("scene.create", (params) => createScene(deps, params));
}
