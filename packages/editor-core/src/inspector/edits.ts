// SPDX-License-Identifier: Apache-2.0
/**
 * The edits of the inspector as scene ops. The editor applies the ops of one edit as one step of the history (the scene
 * channel). A live drag of a number applies its ops with `move` and ends as one step. An edit of a document entity is a
 * `set` op on the entity. An edit of a prefab entity changes the list of overrides of its instance: one `set` op of
 * `/entities/<instance>/components/prefab/overrides`. No Vue import.
 */
import { formatPointer, getAt, isObject, jsonEqual, mergeDefaults, omitKeys } from "@scenity/scene";
import type { ComponentDefinition } from "@scenity/scene/components";
import type { AddComponentOp, SceneOp, SetOp } from "@scenity/scene/schema/entity";
import {
  hasComponent,
  siteTokens,
  storedValue,
  type InspectorSource,
  type PrefabSubject,
  type Subject,
} from "./subjects";
import { overrideTouches, pathTokens, prefabPointer } from "./values";

type JsonValue = SetOp["value"];

function isContainer(value: unknown): boolean {
  return Array.isArray(value) || isObject(value);
}

/** A copy of a container with the value at the tokens. The copy adds each object that is not there. */
function buildAt(container: unknown, tokens: readonly string[], value: unknown): unknown {
  const [head, ...rest] = tokens;
  if (head === undefined) return value;
  if (Array.isArray(container)) {
    const copy: unknown[] = [...(container as unknown[])];
    copy[Number(head)] = buildAt(copy[Number(head)], rest, value);
    return copy;
  }
  const base = isObject(container) ? container : {};
  const child = buildAt(base[head], rest, value);
  return child === undefined ? omitKeys(base, [head]) : { ...base, [head]: child };
}

/**
 * The `set` op that writes `value` at `path` of a stored value at `base`, or null when nothing changes. The op names
 * the deepest container that exists. A container that is not there starts from the value with the defaults
 * (`filled`). Thus a change of one part of a vector keeps the other parts. `value` undefined removes the key (the
 * default applies).
 */
export function writeOp(
  stored: unknown,
  filled: unknown,
  base: readonly string[],
  path: readonly string[],
  value: unknown,
): SetOp | null {
  const now = getAt(stored, path);
  if (value === undefined ? now === undefined : jsonEqual(now, value)) return null;
  if (path.length === 0 || stored === undefined) {
    const whole = path.length === 0 ? value : buildAt(undefined, path, value);
    return setOp([...base], whole);
  }
  let depth = 0;
  while (depth < path.length - 1 && isContainer(getAt(stored, path.slice(0, depth + 1)))) depth += 1;
  if (depth === path.length - 1) return setOp([...base, ...path], value);
  const missing = path.slice(0, depth + 1);
  const start = getAt(filled, missing);
  return setOp([...base, ...missing], buildAt(isContainer(start) ? start : undefined, path.slice(depth + 1), value));
}

function setOp(tokens: readonly string[], value: unknown): SetOp {
  const path = formatPointer(tokens);
  return value === undefined ? { op: "set", path } : { op: "set", path, value: value as JsonValue };
}

/** The new override lists of the instances of an edit. `ops` gives one `set` op for each changed instance. */
class OverrideEdits {
  readonly #lists = new Map<string, SceneOp[]>();

  #list(subject: PrefabSubject): SceneOp[] {
    const known = this.#lists.get(subject.instance);
    if (known !== undefined) return known;
    const list = [...subject.overrides];
    this.#lists.set(subject.instance, list);
    return list;
  }

  /** Keep only the ops for which `keep` is true. */
  filter(subject: PrefabSubject, keep: (op: SceneOp) => boolean): void {
    this.#lists.set(subject.instance, this.#list(subject).filter(keep));
  }

  /** Add an op at the end. A `set` op first removes the `set` ops at its path or under it. */
  put(subject: PrefabSubject, op: SceneOp): void {
    if (op.op === "set") {
      const at = op.path;
      this.filter(subject, (old) => !(old.op === "set" && (old.path === at || old.path.startsWith(`${at}/`))));
    }
    this.#list(subject).push(op);
  }

  ops(): SceneOp[] {
    return [...this.#lists].map(([instance, list]) => {
      const tokens = ["entities", instance, "components", "prefab", "overrides"];
      return setOp(tokens, list.length === 0 ? undefined : list);
    });
  }
}

/** The ops that write `value` at the field `path` of a component of each subject (undefined: the default). */
export function fieldOps(
  source: InspectorSource,
  subjects: readonly Subject[],
  definition: ComponentDefinition,
  path: string | readonly string[],
  value: unknown,
): SceneOp[] {
  const tokens = pathTokens(path);
  const ops: SceneOp[] = [];
  const overrides = new OverrideEdits();
  for (const subject of subjects) {
    if (!hasComponent(subject, definition)) continue;
    const stored = storedValue(source, subject, definition);
    const filled = mergeDefaults(definition.defaults, stored);
    if (value === undefined && tokens.length === 0 && definition.site === "component") continue;
    const op = writeOp(stored, filled, siteTokens(subject, definition), tokens, value);
    if (op === null) continue;
    if (subject.kind === "prefab") overrides.put(subject, op);
    else ops.push(op);
  }
  return [...ops, ...overrides.ops()];
}

/** The ops that reset a field to its default: the key goes from the stored value. */
export function resetToDefaultOps(
  source: InspectorSource,
  subjects: readonly Subject[],
  definition: ComponentDefinition,
  path: string | readonly string[],
): SceneOp[] {
  return fieldOps(source, subjects, definition, path, undefined);
}

/** The ops that reset a field of each prefab subject to the prefab value: its overrides go. */
export function resetToPrefabOps(
  subjects: readonly Subject[],
  definition: ComponentDefinition,
  path: string | readonly string[],
): SceneOp[] {
  const tokens = pathTokens(path);
  const overrides = new OverrideEdits();
  for (const subject of subjects) {
    if (subject.kind !== "prefab") continue;
    const at = prefabPointer(subject, definition, tokens);
    if (subject.overrides.some((op) => overrideTouches(op, at))) {
      overrides.filter(subject, (op) => !overrideTouches(op, at));
    }
  }
  return overrides.ops();
}

/** The ops that set the name of each entity subject (an empty name removes it). */
export function nameOps(subjects: readonly Subject[], name: string): SceneOp[] {
  const value = name.trim() === "" ? undefined : name.trim();
  const ops: SceneOp[] = [];
  const overrides = new OverrideEdits();
  for (const subject of subjects) {
    if (subject.kind === "scene") continue;
    const id = subject.kind === "prefab" ? subject.entityId : subject.id;
    const op = writeOp(subject.entity, subject.entity, ["entities", id], ["name"], value);
    if (op === null) continue;
    if (subject.kind === "prefab") overrides.put(subject, op);
    else ops.push(op);
  }
  return [...ops, ...overrides.ops()];
}

/** The ops that add a component with a value to each subject that does not have it. */
export function addComponentOps(
  subjects: readonly Subject[],
  definition: ComponentDefinition,
  value: unknown,
): SceneOp[] {
  const ops: SceneOp[] = [];
  const overrides = new OverrideEdits();
  for (const subject of subjects) {
    if (subject.kind === "scene" || hasComponent(subject, definition)) continue;
    const id = subject.kind === "prefab" ? subject.entityId : subject.id;
    const op: SceneOp = {
      op: "addComponent",
      id,
      component: definition.id,
      value: (value ?? {}) as AddComponentOp["value"],
    };
    if (subject.kind === "prefab") overrides.put(subject, op);
    else ops.push(op);
  }
  return [...ops, ...overrides.ops()];
}

/**
 * The ops that remove a component from each subject. A prefab entity loses the overrides of the component. When the
 * prefab itself has the component, the overrides get a `removeComponent` op.
 */
export function removeComponentOps(subjects: readonly Subject[], definition: ComponentDefinition): SceneOp[] {
  const ops: SceneOp[] = [];
  const overrides = new OverrideEdits();
  for (const subject of subjects) {
    if (subject.kind === "scene" || !hasComponent(subject, definition)) continue;
    if (subject.kind === "entity") {
      ops.push({ op: "removeComponent", id: subject.id, component: definition.id });
      continue;
    }
    const at = formatPointer(siteTokens(subject, definition));
    const mine = (op: SceneOp) =>
      overrideTouches(op, at) ||
      (op.op === "addComponent" && op.id === subject.entityId && op.component === definition.id);
    overrides.filter(subject, (op) => !mine(op));
    if (Object.hasOwn(subject.original.components, definition.id)) {
      overrides.put(subject, { op: "removeComponent", id: subject.entityId, component: definition.id });
    }
  }
  return [...ops, ...overrides.ops()];
}

/** The value of a component of a subject with the defaults, for a widget that edits the whole value. */
export function filledValue(source: InspectorSource, subject: Subject, definition: ComponentDefinition): unknown {
  return mergeDefaults(definition.defaults, storedValue(source, subject, definition));
}
