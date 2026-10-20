// SPDX-License-Identifier: Apache-2.0
/**
 * The metric context: the scene at one time, as the metrics read it. The context comes from plain data, so the same
 * metrics run in a Bun test, in the CLI, in the host of Claude and in the editor page:
 *
 * - `facts`: the entities with their world transforms, bounds, sockets, joints and stats. The inspect report of the dev
 *   tools (`@scenity/runtime-dev` `inspectScene`) has this shape.
 * - `scene`: the scene document at the time (the components: IK goals, obstacles, paths). `base`: the document before
 *   the sequence, for the walk plans (a walk starts from the base place, as in the time line of the runtime).
 * - `project`, `assets`: the budgets of the project and the release state of each asset.
 * - Hooks of the host: `point` (a reference to a world point before the facts), `meshBoxes` (the boxes of the mesh
 *   parts of an entity), `raycast` (the entities whose meshes a segment hits, in order), `goals` (IK goals in place of
 *   the `character` components) and `data` (the data of a plugin, by key).
 */
import { floorObstacleList, type FloorObstacle } from "@scenity/character/navigation";
import { planPath, type FloorPoint } from "@scenity/character/path";
import type { FloorRect } from "@scenity/character/place";
import { sceneWalkers } from "@scenity/character/sceneWalks";
import type { CharacterValue, PathValue } from "@scenity/scene/components";
import { findReferences } from "@scenity/scene/refs";
import type { ProjectDocument } from "@scenity/scene";
import type { HasEntities } from "@scenity/scene/world";
import { floorRectOf, pointToBox, rotate, segmentHitsBox, shrinkBox } from "./geometry";
import type { Box, Quat, Vec3 } from "./types";

/** One entity of the facts. The numbers are in metres, in the world frame. */
export interface EntityFacts {
  readonly id: string;
  readonly parent: string | null;
  readonly tags: readonly string[];
  /** The component IDs of the entity. */
  readonly components: readonly string[];
  readonly visible: boolean;
  readonly transform: { readonly position: Vec3; readonly rotation: Quat; readonly scale: Vec3 };
  /** The world box of the entity and its subtree, or null with no geometry. */
  readonly bounds: Box | null;
  readonly sockets: Readonly<Record<string, Vec3>>;
  /** The world point of each bone by its canonical or node name; null with no bones. */
  readonly joints: Readonly<Record<string, Vec3>> | null;
  readonly stats: { readonly triangles: number; readonly drawCalls: number };
}

/** The facts of a scene at a time. */
export interface SceneFacts {
  readonly simMs: number | null;
  readonly entities: readonly EntityFacts[];
  readonly totals: { readonly entities: number; readonly triangles: number; readonly drawCalls: number };
}

/** The release state of one asset (the release gate gives it). */
export interface AssetStatus {
  readonly id: string;
  /** True when the asset has a rights record that allows the release. */
  readonly allowed: boolean;
  readonly problems: readonly string[];
}

/** An IK goal of an entity at the time: the target point, the point of the end bone and the weight. */
export interface IkGoalFacts {
  /** The goal name (`leftHand`, `rightHand`). */
  readonly goal: string;
  readonly target: Vec3 | null;
  readonly end: Vec3 | null;
  readonly weight: number;
}

/** A point argument: a reference (`entity:<id>`, `entity:<id>#<sub>`) or a world point. */
export type PointArg = string | Vec3;

/** The input of a metric context. Only `facts` is necessary. */
export interface MetricContextInput {
  readonly facts: SceneFacts;
  readonly scene?: HasEntities;
  readonly base?: HasEntities;
  readonly project?: ProjectDocument;
  readonly assets?: readonly AssetStatus[];
  point?(ref: string): Vec3 | null;
  meshBoxes?(entity: string): readonly Box[];
  raycast?(from: Vec3, to: Vec3): readonly string[];
  readonly goals?: Readonly<Record<string, readonly IkGoalFacts[]>>;
  readonly data?: Readonly<Record<string, unknown>>;
}

/** The hand goals of the `character` component and the bone at the end of each. */
const HAND_GOALS = ["leftHand", "rightHand"] as const;

/** A point of the frame of an entity in the world frame, from its world transform. */
export function toWorld(entity: EntityFacts, local: Vec3): Vec3 {
  const { position, rotation, scale } = entity.transform;
  const turned = rotate(rotation, [local[0] * scale[0], local[1] * scale[1], local[2] * scale[2]]);
  return [position[0] + turned[0], position[1] + turned[1], position[2] + turned[2]];
}

export class MetricContext {
  readonly time: number | null;
  readonly #input: MetricContextInput;
  readonly #byId: ReadonlyMap<string, EntityFacts>;
  #obstacles: readonly FloorObstacle[] | null = null;

  constructor(input: MetricContextInput) {
    this.#input = input;
    this.time = input.facts.simMs;
    this.#byId = new Map(input.facts.entities.map((entity) => [entity.id, entity]));
  }

  /** The scene document at the time, or null. */
  get scene(): HasEntities | null {
    return this.#input.scene ?? null;
  }

  get project(): ProjectDocument | null {
    return this.#input.project ?? null;
  }

  entities(): readonly EntityFacts[] {
    return this.#input.facts.entities;
  }

  entity(id: string): EntityFacts | undefined {
    return this.#byId.get(id);
  }

  totals(): SceneFacts["totals"] {
    return this.#input.facts.totals;
  }

  /**
   * The entity IDs of a selector, in the order of the facts: an entity ID, `tag:<tag>`, `component:<id>`, `*` (each
   * entity), or a list of them. An ID that the facts do not have gives nothing.
   */
  select(selector: string | readonly string[]): string[] {
    const parts = typeof selector === "string" ? [selector] : selector;
    return this.entities()
      .filter((entity) => parts.some((part) => matches(entity, part)))
      .map((entity) => entity.id);
  }

  /** True when `id` is `other` or an ancestor of it. */
  holds(id: string, other: string): boolean {
    for (let next: string | null = other; next !== null; next = this.entity(next)?.parent ?? null) {
      if (next === id) return true;
    }
    return false;
  }

  /** The world point of a point argument, or null when the reference does not resolve. */
  point(at: PointArg): Vec3 | null {
    if (typeof at !== "string") return at;
    const hosted = this.#input.point?.(at);
    if (hosted !== undefined && hosted !== null) return hosted;
    if (!at.startsWith("entity:")) return null;
    const rest = at.slice("entity:".length);
    const hash = rest.indexOf("#");
    const entity = this.entity(hash < 0 ? rest : rest.slice(0, hash));
    if (entity === undefined) return null;
    if (hash < 0) return entity.transform.position;
    const sub = rest.slice(hash + 1);
    return entity.sockets[sub] ?? entity.joints?.[sub] ?? this.#pathPoint(entity, sub);
  }

  /** The world points of the `path` component of an entity, or null with no path. */
  pathPoints(id: string): Vec3[] | null {
    const entity = this.entity(id);
    const value = this.scene?.entities[id]?.components.path as PathValue | undefined;
    if (entity === undefined || value === undefined) return null;
    return value.points.map((point) => toWorld(entity, point));
  }

  /**
   * The world boxes of the mesh parts of an entity: the hook of the host (the own meshes, not the child entities), else
   * the box of the entity and its subtree.
   */
  meshBoxes(id: string): readonly Box[] {
    const hosted = this.#input.meshBoxes?.(id);
    if (hosted !== undefined) return hosted;
    const bounds = this.entity(id)?.bounds ?? null;
    return bounds === null ? [] : [bounds];
  }

  /** True when the host can hit the meshes of a segment (the `raycast` hook). */
  get raycasts(): boolean {
    return this.#input.raycast !== undefined;
  }

  /**
   * The first entity that blocks the segment `from` → `to`, or null. `meshes` asks the host to test the triangles (else
   * the boxes); a box is smaller by `margin` on each side. The entities of `skip` and their subtrees do not block.
   */
  blocker(from: Vec3, to: Vec3, skip: readonly string[], mode: "bounds" | "meshes", margin = 0): string | null {
    const skipped = (id: string) => skip.some((each) => this.holds(each, id));
    if (mode === "meshes" && this.#input.raycast !== undefined) {
      return this.#input.raycast(from, to).find((id) => !skipped(id)) ?? null;
    }
    for (const entity of this.entities()) {
      if (!entity.visible || skipped(entity.id)) continue;
      // The mesh boxes of the host hold only the own meshes; the box of the facts holds the subtree too.
      const boxes = this.meshBoxes(entity.id);
      if (boxes.some((box) => segmentHitsBox(from, to, shrinkBox(box, margin)))) return entity.id;
    }
    return null;
  }

  /** The IK goals of an entity at the time: the `goals` input, else the hand goals of its `character` component. */
  ikGoals(id: string): readonly IkGoalFacts[] {
    const given = this.#input.goals?.[id];
    if (given !== undefined) return given;
    const ik = (this.scene?.entities[id]?.components.character as CharacterValue | undefined)?.ik;
    const entity = this.entity(id);
    if (ik === undefined || entity === undefined) return [];
    return HAND_GOALS.flatMap((goal) => {
      const value = ik[goal];
      const target = value?.target ?? null;
      if (value === undefined || target === null) return [];
      return [{ goal, target: this.point(target), end: entity.joints?.[goal] ?? null, weight: value.weight ?? 1 }];
    });
  }

  /** The floor obstacles of the scene with their entities; a `bounds` footprint uses the box of the facts. */
  obstacles(): readonly FloorObstacle[] {
    this.#obstacles ??=
      this.scene === null ? [] : floorObstacleList(this.scene, { bounds: (id) => this.#floorRect(id) });
    return this.#obstacles;
  }

  /**
   * The paths of the walk legs of an entity with a `locomotion` component. The plan comes from the base document with
   * no model bounds, as in the time line of the runtime, so the legs are the walks that the scene plays.
   */
  walks(id: string): FloorPoint[][] {
    const base = this.#input.base ?? this.scene;
    if (base === null) return [];
    const walker = sceneWalkers(base).find((item) => item.entity === id);
    return walker === undefined ? [] : walker.plan.legs.map((leg) => [...leg.path]);
  }

  /** The shortest floor path between two points around the obstacles of the scene. */
  planPath(from: FloorPoint, to: FloorPoint): FloorPoint[] {
    return planPath(
      from,
      to,
      this.obstacles().map((obstacle) => obstacle.rect),
    );
  }

  /** The release state of the assets, or null when the context has no asset records. */
  assets(): readonly AssetStatus[] | null {
    return this.#input.assets ?? null;
  }

  /** The asset IDs that the scene document names (`asset:<id>`, the environment too), sorted, each one time. */
  usedAssets(): string[] {
    const refs = this.scene === null ? [] : findReferences(this.scene);
    return [...new Set(refs.flatMap(({ ref }) => (ref.kind === "asset" ? [ref.id] : [])))].sort();
  }

  /** The data of a plugin by key, or undefined. */
  data(key: string): unknown {
    return this.#input.data?.[key];
  }

  /** The distance from a point to the box of an entity, or null with no box. */
  distanceToBox(point: Vec3, id: string): number | null {
    const bounds = this.entity(id)?.bounds ?? null;
    return bounds === null ? null : pointToBox(point, bounds);
  }

  #floorRect(id: string): FloorRect | undefined {
    const bounds = this.entity(id)?.bounds ?? null;
    return bounds === null ? undefined : floorRectOf(bounds);
  }

  #pathPoint(entity: EntityFacts, sub: string): Vec3 | null {
    const match = /^path\.(\d+)$/.exec(sub);
    if (match === null) return null;
    return this.pathPoints(entity.id)?.[Number(match[1])] ?? null;
  }
}

function matches(entity: EntityFacts, part: string): boolean {
  if (part === "*") return true;
  if (part.startsWith("tag:")) return entity.tags.includes(part.slice(4));
  if (part.startsWith("component:")) return entity.components.includes(part.slice(10));
  return entity.id === part;
}

/** Make the metric context of a scene at a time. */
export function createMetricContext(input: MetricContextInput): MetricContext {
  return new MetricContext(input);
}
