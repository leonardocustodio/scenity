// SPDX-License-Identifier: Apache-2.0
/**
 * The material part of the script API of the scene page, in the edit mode. The
 * tests and the tools open a material asset, change a value or a texture slot, assign a material asset to a part of
 * an entity and make a new material through the same paths as the panel. Each change waits for the frame of the
 * core that shows it. A refused edit gives its reason.
 */
import {
  EditError,
  setMaterialMap,
  setMaterialMapSetting,
  setMaterialValue,
  type MapSetting,
  type MaterialTarget,
} from "@scenity/editor-core";
import type { MaterialDocument, MaterialSlot } from "@scenity/scene/schema/material";
import type { ScenePageEditor } from "../sceneEditor";
import type { PageMaterials } from "./pageMaterials";

/** The material part of the script API. */
export interface MaterialApi {
  /** Open a material asset (`asset:<id>`) in the panel. Return its current document. */
  materialOpen(ref: string): Promise<MaterialDocument>;
  /** The current document of an open material (default: the material of the panel), or null. */
  material(ref?: string): MaterialDocument | null;
  /** Set a value of an open material (undefined removes it): one step of the history. The reason of a refusal. */
  materialSet(ref: string, key: string, value: unknown): Promise<string | null>;
  /** Set the texture of a slot (null removes the slot) and settings of the slot: one step. */
  materialMap(
    ref: string,
    slot: MaterialSlot,
    texture: string | null,
    settings?: Partial<Record<MapSetting, unknown>>,
  ): Promise<string | null>;
  /** The parts of an entity that can take a material asset. */
  materialParts(entity: string): Promise<MaterialTarget[]>;
  /** Assign a material asset to a part of an entity (null part: the shape): one step. The reason of a refusal. */
  materialAssign(entity: string, part: string | null, ref: string | null): Promise<string | null>;
  /** Make a new material from the values of the panel. Return the reference of the new asset. */
  materialNew(name: string): Promise<string>;
  /** The open materials, the changed ones and the material of the panel. */
  materials(): { readonly open: readonly string[]; readonly dirty: readonly string[]; readonly current: string | null };
}

/** The material editor of each page editor in the edit mode. */
const pageMaterials = new WeakMap<ScenePageEditor, PageMaterials>();

/** Keep the material editor of a page editor (editMode.ts). */
export function holdMaterials(editor: ScenePageEditor, materials: PageMaterials): void {
  pageMaterials.set(editor, materials);
}

/** The reason of an EditError, or the error again. */
function reasonOf(error: unknown): string {
  if (error instanceof EditError || error instanceof Error) return error.message;
  throw error;
}

/** The material part of the script API of a page editor (empty without the edit mode). */
export function materialApi(editor: ScenePageEditor, frame: () => Promise<void>): Partial<MaterialApi> {
  const materials = pageMaterials.get(editor);
  if (materials === undefined) return {};
  const { channel } = materials;
  const change = async (ref: string, next: (doc: MaterialDocument) => MaterialDocument): Promise<string | null> => {
    try {
      channel.set(ref, next(channel.doc(ref)));
    } catch (error) {
      return reasonOf(error);
    }
    await materials.settled();
    await frame();
    return null;
  };
  return {
    materialOpen: (ref) => materials.open(ref),
    material: (ref) => {
      const key = ref ?? materials.current;
      return key === null || channel.path(key) === null ? null : channel.doc(key);
    },
    materialSet: (ref, key, value) => change(ref, (doc) => setMaterialValue(doc, key, value)),
    materialMap: (ref, slot, texture, settings = {}) =>
      change(ref, (doc) => {
        let next = setMaterialMap(doc, slot, texture);
        for (const [key, value] of Object.entries(settings)) {
          next = setMaterialMapSetting(next, slot, key as MapSetting, value);
        }
        return next;
      }),
    materialParts: (entity) => materials.targets(entity),
    materialAssign: async (entity, part, ref) => {
      try {
        await materials.assign(entity, part, ref);
      } catch (error) {
        return reasonOf(error);
      }
      await materials.settled();
      await frame();
      return null;
    },
    materialNew: async (name) => {
      const ref = await materials.create(name);
      await materials.settled();
      return ref;
    },
    materials: () => ({ open: channel.opened(), dirty: channel.dirtyRefs(), current: materials.current }),
  };
}
