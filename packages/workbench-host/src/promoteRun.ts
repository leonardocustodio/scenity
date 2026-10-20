// SPDX-License-Identifier: Apache-2.0
/**
 * The run of a promote: the model of an import becomes a project asset and an entity of a scene document, with no
 * Claude prompt. The lab sends the bridge event `promote` for a scratch prop (sceneEdit.ts). A page or a tool sends
 * the request `asset.promote`. Both come here:
 *
 * 1. the preparation (promote.ts): the target, the refusals of the import record (no record, a failed import, over
 *    the budget) and the lines of the changes; a dry run ends here and writes nothing;
 * 2. the asset: `importProjectFile` of `@scenity/assets/projectImport` copies `normalized.glb` of the import (metres,
 *    Y up, the base centre at the origin) into the import folder, writes the record through the importer, runs the
 *    import and updates the asset database; the record points to `rights/imports.yaml`, so the release gate stops the
 *    asset until the owner records its rights;
 * 3. the entity: the op of `promoteEdit` of `@scenity/editor-core` (the `entity.add` op with the turn) on the scene
 *    document, saved with the writer of the scene files (sceneFiles.ts: the canonical form, the hash check, the rule
 *    gate and the `scene.saved` event of the Changes tab).
 */
import { existsSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { builtinRegistry, writeDocument } from "@scenity/scene";
import { applyOps } from "@scenity/scene/ops";
import { canonicalSceneText, readSceneFile } from "@scenity/cli/sceneFile";
import { importProjectFile } from "../../assets/src/projectImport";
import { promoteEdit, promotedName } from "../../editor-core/src/entities/promote";
import {
  checkoutPathOf,
  factsOf,
  inFolder,
  modelFileName,
  placeText,
  promoteChanges,
  promoteRefusal,
  promoteTarget,
  readRecord,
  type PromoteProject,
  type PromoteTarget,
} from "./promote";
import type { HostEvent } from "./protocol";
import type { Router } from "./router";
import { saveScene } from "./sceneFiles";
import { isPromoteParams, type PromoteParams, type PromoteResult } from "./scratchProtocol";

/** The parts of the host that a promote uses. A test gives fakes. */
export interface PromoteDeps {
  /** The folder of the imports in the state folder (imports.ts `ImportJobs.folder`). */
  readonly importsDir?: string;
  /** The open checkout (absolute). */
  current(): string;
  /** The project of the open checkout (absent: the checkout with the built-in manifest). */
  project?(): PromoteProject;
  /** Send an event to the pages (`scene.saved`). Absent: no event. */
  readonly broadcast?: (event: HostEvent) => void;
  /** Keep the reason of a rule override for the commit message proposal. */
  readonly noteOverride?: (reason: string) => void;
}

/** The result of a promote that the host refuses. */
function refusedResult(dry: boolean, refused: string, changes: readonly string[] = []): PromoteResult {
  return { dry, refused, changes, asset: null, entity: null, rights: null, followUp: [] };
}

/** The bytes of the model of an import: `normalized.glb`, or null. */
function modelBytes(folder: string): Uint8Array | null {
  const file = join(folder, "normalized.glb");
  return existsSync(file) ? new Uint8Array(readFileSync(file)) : null;
}

/** The root and the path of a scene file for the writer: the project folder when it holds the file, else the checkout. */
function sceneRoot(target: PromoteTarget, scene: string): { root: string; path: string } {
  const root = inFolder(target.projectDir, scene) ? target.projectDir : target.checkout;
  return { root, path: relative(root, scene).split(sep).join("/") };
}

/** Add the entity of the new asset to the scene document and save it; the entity ID, or the reason of a failure. */
async function addEntity(
  deps: PromoteDeps,
  target: PromoteTarget,
  model: { readonly asset: string; readonly name: string; readonly params: PromoteParams },
): Promise<{ ok: true; id: string; scene: string } | { ok: false; reason: string }> {
  if (target.scene === null) return { ok: false, reason: "the project names no scene document" };
  const { root, path } = sceneRoot(target, target.scene);
  const file = readSceneFile(root, path);
  const read = canonicalSceneText(file.text);
  if (!read.ok) return { ok: false, reason: read.reason };
  const { at, turnDeg } = model.params;
  const edit = promoteEdit(read.doc, {
    asset: model.asset,
    name: model.name,
    position: [at[0], at[1], at[2]],
    yaw: (turnDeg * Math.PI) / 180,
  });
  const applied = applyOps(read.doc, edit.ops, builtinRegistry());
  if (!applied.ok) return { ok: false, reason: applied.reason };
  const saveDeps = {
    projectDir: () => root,
    current: () => target.checkout,
    broadcast: deps.broadcast ?? (() => undefined),
    ...(deps.noteOverride === undefined ? {} : { noteOverride: deps.noteOverride }),
  };
  const saved = await saveScene(saveDeps, { path, text: writeDocument(applied.doc), baseHash: file.hash });
  if (!saved.ok) return { ok: false, reason: saved.conflict ? `${path} changed on the disk` : saved.reason };
  return {
    ok: true,
    id: edit.roots[0] ?? "",
    scene: checkoutPathOf(target, relative(target.projectDir, target.scene)),
  };
}

/** The promote of the model of an import: see the module comment. A refusal is a result, not an error. */
export async function promoteImport(deps: PromoteDeps, params: PromoteParams): Promise<PromoteResult> {
  const { dry } = params;
  const folder = deps.importsDir === undefined ? null : join(deps.importsDir, params.import);
  const value = folder === null ? null : readRecord(folder);
  const refused = promoteRefusal(value);
  if (refused !== null || folder === null) return refusedResult(dry, refused ?? "The host keeps no imports.");
  const checkout = deps.current();
  const target = promoteTarget(checkout, deps.project?.() ?? { dir: checkout, manifest: null }, params.scene);
  const facts = factsOf(value);
  const changes = promoteChanges(facts, target, params);
  const followUp = target.followUp;
  const rightsLine = `${checkoutPathOf(target, target.rights)}: the release gate stops the asset until the owner records its rights.`;
  if (dry) return { dry, refused: null, changes, asset: null, entity: null, rights: null, followUp };
  const bytes = modelBytes(folder);
  if (bytes === null) return refusedResult(dry, "The import has no normalized.glb: import the file again.", changes);
  const imported = await importProjectFile(target.projectDir, modelFileName(facts.name), bytes, {
    folder: target.folder,
    rights: target.rights,
    bound: checkout,
    tags: ["imported", "promoted"],
  });
  if (!imported.ok) return refusedResult(dry, `The asset was not made: ${imported.reason}.`, changes);
  const asset = {
    id: imported.entry.id,
    source: checkoutPathOf(target, imported.source),
    record: checkoutPathOf(target, imported.record),
  };
  const rights = { record: checkoutPathOf(target, imported.rights.record), blocked: true, note: rightsLine };
  const name = promotedName(facts.name);
  const entity = await addEntity(deps, target, { asset: `asset:${asset.id}`, name, params });
  if (!entity.ok) {
    const reason = `The asset ${asset.id} is in the project (${asset.record}), but the entity was not added: ${entity.reason}.`;
    return { dry, refused: reason, changes, asset, entity: null, rights, followUp };
  }
  const done = [
    `${asset.source}: the model (asset ${asset.id})`,
    `${asset.record}: the asset record`,
    `${rights.record}: the rights record of the imports (licence not known, webDelivery pending)`,
    `${entity.scene}: the entity ${entity.id} at ${placeText(params.at, params.turnDeg)}`,
    ...imported.warnings.map((warning) => `warning: ${warning}`),
  ];
  return { dry, refused: null, changes: done, asset, entity: { id: entity.id, scene: entity.scene }, rights, followUp };
}

/** Add the handler of the request `asset.promote` to the router of the host. */
export function addPromoteHandler(router: Router, deps: PromoteDeps): void {
  router.on("asset.promote", (params) => {
    if (!isPromoteParams(params)) {
      throw new Error(
        'A promote needs "import" (an import ID), "at" (3 numbers), "turnDeg" and "dry"; "scene" is optional.',
      );
    }
    return promoteImport(deps, params);
  });
}
