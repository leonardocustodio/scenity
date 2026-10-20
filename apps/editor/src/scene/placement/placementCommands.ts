// SPDX-License-Identifier: Apache-2.0
/**
 * The placement helpers of the editor window, each a command of the window for a person, a script and an agent (Entity
 * ▸ Place). They align and spread the selection on an axis, drop it to the floor, and put it on a target or against a
 * side of a target. They also put it near a target in a direction (and turn it to the target), turn it to face a
 * target, and find a free place on the floor. The helpers read the world boxes of the inspect report of the core
 * (placementMath.ts) and run `entity.move` (and the rotation of `component.set`) as one batch: one step of the history.
 */
import { qconjugate, qfromAxisAngle, qmul, type Quat } from "@scenity/scene/math";
import type { SceneInspectReport } from "@scenity/runtime-dev/document/report";
import { t } from "../../texts";
import type { BatchStep } from "../hierarchy/commandBatch";
import type { SceneCommands } from "../hierarchy/sceneCommands";
import type { PageKeyCommandSpec } from "../settings/pageKeys";
import {
  againstMove,
  alignMoves,
  centreOf,
  facingYaw,
  floorMove,
  freeMove,
  moved,
  nearMove,
  onMove,
  spreadMoves,
  type Axis,
  type Box,
  type Edge,
  type Placed,
  type Side,
  type Vec3,
} from "./placementMath";

/** What the helpers read of the page. */
export interface PlacementParts {
  readonly commands: Pick<SceneCommands, "batch">;
  inspect(): Promise<SceneInspectReport | null>;
  readonly selection: { readonly ids: readonly string[] };
}

type Args = Readonly<Record<string, unknown>>;

/** The world boxes of the report by entity ID (the entities with geometry). */
function boxesOf(report: SceneInspectReport): Map<string, Box> {
  return new Map(
    report.entities.flatMap((entity) => (entity.bounds === null ? [] : [[entity.id, entity.bounds] as [string, Box]])),
  );
}

/** The entities of a run: the `entities` argument (IDs with commas), else the `entity` argument, else the selection. */
function entitiesOf(parts: PlacementParts, args: Args): string[] {
  const given = typeof args.entities === "string" ? args.entities.split(",").map((id) => id.trim()) : [];
  const single = typeof args.entity === "string" && args.entity !== "" ? [args.entity] : [];
  const ids = given.filter((id) => id !== "");
  return ids.length > 0 ? ids : single.length > 0 ? single : [...parts.selection.ids];
}

/** The steps of the moves of a map of entity moves. */
function moveSteps(moves: ReadonlyMap<string, Vec3>): BatchStep[] {
  return [...moves].flatMap(([entity, [x, y, z]]) =>
    Math.abs(x) + Math.abs(y) + Math.abs(z) < 1e-6
      ? []
      : [{ command: "entity.move", args: { entity, x, y, z, relative: true } }],
  );
}

/** The step that turns an entity about the up axis to a yaw (degrees) in the world. */
function faceStep(report: SceneInspectReport, entity: string, yaw: number): BatchStep[] {
  const self = report.entities.find((item) => item.id === entity);
  const parent = report.entities.find((item) => item.id === self?.parent);
  const world = qfromAxisAngle([0, 1, 0], (yaw * Math.PI) / 180);
  // The current turn of the entity: no step when it faces the target already (q and -q are the same turn).
  const now = self?.transform.rotation;
  if (now !== undefined && Math.abs(world.reduce((sum, part, at) => sum + part * (now[at] ?? 0), 0)) > 0.99999)
    return [];
  const local: Quat = parent === undefined ? world : qmul(qconjugate([...parent.transform.rotation] as Quat), world);
  const value = JSON.stringify(local.map((part) => Math.round(part * 1e6) / 1e6));
  return [{ command: "component.set", args: { entity, component: "transform", field: "rotation", value } }];
}

/** The boxes of the run: the entity box, the target box and the other boxes; an error names a missing box. */
function boxes(report: SceneInspectReport, ids: readonly string[]): Placed[] {
  const all = boxesOf(report);
  return ids.map((id) => {
    const box = all.get(id);
    if (box === undefined) throw new Error(t("place-no-box", { entity: id }));
    return { id, box };
  });
}

const text = (args: Args, name: string): string => (typeof args[name] === "string" ? args[name] : "");
const number = (args: Args, name: string, fallback: number): number =>
  typeof args[name] === "number" && Number.isFinite(args[name]) ? args[name] : fallback;

/** The steps of each helper for the current report. */
const HELPERS: Readonly<Record<string, (report: SceneInspectReport, ids: string[], args: Args) => BatchStep[]>> = {
  align: (report, ids, args) => {
    const axis = (text(args, "axis") || "x") as Axis;
    return moveSteps(alignMoves(boxes(report, ids), axis, (text(args, "edge") || "min") as Edge));
  },
  spread: (report, ids, args) => moveSteps(spreadMoves(boxes(report, ids), (text(args, "axis") || "x") as Axis)),
  dropToFloor: (report, ids) => {
    const all = boxesOf(report);
    const chosen = new Set(ids);
    const others = [...all].filter(([id]) => !chosen.has(id)).map(([, box]) => box);
    return moveSteps(new Map(boxes(report, ids).map((item) => [item.id, floorMove(item.box, others)])));
  },
  on: (report, ids, args) => {
    const [target] = boxes(report, [text(args, "target")]);
    return moveSteps(new Map(boxes(report, ids).map((item) => [item.id, onMove(item.box, target?.box ?? item.box)])));
  },
  against: (report, ids, args) => {
    const [target] = boxes(report, [text(args, "target")]);
    const side = (text(args, "side") || "+x") as Side;
    return moveSteps(
      new Map(boxes(report, ids).map((item) => [item.id, againstMove(item.box, target?.box ?? item.box, side)])),
    );
  },
  near: (report, ids, args) => {
    const [target] = boxes(report, [text(args, "target")]);
    if (target === undefined) return [];
    const angle = number(args, "angle", 0);
    const gap = number(args, "gap", 0.3);
    const steps = moveSteps(
      new Map(boxes(report, ids).map((item) => [item.id, nearMove(item.box, target.box, angle, gap)])),
    );
    if (args.face !== true) return steps;
    // The entity looks back at the target: from the direction of the angle.
    return [...steps, ...ids.flatMap((id) => faceStep(report, id, angle))];
  },
  facing: (report, ids, args) => {
    const [target] = boxes(report, [text(args, "target")]);
    if (target === undefined) return [];
    return boxes(report, ids).flatMap((item) =>
      faceStep(report, item.id, facingYaw(centreOf(item.box), centreOf(target.box))),
    );
  },
  findSpace: (report, ids, args) => {
    const all = boxesOf(report);
    const chosen = new Set(ids);
    const others = [...all].filter(([id]) => !chosen.has(id)).map(([, box]) => box);
    const nearId = text(args, "near");
    const nearBox = nearId === "" ? undefined : all.get(nearId);
    const moves = new Map<string, Vec3>();
    // The entities that move to a free place are in the way of the next ones.
    const taken: Box[] = [];
    for (const item of boxes(report, ids)) {
      const near = nearBox === undefined ? centreOf(item.box) : centreOf(nearBox);
      const by = freeMove(item.box, [...others, ...taken], near);
      if (by === null) throw new Error(t("place-no-space", { entity: item.id }));
      moves.set(item.id, by);
      taken.push(moved(item.box, by));
    }
    return moveSteps(moves);
  },
};

/** The arguments of each helper (the words of the arguments are Fluent messages `place-arg-<name>`). */
function helperArgs(): Readonly<Record<string, PageKeyCommandSpec["args"]>> {
  const arg = (name: string, type: "string" | "number" | "boolean", optional = true, values?: readonly string[]) => ({
    type,
    description: t(`place-arg-${name}`),
    optional,
    ...(values === undefined ? {} : { values: [...values] }),
  });
  const entities = arg("entities", "string");
  const target = arg("target", "string", false);
  const axis = arg("axis", "string", true, ["x", "y", "z"]);
  return {
    align: { entities, axis, edge: arg("edge", "string", true, ["min", "centre", "max"]) },
    spread: { entities, axis },
    dropToFloor: { entities },
    on: { entities, target },
    against: { entities, target, side: arg("side", "string", true, ["+x", "-x", "+z", "-z"]) },
    near: {
      entity: arg("entity", "string"),
      target,
      angle: arg("angle", "number"),
      gap: arg("gap", "number"),
      face: arg("face", "boolean"),
    },
    facing: { entities, target },
    findSpace: { entities, near: arg("near", "string") },
  };
}

/** The commands of the placement helpers. */
export function placementCommands(parts: PlacementParts): PageKeyCommandSpec[] {
  const args = helperArgs();
  return Object.entries(HELPERS).map(([name, steps]) => ({
    id: `place.${name}`,
    menu: "entity/place",
    title: t(`place-command-${name}`),
    agents: true,
    args: args[name] ?? {},
    run: async (given: Args) => {
      const ids = entitiesOf(parts, given);
      if (ids.length === 0) throw new Error(t("place-no-entities"));
      const report = await parts.inspect();
      if (report === null) throw new Error(t("place-no-report"));
      const list = steps(report, ids, given);
      if (list.length === 0) return;
      await parts.commands.batch(list, t(`place-command-${name}`));
    },
  }));
}
