// SPDX-License-Identifier: Apache-2.0
/**
 * The material overrides of a model: each mesh of the clone of a model gets the override of its part. A key
 * `mesh:<name>` names a mesh or a node: the nearest named node from the mesh up to the root of the clone wins. Another
 * key names a material of the model. A mesh key comes before a material key.
 *
 * An override with `material` uses the shared material of the material asset (scene/materials.ts). An override with
 * values (colour, roughness, metalness, opacity) changes a copy of the material of the part, or of the material asset.
 * The overrides own these copies. A new override value restores the original materials, disposes the copies and
 * applies the new overrides to the same clone: the presenter makes no new clone.
 */
import { Color, type Material, type Mesh, type Object3D } from "three";
import { MESH_PART_PREFIX, type ModelValue } from "@scenity/scene/components";
import { setColour } from "../colour";

type Overrides = NonNullable<ModelValue["materials"]>;
type MaterialOverride = Overrides[string];

/** The override state of the clone of one model. */
export interface OverrideState {
  /** The original material of each mesh that an override changed. */
  readonly originals: Map<Mesh, Material | Material[]>;
  /** The material copies of the overrides. */
  copies: Material[];
}

/** True when an override changes a value of the material (and thus needs a copy). */
function hasValues(override: MaterialOverride): boolean {
  return (
    override.colour !== undefined ||
    override.roughness !== undefined ||
    override.metalness !== undefined ||
    override.opacity !== undefined
  );
}

/** A copy of a material with the values of an override. */
function copyWithValues(material: Material, override: MaterialOverride): Material {
  const copy = material.clone() as Material & { color?: unknown; roughness?: unknown; metalness?: unknown };
  if (override.colour !== undefined && copy.color instanceof Color) setColour(copy.color, override.colour);
  if (override.roughness !== undefined && typeof copy.roughness === "number") copy.roughness = override.roughness;
  if (override.metalness !== undefined && typeof copy.metalness === "number") copy.metalness = override.metalness;
  if (override.opacity !== undefined) {
    copy.opacity = override.opacity;
    copy.transparent = override.opacity < 1;
  }
  return copy;
}

/** The material asset references of the overrides, one time each, in key order. */
export function overrideMaterialRefs(overrides: ModelValue["materials"]): string[] {
  const refs = new Set<string>();
  for (const key of Object.keys(overrides ?? {}).sort()) {
    const ref = overrides?.[key]?.material;
    if (ref !== undefined) refs.add(ref);
  }
  return [...refs];
}

/** The key of the mesh override of a mesh: the nearest node from the mesh up to `root` with a mesh key. */
function meshKey(mesh: Object3D, root: Object3D, overrides: Overrides): string | undefined {
  for (let node: Object3D | null = mesh; node !== null; node = node.parent) {
    const key = MESH_PART_PREFIX + node.name;
    if (node.name !== "" && Object.hasOwn(overrides, key)) return key;
    if (node === root) break;
  }
  return undefined;
}

/** Restore the original materials and dispose the copies. */
export function clearOverrides(state: OverrideState): void {
  for (const [mesh, material] of state.originals) mesh.material = material;
  state.originals.clear();
  for (const copy of state.copies) copy.dispose();
  state.copies = [];
}

/**
 * Apply the overrides to each mesh under `root`. `loaded` gives the shared material of each material asset. An
 * override with a material that did not load keeps the material of the part. Each pair of an override key and a
 * source material gets at most one copy.
 */
export function applyOverrides(
  root: Object3D,
  overrides: ModelValue["materials"],
  loaded: ReadonlyMap<string, Material>,
  state: OverrideState,
): void {
  if (overrides === undefined) return;
  const made = new Map<string, Map<Material, Material>>();
  const resolve = (key: string, source: Material): Material => {
    const override = overrides[key];
    if (override === undefined) return source;
    const base = (override.material === undefined ? undefined : loaded.get(override.material)) ?? source;
    if (!hasValues(override)) return base;
    const byKey = made.get(key) ?? new Map<Material, Material>();
    made.set(key, byKey);
    let copy = byKey.get(base);
    if (copy === undefined) {
      copy = copyWithValues(base, override);
      byKey.set(base, copy);
      state.copies.push(copy);
    }
    return copy;
  };
  root.traverse((node) => {
    if (!(node as Partial<Mesh>).isMesh) return;
    const mesh = node as Mesh;
    const key = meshKey(mesh, root, overrides);
    const swap = (material: Material) => resolve(key ?? material.name, material);
    const next = Array.isArray(mesh.material) ? mesh.material.map(swap) : swap(mesh.material);
    const same = Array.isArray(next)
      ? next.every((material, index) => material === (mesh.material as Material[])[index])
      : next === mesh.material;
    if (same) return;
    state.originals.set(mesh, mesh.material);
    mesh.material = next;
  });
}
