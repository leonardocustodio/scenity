// SPDX-License-Identifier: Apache-2.0
/**
 * The retarget of a clip through the rig profiles (`@scenity/character/retarget`): a clip of one humanoid
 * skeleton becomes a clip of another humanoid skeleton, with tracks on the node names of the target.
 *
 * The choice: the retarget is a function over the keys of a clip (`retargetClip`), not a step of the pose mixer at
 * sample time. A model retargets a clip once, when it loads it; the pose mixer and the animator bind the new clip by
 * node name as any clip of the model. So a frame costs nothing more, the worker carries no profile tables, and the
 * frame at a time stays a function of the clip and the time.
 *
 * The method (rest-pose aware). For each canonical bone that both skeletons have:
 *
 * 1. The motion of the source bone is its turn from its rest rotation, in the space of the model: D = R(t) · R₀⁻¹.
 * 2. The two rest poses can differ (an A-pose and a T-pose, other bone axes). The alignment A turns the rest
 *    direction of the target bone onto the rest direction of the source bone (the shortest arc). A bone with no
 *    direction (the head, the toes, a hand with no fingers) takes the alignment of its canonical parent.
 * 3. The target bone gets the rotation D · A · T₀ in the space of the model, then the local rotation under its posed
 *    parent. So at each time the canonical bone directions of the target are the directions of the source.
 * 4. The hips move by the motion of the source hips, scaled by the ratio of the two hip heights.
 *
 * A node of the target that no canonical bone names keeps its rest transform (a twist bone follows its parent). A
 * segment of the source between two canonical bones that bends (a shin segment of Rigify) gives a small error: below
 * 0.5° on the mannequin of the characters sample.
 */
import {
  AnimationClip,
  Matrix4,
  PropertyBinding,
  Quaternion,
  QuaternionKeyframeTrack,
  Vector3,
  VectorKeyframeTrack,
  type KeyframeTrack,
} from "three";
import { HUMAN_BONE_SPECS, HUMAN_BONES, type HumanBone } from "./profiles/humanoid";
import type { RigProfile } from "./profiles/profiles";
import { resolveProfile, type BoneMap } from "./profiles/resolve";
import {
  boneDirections,
  boneIndices,
  clipSampler,
  modelMatrices,
  restLocals,
  type LocalPose,
  type RestPose,
} from "./rest";

export interface RetargetOptions {
  /** The sample times in seconds (default: each key time of the source clip). */
  readonly times?: readonly number[];
  /** The name of the new clip (default: the name of the source clip). */
  readonly name?: string;
  /** The bone maps, when the caller resolved the profiles already. */
  readonly fromMap?: BoneMap;
  readonly toMap?: BoneMap;
}

/** A canonical bone that both skeletons have. */
interface Pair {
  readonly bone: HumanBone;
  readonly source: number;
  readonly target: number;
  /** The inverse of the rest rotation of the source bone (model space). */
  readonly sourceRestInverse: Quaternion;
  /** The aligned rest rotation of the target bone: A · T₀ (model space). */
  readonly targetRest: Quaternion;
}

const rotationOf = (m: Matrix4): Quaternion => {
  const q = new Quaternion();
  m.decompose(new Vector3(), q, new Vector3());
  return q;
};

/** Each key time of the tracks of a clip, sorted, with no repeats (to 1 µs). */
function keyTimes(clip: AnimationClip): number[] {
  const set = new Set<number>();
  for (const track of clip.tracks) for (const t of track.times) set.add(Math.round(t * 1e6) / 1e6);
  if (set.size === 0) set.add(0);
  return [...set].sort((a, b) => a - b);
}

/** The alignment of each canonical bone: the turn of the target rest direction onto the source rest direction. */
function alignments(
  from: ReadonlyMap<HumanBone, number>,
  to: ReadonlyMap<HumanBone, number>,
  fromWorld: readonly Matrix4[],
  toWorld: readonly Matrix4[],
): Map<HumanBone, Quaternion> {
  const sourceDirs = boneDirections(from, fromWorld, to);
  const targetDirs = boneDirections(to, toWorld, from);
  const out = new Map<HumanBone, Quaternion>();
  for (const spec of HUMAN_BONES) {
    const s = sourceDirs.get(spec.name);
    const t = targetDirs.get(spec.name);
    // The two directions must point to the same canonical child.
    if (s !== undefined && t?.child === s.child) {
      out.set(spec.name, new Quaternion().setFromUnitVectors(t.direction, s.direction));
      continue;
    }
    // No direction: the alignment of the nearest canonical parent with one (parent-first order, so it is known).
    let parent = spec.parent;
    while (parent !== null && !out.has(parent)) parent = HUMAN_BONE_SPECS.get(parent)?.parent ?? null;
    out.set(spec.name, parent === null ? new Quaternion() : (out.get(parent)?.clone() ?? new Quaternion()));
  }
  return out;
}

/** The canonical bones of both skeletons, with their rest rotations. */
function pairsOf(
  from: ReadonlyMap<HumanBone, number>,
  to: ReadonlyMap<HumanBone, number>,
  fromWorld: readonly Matrix4[],
  toWorld: readonly Matrix4[],
): Pair[] {
  const align = alignments(from, to, fromWorld, toWorld);
  const pairs: Pair[] = [];
  for (const spec of HUMAN_BONES) {
    const source = from.get(spec.name);
    const target = to.get(spec.name);
    if (source === undefined || target === undefined) continue;
    const sourceRestInverse = rotationOf(fromWorld[source] ?? new Matrix4()).invert();
    const targetRest = rotationOf(toWorld[target] ?? new Matrix4()).premultiply(
      align.get(spec.name) ?? new Quaternion(),
    );
    pairs.push({ bone: spec.name, source, target, sourceRestInverse, targetRest });
  }
  return pairs;
}

/** The height of a node over the origin of the model (the y of its place), or 0. */
const heightOf = (m: Matrix4 | undefined): number => m?.elements[13] ?? 0;

/** The fixed data of one retarget: the canonical bone pairs, the hips and the scale of the hip motion. */
interface Setup {
  readonly pairs: readonly Pair[];
  readonly byTarget: ReadonlyMap<number, Pair>;
  readonly hips: Pair;
  readonly ratio: number;
  readonly sourceHipsRest: Vector3;
  readonly targetHipsRest: Vector3;
}

function setupOf(fromRest: RestPose, toRest: RestPose, fromMap: BoneMap, toMap: BoneMap): Setup {
  const fromWorld = modelMatrices(fromRest, restLocals(fromRest));
  const toWorld = modelMatrices(toRest, restLocals(toRest));
  const pairs = pairsOf(boneIndices(fromRest, fromMap), boneIndices(toRest, toMap), fromWorld, toWorld);
  const hips = pairs.find((pair) => pair.bone === "hips");
  if (hips === undefined) throw new Error("retargetClip: the two skeletons have no hips in common");
  const sourceHeight = heightOf(fromWorld[hips.source]);
  return {
    pairs,
    byTarget: new Map(pairs.map((pair) => [pair.target, pair])),
    hips,
    ratio: sourceHeight > 1e-6 ? heightOf(toWorld[hips.target]) / sourceHeight : 1,
    sourceHipsRest: new Vector3().setFromMatrixPosition(fromWorld[hips.source] ?? new Matrix4()),
    targetHipsRest: new Vector3().setFromMatrixPosition(toWorld[hips.target] ?? new Matrix4()),
  };
}

/** The local pose of the target for one posed source (model-space matrices of the source nodes). */
function targetLocals(setup: Setup, toRest: RestPose, sourceWorld: readonly Matrix4[]): LocalPose {
  const locals = restLocals(toRest);
  const world: Matrix4[] = [];
  toRest.nodes.forEach((node, i) => {
    const parent = world[node.parent];
    const pair = setup.byTarget.get(i);
    if (pair !== undefined) {
      // D · A · T₀ in the model space, then the local rotation under the posed parent.
      const rotation = rotationOf(sourceWorld[pair.source] ?? new Matrix4())
        .multiply(pair.sourceRestInverse)
        .multiply(pair.targetRest);
      const parentRotation = parent === undefined ? new Quaternion() : rotationOf(parent);
      locals.quaternions[i]?.copy(parentRotation.invert().multiply(rotation));
      if (pair === setup.hips) {
        const place = new Vector3().setFromMatrixPosition(sourceWorld[pair.source] ?? new Matrix4());
        place.sub(setup.sourceHipsRest).multiplyScalar(setup.ratio).add(setup.targetHipsRest);
        if (parent !== undefined) place.applyMatrix4(parent.clone().invert());
        locals.positions[i]?.copy(place);
      }
    }
    const local = new Matrix4().compose(
      locals.positions[i] ?? new Vector3(),
      locals.quaternions[i] ?? new Quaternion(),
      locals.scales[i] ?? new Vector3(1, 1, 1),
    );
    world.push(parent === undefined ? local : parent.clone().multiply(local));
  });
  return locals;
}

/** Add a rotation key on the side of the key before it, so the slerp takes the short way. */
function pushKey(values: number[], q: Quaternion): void {
  const n = values.length;
  const before = n >= 4 ? new Quaternion(values[n - 4], values[n - 3], values[n - 2], values[n - 1]) : null;
  const s = before !== null && before.dot(q) < 0 ? -1 : 1;
  values.push(q.x * s, q.y * s, q.z * s, q.w * s);
}

/**
 * Retarget a clip of the skeleton `fromRest` (profile `from`) to the skeleton `toRest` (profile `to`). The new clip has
 * a rotation track for each canonical bone that both skeletons have, and a position track for the hips. Throws when
 * the skeletons have no hips in common.
 */
export function retargetClip(
  clip: AnimationClip,
  from: RigProfile,
  to: RigProfile,
  fromRest: RestPose,
  toRest: RestPose,
  options: RetargetOptions = {},
): AnimationClip {
  const fromMap =
    options.fromMap ??
    resolveProfile(
      from,
      fromRest.nodes.map((n) => n.name),
    );
  const toMap =
    options.toMap ??
    resolveProfile(
      to,
      toRest.nodes.map((n) => n.name),
    );
  const setup = setupOf(fromRest, toRest, fromMap, toMap);
  const times = options.times ?? keyTimes(clip);
  const sample = clipSampler(fromRest, clip);
  const rotations = setup.pairs.map(() => [] as number[]);
  const hipsPositions: number[] = [];
  for (const time of times) {
    const locals = targetLocals(setup, toRest, modelMatrices(fromRest, sample(time)));
    setup.pairs.forEach((pair, k) => {
      pushKey(rotations[k] ?? [], locals.quaternions[pair.target] ?? new Quaternion());
    });
    const hips = locals.positions[setup.hips.target] ?? new Vector3();
    hipsPositions.push(hips.x, hips.y, hips.z);
  }
  const tracks: KeyframeTrack[] = setup.pairs.map(
    (pair, k) => new QuaternionKeyframeTrack(`${trackNode(toRest, pair.target)}.quaternion`, times, rotations[k] ?? []),
  );
  tracks.push(new VectorKeyframeTrack(`${trackNode(toRest, setup.hips.target)}.position`, times, hipsPositions));
  return new AnimationClip(options.name ?? clip.name, clip.duration, tracks);
}

/** The node name of a track: the name in the form that a track name can hold. */
function trackNode(rest: RestPose, index: number): string {
  return PropertyBinding.sanitizeNodeName(rest.nodes[index]?.name ?? "");
}
