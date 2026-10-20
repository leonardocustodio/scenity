// SPDX-License-Identifier: Apache-2.0
/**
 * The sequence values at a time as an override layer. The property, transform and visibility
 * samples become `set` ops, or an `addComponent` op when the entity does not have the component. The other tracks
 * (events, actions, animation clips, camera cuts and attach keys) give no op: the frame state holds them.
 */
import type { JsonValue } from "../json";
import { formatPointer, unescapeToken } from "../pointer";
import type { SceneDocument } from "../schema/documents";
import type { SceneOp } from "../schema/entity";
import type { TrackSample } from "./sample";

/** The scene, and the components that an earlier op of the same layer added. */
class OpBuilder {
  readonly ops: SceneOp[] = [];
  private readonly added = new Set<string>();

  constructor(private readonly scene: SceneDocument) {}

  /** An op that puts `value` at `tokens` (a component ID, then the field tokens) of the entity. */
  put(entity: string, tokens: readonly string[], value: JsonValue): void {
    const [component, ...rest] = tokens;
    if (component === undefined) return;
    const has = Object.hasOwn(this.scene.entities[entity]?.components ?? {}, component);
    const key = `${entity}\u0000${component}`;
    if (has || this.added.has(key)) {
      const path = formatPointer(["entities", entity, "components", ...tokens]);
      this.ops.push({ op: "set", path, value });
      return;
    }
    this.added.add(key);
    // An entity that does not exist gets the op too: the layer report then names the bad track.
    this.ops.push({ op: "addComponent", id: entity, component, value: nest(rest, value) });
  }
}

/** The value inside objects along the tokens: `nest(["a", "b"], 1)` is `{ a: { b: 1 } }`. */
function nest(tokens: readonly string[], value: JsonValue): JsonValue {
  return tokens.reduceRight<JsonValue>((inner, token) => ({ [token]: inner }), value);
}

/** The tokens of a property path (`camera/fov` gives `["camera", "fov"]`). */
export function propertyTokens(path: string): string[] {
  return path.split("/").map(unescapeToken);
}

/** The ops of the sequence layer from the track samples, in track order. */
export function sequenceOps(scene: SceneDocument, samples: readonly TrackSample[]): SceneOp[] {
  const builder = new OpBuilder(scene);
  for (const sample of samples) {
    if (sample.kind === "property" && sample.value !== undefined) {
      builder.put(sample.entity, propertyTokens(sample.path), sample.value);
    } else if (sample.kind === "transform") {
      if (sample.position !== undefined) builder.put(sample.entity, ["transform", "position"], sample.position);
      if (sample.rotation !== undefined) builder.put(sample.entity, ["transform", "rotation"], sample.rotation);
      if (sample.scale !== undefined) builder.put(sample.entity, ["transform", "scale"], sample.scale);
    } else if (sample.kind === "visibility" && sample.visible !== undefined) {
      builder.put(sample.entity, ["visibility", "visible"], sample.visible);
    }
  }
  return builder.ops;
}
