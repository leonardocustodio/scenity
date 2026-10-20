// SPDX-License-Identifier: Apache-2.0
/**
 * The pick of the scene builder graph: a ray from a camera through a point of the canvas gives the
 * shown pickable entity under the point, the component whose presenter made the hit object and the sub-target.
 *
 * - The `pickable` component of an entity gives the hit test: "mesh" (the triangles of the entity objects) or
 *   "bounds" (the world box of the entity objects, with no child entity). An entity with no `pickable` component
 *   uses "mesh" on the layer "default". `enabled: false` lets the ray go through the entity.
 * - A pick with a layer list hits only the entities with one of those layers.
 * - The hit with the highest `priority` wins, then the nearest hit.
 * - A mesh hit names the glTF node of a model as its target. When the caller asks for it, the target is the nearest
 *   socket, bone or path point of the hit entity, and `sub` is its name in `entity:<id>#<sub>` (scene/subTargets.ts).
 * - A hit on an instance batch (scene/instancing.ts) maps its instance ID back to the entity of the instance.
 */
import { Box3, Raycaster, Vector2, Vector3, type Camera, type Object3D } from "three";
import { PICKABLE_DEFAULTS, type Pickable, type PickableValue } from "@scenity/scene/components";
import type { PickHit, PickOptions, PickTarget } from "../protocolScene";
import type { SceneBuilder } from "./builder";
import { instanceHit } from "./instancing";
import { nearestSub, shown, SUB_KINDS, type SubKind } from "./subTargets";

/** A hit before the choice of the best one. */
interface Candidate {
  readonly entity: string;
  readonly component: string | null;
  readonly target: PickTarget | null;
  readonly point: Vector3;
  readonly distance: number;
  readonly priority: number;
}

/** The text of a `userData` field, or null. */
function dataText(object: Object3D, field: "entity" | "component"): string | null {
  const value: unknown = object.userData[field];
  return typeof value === "string" ? value : null;
}

/** The entity, the component and the sub-target of a hit object: the nearest parents with the marks of the graph. */
function partsOf(object: Object3D): Pick<PickHit, "entity" | "component" | "target"> | null {
  let component: string | null = null;
  let target: PickTarget | null = null;
  for (let node: Object3D | null = object; node !== null; node = node.parent) {
    const entity = dataText(node, "entity");
    if (entity !== null) return { entity, component, target };
    const mark = dataText(node, "component");
    if (component === null && mark !== null) {
      component = mark;
      // The hit object is a node of the model of the component when it is not the object of the presenter.
      if (object !== node && object.name !== "") target = { kind: "node", id: object.name };
    }
  }
  return null;
}

/** The pick values of an entity: the `pickable` component over the defaults. */
function pickableOf(builder: SceneBuilder, id: string): Pickable {
  const stored = (builder.document().entities[id]?.components.pickable ?? {}) as PickableValue;
  return {
    enabled: stored.enabled ?? PICKABLE_DEFAULTS.enabled,
    priority: stored.priority ?? PICKABLE_DEFAULTS.priority,
    mode: stored.mode ?? PICKABLE_DEFAULTS.mode,
    layers: stored.layers ?? PICKABLE_DEFAULTS.layers,
  };
}

/** True when the entity can take a hit of a pick with these options. */
function accepts(pickable: Pickable, layers: readonly string[] | undefined): boolean {
  if (!pickable.enabled) return false;
  return layers === undefined || pickable.layers.some((layer) => layers.includes(layer));
}

/** The kinds of sub-target that the options ask for (an empty set: none). */
function subKinds(options: PickOptions): ReadonlySet<SubKind> {
  if (options.sub === undefined || options.sub === false) return new Set();
  return new Set(options.sub === true ? SUB_KINDS : options.sub);
}

/** The world box of the shown part objects of an entity, with no child entity. */
function ownBox(builder: SceneBuilder, id: string): Box3 {
  const box = new Box3();
  for (const component of builder.componentIds(id)) {
    const object = builder.componentObject(id, component);
    if (object !== null && shown(object)) box.expandByObject(object);
  }
  return box;
}

/** True when `a` is a better hit than `b`: a higher priority, then a nearer hit. */
function better(a: Candidate, b: Candidate | null): boolean {
  if (b === null) return true;
  return a.priority !== b.priority ? a.priority > b.priority : a.distance < b.distance;
}

export class GraphPicker {
  readonly #raycaster = new Raycaster();
  readonly #point = new Vector2();

  /**
   * The best hit under the point (x, y) in CSS pixels of a canvas of `width` × `height`, or null. The builder must
   * hold a document.
   */
  pick(
    builder: SceneBuilder,
    camera: Camera,
    x: number,
    y: number,
    width: number,
    height: number,
    options: PickOptions = {},
  ): PickHit | null {
    if (width <= 0 || height <= 0) return null;
    this.#point.set((x / width) * 2 - 1, -(y / height) * 2 + 1);
    builder.root.updateMatrixWorld(true);
    this.#raycaster.setFromCamera(this.#point, camera);
    const pickables = new Map<string, Pickable>();
    for (const id of builder.entityIds()) {
      const pickable = pickableOf(builder, id);
      if (accepts(pickable, options.layers)) pickables.set(id, pickable);
    }
    let best: Candidate | null = null;
    for (const hit of [...this.#meshHits(builder, pickables), ...this.#boxHits(builder, pickables)]) {
      if (better(hit, best)) best = hit;
    }
    return best === null ? null : this.#result(builder, best, subKinds(options));
  }

  /** The nearest mesh hit of each entity with the hit test "mesh". */
  #meshHits(builder: SceneBuilder, pickables: ReadonlyMap<string, Pickable>): Candidate[] {
    const seen = new Set<string>();
    const out: Candidate[] = [];
    for (const hit of this.#raycaster.intersectObject(builder.root, true)) {
      if (!shown(hit.object)) continue;
      const parts = instanceHit(hit.object, hit.instanceId) ?? partsOf(hit.object);
      const pickable = parts === null ? undefined : pickables.get(parts.entity);
      if (parts === null || pickable?.mode !== "mesh" || seen.has(parts.entity)) continue;
      seen.add(parts.entity);
      out.push({ ...parts, point: hit.point.clone(), distance: hit.distance, priority: pickable.priority });
    }
    return out;
  }

  /** The box hit of each shown entity with the hit test "bounds". */
  #boxHits(builder: SceneBuilder, pickables: ReadonlyMap<string, Pickable>): Candidate[] {
    const out: Candidate[] = [];
    const ray = this.#raycaster.ray;
    for (const [entity, pickable] of pickables) {
      const group = builder.entityObject(entity);
      if (pickable.mode !== "bounds" || group === undefined || !shown(group)) continue;
      const box = ownBox(builder, entity);
      const point = box.isEmpty() ? null : ray.intersectBox(box, new Vector3());
      if (point === null) continue;
      const distance = ray.origin.distanceTo(point);
      if (distance < this.#raycaster.near || distance > this.#raycaster.far) continue;
      out.push({ entity, component: null, target: null, point, distance, priority: pickable.priority });
    }
    return out;
  }

  /** The hit of the protocol, with the nearest sub-target when the options ask for one. */
  #result(builder: SceneBuilder, hit: Candidate, kinds: ReadonlySet<SubKind>): PickHit {
    const sub = kinds.size === 0 ? null : nearestSub(builder, hit.entity, kinds, hit.point);
    return {
      entity: hit.entity,
      component: hit.component,
      target: sub === null ? hit.target : { kind: sub.kind, id: sub.id },
      ...(sub === null ? {} : { sub: sub.id }),
      point: [hit.point.x, hit.point.y, hit.point.z],
      distance: hit.distance,
    };
  }
}
