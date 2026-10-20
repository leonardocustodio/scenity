// SPDX-License-Identifier: Apache-2.0
/**
 * The edits of a material document: a value, the type, a texture slot and the settings of a texture slot. Each edit
 * gives a new document that the schema of `scenity.material/1` reads, or throws an EditError and changes nothing. A
 * change of the type keeps only the fields and the slots of the new type. The functions are pure. No Vue import, no
 * DOM.
 */
import {
  MATERIAL_COMMON_FIELDS,
  MATERIAL_FIELDS,
  MATERIAL_SLOTS_OF,
  materialDocumentSchema,
  type MaterialDocument,
  type MaterialSlot,
  type MaterialTexture,
  type MaterialType,
} from "@scenity/scene/schema/material";
import { EditError } from "../ops";

type Values = Record<string, unknown>;

/** The document of a value, or an EditError with the first problem of the schema. */
function checked(value: Values): MaterialDocument {
  const read = materialDocumentSchema.safeParse(value);
  if (read.success) return read.data;
  const issue = read.error.issues[0];
  const where = issue === undefined || issue.path.length === 0 ? "" : `${issue.path.join("/")}: `;
  throw new EditError(`The material is not valid (${where}${issue?.message ?? "no reason"}).`);
}

/** A copy of an object with `key` set to `value`, or with no `key` for undefined. */
function withKey(object: Readonly<Values>, key: string, value: unknown): Values {
  const next = Object.fromEntries(Object.entries(object).filter(([name]) => name !== key));
  if (value !== undefined) next[key] = value;
  return next;
}

/** The document with one value set. Undefined removes the value (the runtime then uses its default). */
export function setMaterialValue(doc: MaterialDocument, key: string, value: unknown): MaterialDocument {
  if (key === "format" || key === "maps") throw new EditError(`The field "${key}" has its own edit.`);
  if (key === "type") return setMaterialType(doc, value as MaterialType);
  return checked(withKey(doc, key, value));
}

/** The document with another type: the fields and the texture slots that the new type does not take go. */
export function setMaterialType(doc: MaterialDocument, type: MaterialType): MaterialDocument {
  if (!Object.hasOwn(MATERIAL_FIELDS, type)) throw new EditError(`"${type}" is not a material type.`);
  const fields = MATERIAL_FIELDS[type];
  const next: Values = { type };
  for (const [key, value] of Object.entries(doc)) {
    if (key === "type" || key === "maps") continue;
    if (MATERIAL_COMMON_FIELDS.has(key) || fields.includes(key)) next[key] = value;
  }
  const slots = MATERIAL_SLOTS_OF[type];
  const maps = Object.entries(doc.maps ?? {}).filter(([slot]) => slots.includes(slot as MaterialSlot));
  if (maps.length > 0) next.maps = Object.fromEntries(maps);
  return checked(next);
}

/** The document with a texture in a slot (the other settings of the slot stay), or with no texture for null. */
export function setMaterialMap(doc: MaterialDocument, slot: MaterialSlot, texture: string | null): MaterialDocument {
  const others = Object.entries(doc.maps ?? {}).filter(([name]) => name !== slot);
  const maps = Object.fromEntries(texture === null ? others : [...others, [slot, { ...doc.maps?.[slot], texture }]]);
  return checked(withKey(doc, "maps", Object.keys(maps).length === 0 ? undefined : maps));
}

/** The keys of the settings of a texture slot. */
export type MapSetting = Exclude<keyof MaterialTexture, "texture">;

/** The document with one setting of a texture slot (colour space, repeat, offset). Undefined removes it. */
export function setMaterialMapSetting(
  doc: MaterialDocument,
  slot: MaterialSlot,
  key: MapSetting,
  value: unknown,
): MaterialDocument {
  const map = doc.maps?.[slot];
  if (map === undefined) throw new EditError(`The material has no ${slot} map.`);
  const maps = { ...doc.maps, [slot]: withKey(map, key, value) };
  return checked({ ...doc, maps });
}

/** The document with a new name: the name of a new material asset from the current values. */
export function renamedMaterial(doc: MaterialDocument, name: string): MaterialDocument {
  const trimmed = name.trim();
  return checked(withKey(doc, "name", trimmed === "" ? undefined : trimmed));
}

/** The file name of a new material asset with a name: the safe letters of the name and `.material.json`. */
export function materialFileName(name: string): string {
  const stem = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `${stem === "" ? "material" : stem.slice(0, 60)}.material.json`;
}
