// SPDX-License-Identifier: Apache-2.0
/** A generator of random valid ops for the property tests. It uses a seeded generator, not Math.random. */
import { childCount, isInSubtree, type EntityDocument, type SceneOp } from "../src/index";

export type Random = () => number;

function pick<T>(random: Random, items: readonly T[]): T | undefined {
  return items[Math.floor(random() * items.length)];
}

function int(random: Random, max: number): number {
  return Math.floor(random() * (max + 1));
}

const num = (random: Random) => Math.round((random() * 20 - 10) * 1000) / 1000;

/** One random op that is valid for the document, or undefined when the chosen kind has no target. */
export function randomOp(doc: EntityDocument, random: Random, counter: { next: number }): SceneOp | undefined {
  const ids = Object.keys(doc.entities).sort();
  const id = pick(random, ids);
  const kind = int(random, 9);
  if (kind === 0 || id === undefined) {
    const parent = random() < 0.4 || id === undefined ? null : id;
    const newId = `n${String((counter.next += 1))}`;
    const components = random() < 0.5 ? { transform: { position: [num(random), 0, num(random)] } } : {};
    return {
      op: "add",
      id: newId,
      entity: { parent, index: int(random, childCount(doc.entities, parent)), components },
    };
  }
  const entity = doc.entities[id]!;
  switch (kind) {
    case 1:
      return { op: "remove", id };
    case 2: {
      const parents = [null, ...ids.filter((other) => !isInSubtree(doc.entities, other, id))];
      const parent = pick(random, parents) ?? null;
      return { op: "move", id, parent, index: int(random, childCount(doc.entities, parent, id)) };
    }
    case 3:
      if (!("transform" in entity.components)) return { op: "addComponent", id, component: "transform", value: {} };
      return {
        op: "set",
        path: `/entities/${id}/components/transform/position`,
        value: [num(random), num(random), num(random)],
      };
    case 4: {
      const transform = entity.components.transform as { position?: number[] } | undefined;
      if (transform?.position === undefined) return undefined;
      return {
        op: "set",
        path: `/entities/${id}/components/transform/position/${String(int(random, 2))}`,
        value: num(random),
      };
    }
    case 5:
      return random() < 0.3
        ? { op: "set", path: `/entities/${id}/name` }
        : { op: "set", path: `/entities/${id}/name`, value: `E ${String(int(random, 99))}` };
    case 6:
      return random() < 0.3
        ? { op: "set", path: `/entities/${id}/tags` }
        : { op: "set", path: `/entities/${id}/tags`, value: ["t", `t${String(int(random, 9))}`] };
    case 7:
      if ("visibility" in entity.components) return { op: "removeComponent", id, component: "visibility" };
      return { op: "addComponent", id, component: "visibility", value: { visible: random() < 0.5 } };
    case 8: {
      const component = pick(random, Object.keys(entity.components).sort());
      return component === undefined ? undefined : { op: "removeComponent", id, component };
    }
    default:
      return "environment" in doc
        ? { op: "set", path: "/environment/exposure", value: Math.round(random() * 1000) / 100 + 0.1 }
        : undefined;
  }
}
