// SPDX-License-Identifier: Apache-2.0
/**
 * The system `demo.spin`: it turns each entity with a `demo.spin` component about its up axis. The
 * memory keeps the angle of each entity, so the system has save and restore: a seek gives the frame of a play. The
 * document core runs the system in fixed steps. The output rotation is the document rotation, then the turn.
 *
 * The input of the play mode comes from input.ts. A press of `demo.toggle` on an entity stops its turn or starts it
 * again. A press of `demo.faster` doubles the speed of all the entities, and `demo.slower` halves it (from 1/8 to 8
 * times). The memory keeps the stopped entities and the speed factor too.
 */
import type { Quat } from "@scenity/scene/math";
import type { StepInputs } from "@scenity/scene/input";
import { defineSystem, type SystemDefinition } from "@scenity/runtime/systems";
import { DEFAULT_SPEED, type SpinValue } from "../component";

/** The memory: the angle of each entity in degrees in [0, 360), the stopped entities and the speed factor. */
interface SpinMemory {
  readonly angles: Readonly<Record<string, number>>;
  readonly stopped: readonly string[];
  readonly factor: number;
}

/** The lowest and the highest speed factor of the keys. */
const FACTOR_LIMIT = 8;

/** The memory after the input events of one step. */
function withInputs(memory: SpinMemory, inputs: StepInputs | undefined): SpinMemory {
  if (inputs === undefined || inputs.events.length === 0) return memory;
  let stopped = memory.stopped;
  for (const press of inputs.pressed("demo.toggle")) {
    const id = press.entity;
    if (id === undefined) continue;
    stopped = stopped.includes(id) ? stopped.filter((item) => item !== id) : [...stopped, id].sort();
  }
  let factor = memory.factor;
  factor *= 2 ** (inputs.pressed("demo.faster").length - inputs.pressed("demo.slower").length);
  factor = Math.min(FACTOR_LIMIT, Math.max(1 / FACTOR_LIMIT, factor));
  return { ...memory, stopped, factor };
}

/** The rotation of `angle` degrees about the up axis (Y). */
function turn(angle: number): Quat {
  const half = (angle * Math.PI) / 360;
  return [0, Math.sin(half), 0, Math.cos(half)];
}

/** The product `a * b` of two quaternions [x, y, z, w]: first `b`, then `a`. */
function multiply(a: Quat, b: Quat): Quat {
  const [ax, ay, az, aw] = a;
  const [bx, by, bz, bw] = b;
  return [
    aw * bx + ax * bw + ay * bz - az * by,
    aw * by - ax * bz + ay * bw + az * bx,
    aw * bz + ax * by - ay * bx + az * bw,
    aw * bw - ax * bx - ay * by - az * bz,
  ];
}

/** A new system with its own memory: each runner of a core gets one. */
export function spinSystem(): SystemDefinition {
  let memory: SpinMemory = { angles: {}, stopped: [], factor: 1 };
  return defineSystem<unknown, SpinMemory>({
    id: "demo.spin",
    order: 0,
    reads: ["demo.spin", "transform"],
    update(ctx) {
      memory = withInputs(memory, ctx.inputs);
      const { angles, stopped, factor } = memory;
      const next: Record<string, number> = {};
      const entities = ctx.frame.scene.entities;
      for (const id of Object.keys(entities).sort()) {
        const components = entities[id]?.components ?? {};
        const value = components["demo.spin"] as SpinValue | undefined;
        if (value === undefined) continue;
        const speed = stopped.includes(id) ? 0 : (value.speed ?? DEFAULT_SPEED) * factor;
        const angle = ((((angles[id] ?? 0) + (speed * ctx.dt) / 1000) % 360) + 360) % 360;
        next[id] = angle;
        const base = (components.transform as { rotation?: Quat } | undefined)?.rotation ?? [0, 0, 0, 1];
        ctx.out.setTransform(id, { rotation: multiply(base, turn(angle)) });
      }
      memory = { ...memory, angles: next };
    },
    save: () => ({ angles: { ...memory.angles }, stopped: [...memory.stopped], factor: memory.factor }),
    restore: (saved) => {
      memory = { angles: { ...saved.angles }, stopped: [...saved.stopped], factor: saved.factor };
    },
  });
}
