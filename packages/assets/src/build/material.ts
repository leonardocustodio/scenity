// SPDX-License-Identifier: Apache-2.0
/**
 * The build of a material asset: the material document `*.material.json` in `<id>.material.json`. The reader checks
 * the document, and the canonical writer writes it. The record of the manifest lists the texture assets of the
 * document in `dependencies`, and its stats give the material type.
 *
 * A texture reference must name a texture asset of the project. A colour space of a reference that differs from the
 * colour space of the import settings of the texture gives a warning. The build encodes the pixels for the colour
 * space of the texture (build/project.ts), and the runtime reads them with the colour space of the reference.
 */
import { MATERIAL_SLOTS, materialTextureRefs, parseRef, SLOT_COLOUR_SPACES, writeDocument } from "@scenity/scene";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { AssetDatabase } from "../database";
import { readMaterial } from "../import/materialImporter";
import type { ImporterRegistry } from "../import/registry";
import type { AssetEntry } from "../types";
import type { Finding } from "./checks";
import { recordSettings } from "./projectInputs";

export interface MaterialOutput {
  readonly file: string;
  readonly bytes: Uint8Array;
  readonly stats: { readonly type: string };
  /** The IDs of the texture assets of the document, then the other dependencies of the record. */
  readonly dependencies: readonly string[];
}

/** The built file of a material asset, its stats and its dependencies, or null after an error finding. */
export function materialOutput(
  dir: string,
  entry: AssetEntry,
  db: AssetDatabase,
  registry: ImporterRegistry,
  findings: Finding[],
): MaterialOutput | null {
  const error = (message: string): null => {
    findings.push({ level: "error", asset: entry.id, message });
    return null;
  };
  if (entry.hash === null) return error(`the source ${entry.sourcePath} does not exist`);
  let doc;
  try {
    doc = readMaterial(readFileSync(join(dir, entry.sourcePath), "utf8"), entry.sourcePath);
  } catch (cause) {
    return error(cause instanceof Error ? cause.message : String(cause));
  }
  const textures: string[] = [];
  for (const ref of materialTextureRefs(doc)) {
    const id = parseRef(ref)?.id ?? ref;
    const texture = db.get(id);
    if (texture === undefined) return error(`the texture asset ${id} does not exist`);
    if (texture.kind !== "texture") return error(`the asset ${id} is a ${texture.kind}, not a texture`);
    textures.push(id);
  }
  for (const slot of MATERIAL_SLOTS) {
    const map = doc.maps?.[slot];
    if (map === undefined) continue;
    const texture = db.get(parseRef(map.texture)?.id ?? "");
    const read = texture === undefined ? undefined : recordSettings(texture, registry);
    const imported = read !== undefined && "settings" in read ? read.settings.colorSpace : undefined;
    const wanted = map.colorSpace ?? SLOT_COLOUR_SPACES[slot];
    if (typeof imported === "string" && imported !== wanted) {
      const message = `the ${slot} map reads ${texture?.id ?? ""} as ${wanted}, but its import settings say ${imported}`;
      findings.push({ level: "warning", asset: entry.id, message });
    }
  }
  const dependencies = [...textures, ...entry.dependencies.filter((id) => !textures.includes(id))];
  const bytes = new TextEncoder().encode(writeDocument(doc));
  return { file: `${entry.id}.material.json`, bytes, stats: { type: doc.type }, dependencies };
}
