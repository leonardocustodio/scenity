// SPDX-License-Identifier: Apache-2.0
/**
 * The rest pose of a skeleton as data: the nodes of a model with their parent and their rest transform. The
 * retarget reads two rest poses; a worker or a build tool can make one from a model (`restPoseOf`) or from the JSON
 * of a glTF file with no three.js loader (`restPoseOfGltf`). The module also poses a rest pose with a clip at a time,
 * in the space of the model (the tests and the dev pages compare the canonical bones of two skeletons with it).
 */
import {
  Matrix4,
  PropertyBinding,
  Quaternion,
  Vector3,
  type AnimationClip,
  type Interpolant,
  type KeyframeTrack,
  type Object3D,
} from "three";
import type { BoneMap } from "./profiles/resolve";
import { HUMAN_BONES, type HumanBone } from "./profiles/humanoid";
import { sanitizeNodeName } from "./profiles/resolve";

/** One node of a rest pose. `parent` is the index of the parent node, or -1 for a node at the top of the model. */
export interface RestNode {
  readonly name: string;
  readonly parent: number;
  readonly position: readonly [number, number, number];
  readonly quaternion: readonly [number, number, number, number];
  readonly scale: readonly [number, number, number];
}

/** The nodes of a model in parent-first order. The space of the model is the space of its root object. */
export interface RestPose {
  readonly nodes: readonly RestNode[];
}

/** The rest pose of the nodes under `root` (not the root itself), from their current transforms. */
export function restPoseOf(root: Object3D): RestPose {
  const nodes: RestNode[] = [];
  const index = new Map<Object3D, number>();
  root.traverse((node) => {
    if (node === root) return;
    index.set(node, nodes.length);
    const { position: p, quaternion: q, scale: s } = node;
    const parent = node.parent === null ? -1 : (index.get(node.parent) ?? -1);
    nodes.push({
      name: node.name,
      parent,
      position: [p.x, p.y, p.z],
      quaternion: [q.x, q.y, q.z, q.w],
      scale: [s.x, s.y, s.z],
    });
  });
  return { nodes };
}

interface GltfNode {
  readonly name?: string;
  readonly children?: readonly number[];
  readonly translation?: readonly number[];
  readonly rotation?: readonly number[];
  readonly scale?: readonly number[];
  readonly matrix?: readonly number[];
}

interface GltfJson {
  readonly nodes?: readonly GltfNode[];
  readonly scenes?: readonly { readonly nodes?: readonly number[] }[];
  readonly scene?: number;
}

const tuple3 = (v: readonly number[] | undefined, d: number): [number, number, number] => [
  v?.[0] ?? d,
  v?.[1] ?? d,
  v?.[2] ?? d,
];

/**
 * The rest pose of the default scene of a glTF document (its JSON). The node names are in the form of the glTF loader
 * of three.js: the sanitized name, and `_1`, `_2` after a name that a node before it has.
 */
export function restPoseOfGltf(json: GltfJson): RestPose {
  const all = json.nodes ?? [];
  const roots = json.scenes?.[json.scene ?? 0]?.nodes ?? [];
  const used = new Map<string, number>();
  const unique = (name: string): string => {
    const form = sanitizeNodeName(name);
    const count = used.get(form);
    used.set(form, (count ?? -1) + 1);
    return count === undefined ? form : `${form}_${String(count + 1)}`;
  };
  const names = all.map((node) => unique(node.name ?? ""));
  const nodes: RestNode[] = [];
  const visit = (i: number, parent: number): void => {
    const node = all[i];
    if (node === undefined) return;
    let position = tuple3(node.translation, 0);
    let quaternion: [number, number, number, number] = [
      node.rotation?.[0] ?? 0,
      node.rotation?.[1] ?? 0,
      node.rotation?.[2] ?? 0,
      node.rotation?.[3] ?? 1,
    ];
    let scale = tuple3(node.scale, 1);
    if (node.matrix !== undefined) {
      const p = new Vector3();
      const q = new Quaternion();
      const s = new Vector3();
      new Matrix4().fromArray(node.matrix).decompose(p, q, s);
      position = [p.x, p.y, p.z];
      quaternion = [q.x, q.y, q.z, q.w];
      scale = [s.x, s.y, s.z];
    }
    const index = nodes.length;
    nodes.push({ name: names[i] ?? "", parent, position, quaternion, scale });
    for (const child of node.children ?? []) visit(child, index);
  };
  for (const root of roots) visit(root, -1);
  return { nodes };
}

/** The local transform of each node: a position, a rotation and a scale, by node index. */
export interface LocalPose {
  readonly positions: Vector3[];
  readonly quaternions: Quaternion[];
  readonly scales: Vector3[];
}

/** A copy of the rest transforms of a rest pose. */
export function restLocals(rest: RestPose): LocalPose {
  return {
    positions: rest.nodes.map((n) => new Vector3(...n.position)),
    quaternions: rest.nodes.map((n) => new Quaternion(...n.quaternion)),
    scales: rest.nodes.map((n) => new Vector3(...n.scale)),
  };
}

/** The matrix of each node in the space of the model. */
export function modelMatrices(rest: RestPose, locals: LocalPose): Matrix4[] {
  const out: Matrix4[] = [];
  rest.nodes.forEach((node, i) => {
    const local = new Matrix4().compose(
      locals.positions[i] ?? new Vector3(),
      locals.quaternions[i] ?? new Quaternion(),
      locals.scales[i] ?? new Vector3(1, 1, 1),
    );
    const parent = out[node.parent];
    out.push(parent === undefined ? local : parent.clone().multiply(local));
  });
  return out;
}

/** A track with the interpolant factory of its interpolation mode (the type declarations of three.js omit it). */
type SampledTrack = KeyframeTrack & { createInterpolant(): Interpolant };

/** The tracks of a clip bound to the nodes of a rest pose by name: a sampler of the local pose at a time. */
export function clipSampler(rest: RestPose, clip: AnimationClip): (time: number) => LocalPose {
  const index = new Map<string, number>();
  rest.nodes.forEach((node, i) => {
    if (!index.has(node.name)) index.set(node.name, i);
  });
  const bound: { node: number; property: string; interpolant: Interpolant }[] = [];
  for (const track of clip.tracks) {
    const { nodeName, propertyName } = PropertyBinding.parseTrackName(track.name);
    const node = index.get(nodeName);
    if (node === undefined || !["position", "quaternion", "scale"].includes(propertyName)) continue;
    bound.push({ node, property: propertyName, interpolant: (track as SampledTrack).createInterpolant() });
  }
  return (time) => {
    const locals = restLocals(rest);
    for (const { node, property, interpolant } of bound) {
      const value = interpolant.evaluate(time);
      if (property === "quaternion") locals.quaternions[node]?.fromArray(value).normalize();
      else if (property === "position") locals.positions[node]?.fromArray(value);
      else locals.scales[node]?.fromArray(value);
    }
    return locals;
  };
}

/** The matrices of the nodes of a rest pose in the space of the model, posed by a clip at `time` seconds. */
export function poseAt(rest: RestPose, clip: AnimationClip, time: number): Matrix4[] {
  return modelMatrices(rest, clipSampler(rest, clip)(time));
}

/** The node index of each canonical bone of a bone map. */
export function boneIndices(rest: RestPose, map: BoneMap): Map<HumanBone, number> {
  const index = new Map<string, number>();
  rest.nodes.forEach((node, i) => {
    if (!index.has(node.name)) index.set(node.name, i);
  });
  const out = new Map<HumanBone, number>();
  for (const [bone, name] of map) {
    const i = index.get(name);
    if (i !== undefined) out.set(bone, i);
  }
  return out;
}

/** The direction of a canonical bone: the unit vector from its head to the head of `child`, in the model space. */
export interface BoneDirection {
  readonly child: HumanBone;
  readonly direction: Vector3;
}

/**
 * The direction of each canonical bone of a posed skeleton (see `HumanBoneSpec.toward`). `common`, when given, limits
 * the choice of the child to the bones that it has (the bones of the other skeleton of a compare).
 */
export function boneDirections(
  indices: ReadonlyMap<HumanBone, number>,
  matrices: readonly Matrix4[],
  common: ReadonlyMap<HumanBone, unknown> = indices,
): Map<HumanBone, BoneDirection> {
  const out = new Map<HumanBone, BoneDirection>();
  const head = (i: number) => new Vector3().setFromMatrixPosition(matrices[i] ?? new Matrix4());
  for (const spec of HUMAN_BONES) {
    const i = indices.get(spec.name);
    const child = spec.toward.find((bone) => indices.has(bone) && common.has(bone));
    const c = child === undefined ? undefined : indices.get(child);
    if (i === undefined || child === undefined || c === undefined) continue;
    const direction = head(c).sub(head(i));
    if (direction.lengthSq() > 1e-12) out.set(spec.name, { child, direction: direction.normalize() });
  }
  return out;
}
