// SPDX-License-Identifier: Apache-2.0
/**
 * The `shape` presenter: a box, a plane, a cylinder or a sphere with a `MeshStandardMaterial`. A
 * plane lies in the XZ plane and faces +Y. A cylinder and a sphere use X as the diameter and Y as the height.
 *
 * A shape with a material asset (`material`) draws with the shared material of the asset (scene/materials.ts) at the
 * end of its load, in place of its own material. The UVs of a shape have V down, as glTF. A texture of a material
 * asset has `flipY` false (render/genericAssets.ts), so it shows the same way on a shape and on a model. An edit of
 * the material asset that gives a new material (a new type) puts the new material into the mesh.
 */
import {
  BoxGeometry,
  CylinderGeometry,
  Mesh,
  MeshStandardMaterial,
  PlaneGeometry,
  SphereGeometry,
  type BufferGeometry,
  type Material,
} from "three";
import type { ShapeValue } from "@scenity/scene/components";
import { setColour } from "../colour";
import { materialCache } from "../materials";
import type { Presenter, PresenterContext } from "../types";

/** The segments of the round shapes. */
const ROUND_SEGMENTS = 32;
/** The smallest size of a part of a shape, so that a geometry never has a zero scale. */
const MIN_SIZE = 1e-4;

type ShapeMesh = Mesh<BufferGeometry, Material>;

/** The state of a shape: its own material and the material asset that it uses. */
interface ShapeState {
  readonly own: MeshStandardMaterial;
  /** The material asset reference that the shape acquired, or undefined. */
  ref: string | undefined;
  /** Stop the watch of the edits of the material asset. */
  unwatch: () => void;
}

const states = new WeakMap<ShapeMesh, ShapeState>();

/** Invert the V coordinate of each UV, so that V goes down as in glTF. */
function vDown(geometry: BufferGeometry): BufferGeometry {
  const uv = geometry.getAttribute("uv");
  for (let index = 0; index < uv.count; index += 1) uv.setY(index, 1 - uv.getY(index));
  return geometry;
}

/** The geometry of a shape. The geometry has its centre at the origin of the entity. */
export function shapeGeometry(kind: ShapeValue["kind"], size: readonly [number, number, number]): BufferGeometry {
  const [x, y, z] = size.map((part) => Math.max(part, MIN_SIZE)) as [number, number, number];
  switch (kind) {
    case "box":
      return vDown(new BoxGeometry(x, y, z));
    case "plane":
      return vDown(new PlaneGeometry(x, z).rotateX(-Math.PI / 2));
    case "cylinder":
      return vDown(new CylinderGeometry(x / 2, x / 2, y, ROUND_SEGMENTS));
    case "sphere":
      return vDown(new SphereGeometry(x / 2, ROUND_SEGMENTS, ROUND_SEGMENTS / 2).scale(1, y / x, 1));
  }
}

function applyMaterial(mesh: ShapeMesh, state: ShapeState, value: ShapeValue): void {
  const material = state.own;
  if (value.colour !== undefined) setColour(material.color, value.colour);
  material.roughness = value.roughness ?? 0.8;
  material.metalness = value.metalness ?? 0;
  mesh.castShadow = value.castShadow !== false;
  mesh.receiveShadow = value.receiveShadow !== false;
}

/**
 * Use the material asset of the value: the shape keeps its own material until the asset has loaded. A new reference
 * acquires the new asset before it releases the previous one.
 */
function useMaterialAsset(mesh: ShapeMesh, state: ShapeState, value: ShapeValue, ctx: PresenterContext): void {
  if (value.material === state.ref) return;
  const cache = materialCache(ctx.assets);
  const ref = value.material;
  const old = state.ref;
  state.ref = ref;
  mesh.material = state.own;
  state.unwatch();
  state.unwatch = () => undefined;
  if (ref !== undefined) {
    state.unwatch = cache.watch(ref, (material) => {
      if (state.ref === ref && mesh.material !== state.own) mesh.material = material;
    });
    const load = cache.acquire(ref).then(
      (material) => {
        if (state.ref === ref && states.get(mesh) === state) mesh.material = material;
      },
      (error: unknown) => {
        if (state.ref !== ref || states.get(mesh) !== state) return;
        ctx.warn(
          `${ctx.id}: the material "${ref}" did not load: ${error instanceof Error ? error.message : String(error)}`,
        );
      },
    );
    ctx.track(load);
  }
  if (old !== undefined) cache.release(old);
}

function sameSize(a: ShapeValue["size"], b: ShapeValue["size"]): boolean {
  return a?.[0] === b?.[0] && a?.[1] === b?.[1] && a?.[2] === b?.[2];
}

/** A shape with its own material from its colour, roughness and metalness, or with a material asset. */
export const shapePresenter: Presenter<ShapeValue, ShapeMesh> = {
  id: "shape",
  create(value, ctx) {
    const own = new MeshStandardMaterial();
    const mesh: ShapeMesh = new Mesh(shapeGeometry(value.kind, value.size ?? [1, 1, 1]), own);
    mesh.name = "shape";
    const state: ShapeState = { own, ref: undefined, unwatch: () => undefined };
    states.set(mesh, state);
    applyMaterial(mesh, state, value);
    useMaterialAsset(mesh, state, value, ctx);
    return mesh;
  },
  update(mesh, value, previous, ctx) {
    const state = states.get(mesh);
    if (state === undefined) return false;
    if (value.kind !== previous.kind || !sameSize(value.size, previous.size)) {
      mesh.geometry.dispose();
      mesh.geometry = shapeGeometry(value.kind, value.size ?? [1, 1, 1]);
    }
    applyMaterial(mesh, state, value);
    useMaterialAsset(mesh, state, value, ctx);
    return true;
  },
  dispose(mesh, ctx) {
    const state = states.get(mesh);
    mesh.geometry.dispose();
    if (state === undefined) return;
    states.delete(mesh);
    state.unwatch();
    state.own.dispose();
    if (state.ref !== undefined) materialCache(ctx.assets).release(state.ref);
  },
};
