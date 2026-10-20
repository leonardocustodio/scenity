// SPDX-License-Identifier: Apache-2.0
/**
 * The entity graph of the scene builder: one `Group` for each entity, and the objects of the presenters of
 * its components under it. `sync` changes the graph from one entity map to the next. `applyOps` of `@scenity/scene`
 * shares each branch that does not change, so a reference compare finds the entities and the components that an op
 * touched. An entity that did not change keeps its objects.
 */
import { Group, PerspectiveCamera, type Object3D } from "three";
import type { ComponentRegistry } from "@scenity/scene/components";
import { childrenMap } from "@scenity/scene/hierarchy";
import type { Entity } from "@scenity/scene/schema/entity";
import type { PresenterRegistry } from "./registry";
import type { AssetHandle, Presenter, PresenterContext } from "./types";

export type EntityMap = Readonly<Record<string, Entity>>;

/** One component of an entity: its stored value, the value with the defaults, and the object of its presenter. */
export interface Part {
  raw: unknown;
  value: unknown;
  object: Object3D | null;
  readonly presenter: Presenter | undefined;
}

export interface EntityNode {
  readonly id: string;
  readonly group: Group;
  readonly ctx: PresenterContext;
  readonly parts: Map<string, Part>;
}

export interface GraphDeps {
  readonly registry: ComponentRegistry;
  readonly presenters: PresenterRegistry;
  readonly assets: AssetHandle;
  track(work: Promise<unknown>): void;
  warn(message: string): void;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function componentOf(object: Object3D): string {
  const component: unknown = object.userData.component;
  return typeof component === "string" ? component : "";
}

/** True when a stored component value holds one of the asset references at any depth. */
export function refersTo(value: unknown, refs: ReadonlySet<string>): boolean {
  if (typeof value === "string") return refs.has(value);
  if (typeof value !== "object" || value === null) return false;
  return Object.values(value).some((item) => refersTo(item, refs));
}

function isEntityObject(object: Object3D): boolean {
  return typeof object.userData.entity === "string";
}

export class EntityGraph {
  readonly root = new Group();
  readonly nodes = new Map<string, EntityNode>();
  /** The document cameras by entity ID. */
  readonly cameras = new Map<string, PerspectiveCamera>();
  readonly #deps: GraphDeps;

  constructor(deps: GraphDeps) {
    this.#deps = deps;
    this.root.name = "scene";
  }

  /** Change the graph from the entity map `prev` to the entity map `next`. */
  sync(prev: EntityMap, next: EntityMap): void {
    const dirty = new Set<string | null>();
    for (const [id, before] of Object.entries(prev)) {
      if (Object.hasOwn(next, id)) continue;
      this.#removeNode(id);
      dirty.add(before.parent);
    }
    for (const [id, entity] of Object.entries(next)) {
      const before = Object.hasOwn(prev, id) ? prev[id] : undefined;
      if (before === entity) continue;
      const node = this.nodes.get(id) ?? this.#addNode(id);
      if (this.#syncParts(node, before?.components ?? {}, entity.components)) dirty.add(id);
      if (before?.parent === entity.parent && before.index === entity.index) continue;
      if (before !== undefined) dirty.add(before.parent);
      dirty.add(entity.parent);
    }
    const children = childrenMap(next);
    const order = (parent: string | null) => children.get(parent ?? "") ?? [];
    for (const parent of dirty) this.#attach(parent, order(parent));
    for (const parent of dirty) this.#arrange(parent, order(parent));
  }

  /**
   * Make each part whose stored value refers to an asset of `refs` again. The new part comes first, so the asset keeps
   * a user and its new value stays in the cache. Then the builder removes the previous part. The result is the touched
   * IDs.
   */
  reload(refs: ReadonlySet<string>, next: EntityMap): string[] {
    const touched: string[] = [];
    for (const node of this.nodes.values()) {
      for (const [component, part] of [...node.parts]) {
        if (!refersTo(part.raw, refs)) continue;
        node.parts.delete(component);
        this.#createPart(node, component, part.raw);
        this.#dropPart(node, component, part);
        if (!touched.includes(node.id)) touched.push(node.id);
      }
    }
    const children = childrenMap(next);
    for (const id of touched) this.#arrange(id, children.get(id) ?? []);
    return touched;
  }

  /** Run the `layout` step of each presenter that has one, after an update of the world matrices. */
  layout(): void {
    this.root.updateMatrixWorld(true);
    for (const node of this.nodes.values()) {
      for (const part of node.parts.values()) {
        if (part.presenter?.layout === undefined) continue;
        try {
          part.presenter.layout(part.object, part.value, node.ctx);
        } catch (error) {
          this.#deps.warn(`${node.id}: the layout of "${part.presenter.id}" failed: ${errorText(error)}`);
        }
      }
    }
  }

  #addNode(id: string): EntityNode {
    const group = new Group();
    group.name = id;
    group.userData.entity = id;
    const deps = this.#deps;
    const ctx: PresenterContext = {
      id,
      entity: group,
      assets: deps.assets,
      track: (work) => deps.track(work),
      entityObject: (other) => this.nodes.get(other)?.group,
      warn: (message) => deps.warn(message),
    };
    const node: EntityNode = { id, group, ctx, parts: new Map() };
    this.nodes.set(id, node);
    return node;
  }

  #removeNode(id: string): void {
    const node = this.nodes.get(id);
    if (node === undefined) return;
    for (const component of [...node.parts.keys()]) this.#disposePart(node, component);
    node.group.removeFromParent();
    this.nodes.delete(id);
  }

  /** Create, update and dispose the parts of a node. The result is true when a part object was added or removed. */
  #syncParts(node: EntityNode, before: Readonly<Record<string, unknown>>, after: Readonly<Record<string, unknown>>) {
    let changed = false;
    for (const component of Object.keys(before)) {
      if (Object.hasOwn(after, component)) continue;
      changed = this.#disposePart(node, component) || changed;
    }
    for (const [component, raw] of Object.entries(after)) {
      const part = node.parts.get(component);
      if (part === undefined) changed = this.#createPart(node, component, raw) || changed;
      else if (part.raw !== raw) changed = this.#updatePart(node, component, part, raw) || changed;
    }
    return changed;
  }

  /** Create a part. The result is true when the presenter made an object. */
  #createPart(node: EntityNode, component: string, raw: unknown): boolean {
    const presenter = this.#deps.presenters.get(component);
    const value = this.#deps.registry.fill(component, raw);
    let object: Object3D | null = null;
    try {
      object = presenter?.create(value, node.ctx) ?? null;
    } catch (error) {
      this.#deps.warn(`${node.id}: the presenter "${component}" failed: ${errorText(error)}`);
    }
    node.parts.set(component, { raw, value, object, presenter });
    if (object === null) return false;
    object.userData.component = component;
    node.group.add(object);
    if (object instanceof PerspectiveCamera) this.cameras.set(node.id, object);
    return true;
  }

  /** Update a part. The result is true when the presenter made a new object. */
  #updatePart(node: EntityNode, component: string, part: Part, raw: unknown): boolean {
    const value = this.#deps.registry.fill(component, raw);
    let kept: boolean;
    try {
      kept = part.presenter?.update(part.object, value, part.value, node.ctx) ?? true;
    } catch (error) {
      this.#deps.warn(`${node.id}: the update of "${component}" failed: ${errorText(error)}`);
      kept = false;
    }
    if (kept) {
      part.raw = raw;
      part.value = value;
      return false;
    }
    this.#disposePart(node, component);
    this.#createPart(node, component, raw);
    return true;
  }

  /** Dispose a part. The result is true when the part had an object. */
  #disposePart(node: EntityNode, component: string): boolean {
    const part = node.parts.get(component);
    if (part === undefined) return false;
    node.parts.delete(component);
    return this.#dropPart(node, component, part);
  }

  /** Dispose a part that the node no longer holds. The result is true when the part had an object. */
  #dropPart(node: EntityNode, component: string, part: Part): boolean {
    try {
      part.presenter?.dispose(part.object, node.ctx);
    } catch (error) {
      this.#deps.warn(`${node.id}: the dispose of "${component}" failed: ${errorText(error)}`);
    }
    if (part.object === null) return false;
    part.object.removeFromParent();
    if (this.cameras.get(node.id) === part.object) this.cameras.delete(node.id);
    return true;
  }

  #groupOf(parent: string | null): Group | undefined {
    return parent === null ? this.root : this.nodes.get(parent)?.group;
  }

  /** Put the entity objects of the children of `parent` under the object of `parent`. */
  #attach(parent: string | null, order: readonly string[]): void {
    const group = this.#groupOf(parent);
    if (group === undefined) return;
    for (const id of order) {
      const child = this.nodes.get(id)?.group;
      if (child !== undefined && child.parent !== group) group.add(child);
    }
  }

  /**
   * Sort the children of an object: first the part objects in component ID order, then the entity objects in index
   * order. The parent links do not change.
   */
  #arrange(parent: string | null, order: readonly string[]): void {
    const group = this.#groupOf(parent);
    if (group === undefined) return;
    const kids = order
      .map((id) => this.nodes.get(id)?.group)
      .filter((child): child is Group => child?.parent === group);
    const parts = group.children.filter((child) => !isEntityObject(child));
    parts.sort((a, b) => (componentOf(a) < componentOf(b) ? -1 : componentOf(a) > componentOf(b) ? 1 : 0));
    const rest = group.children.filter((child) => isEntityObject(child) && !kids.includes(child as Group));
    group.children.splice(0, group.children.length, ...parts, ...kids, ...rest);
  }
}
