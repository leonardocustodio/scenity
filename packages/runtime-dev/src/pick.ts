// SPDX-License-Identifier: Apache-2.0
/**
 * The pick of the labs: a ray from the camera through a point of the canvas finds what is under the pointer. The ray
 * tests the meshes of the scene graph (props, the items of the plugin kinds, the room) with the three.js Raycaster. It
 * tests the members with capsules on their joints. The capsules give the bone of a member at a low cost, for the glTF
 * characters and the graybox mannequin alike, and they do not depend on the skinning. The pick reads the scene and
 * changes nothing that a frame draws. Thus it works the same in the worker, on the main thread and on each renderer
 * backend. A plugin registers the names of its own kinds (pickKinds.ts).
 */
import type { Vec3 } from "@scenity/character/math";
import {
  Box3,
  Matrix4,
  Raycaster,
  Vector2,
  Vector3,
  type Camera,
  type Object3D,
  type Ray,
  type SkinnedMesh,
} from "three";
import type { Joints } from "./inspect";
import { nearPoints, type PickCamera, type PickKind, type PickResult } from "./pickMath";
import { bonePickKind, pluginItemOf, type PickItem } from "./pickKinds";
import { posedMesh } from "./posedMesh";
import { SCRATCH_PREFIX, scratchPlaceOf } from "./scratch";
import { skinnedBox } from "./skinBounds";

export type { PickCamera, PickKind, PickNear, PickResult } from "./pickMath";

/** A member for the pick: its root (the subtree that the mesh test skips) and its joints in the room. */
export interface PickMember {
  readonly id: string;
  readonly root: Object3D;
  readonly joints: Joints;
  /** The tips of the hands (the middle finger bones of a glTF character), or null for the graybox (handTips). */
  readonly tips?: { readonly l: Vec3 | null; readonly r: Vec3 | null };
}

/** The tip of each hand of a glTF character: the last middle finger bone of the rig spec; null for the graybox. */
export function handTips(root: Object3D): { l: Vec3 | null; r: Vec3 | null } {
  const at = new Vector3();
  const tip = (side: "l" | "r"): Vec3 | null => {
    const bone = root.getObjectByName(`middle_03_${side}`) ?? root.getObjectByName(`middle_02_${side}`);
    if (bone === undefined) return null;
    bone.getWorldPosition(at);
    return [at.x, at.y, at.z];
  };
  return { l: tip("l"), r: tip("r") };
}

/** The parts of the core that the pick reads. */
export interface PickInput {
  readonly scene: Object3D;
  readonly camera: Camera;
  /** The size of the canvas in CSS pixels. */
  readonly width: number;
  readonly height: number;
  readonly members: Iterable<PickMember>;
  /** The work points of the scene. */
  readonly points: Readonly<Record<string, Vec3>>;
  /** The places of the props of the scene by slot (the plugin core gives them). */
  readonly places: Readonly<Record<string, { readonly at: Vec3; readonly yaw: number }>>;
}

/** The depth (metres) of a part without an owner in front of a prop that still belongs to the prop (ownerOfHit). */
const SCREEN_DEPTH = 0.05;

/**
 * The objects that the pick never hits: the lab layers over the scene. These include the ghosts of the proposals
 * (`GHOST_ROOT` of ghosts.ts; the text is here, because ghosts.ts imports this module) and the editor overlay
 * (`OVERLAY_ROOT` of overlay.ts).
 */
const SKIP_NAMES = new Set([
  "debug-layers",
  "selection-outline",
  "lab-proposal-ghosts",
  "lab-editor-overlay",
  // The onion skin (`ONION_ROOT` of onion.ts).
  "lab-onion-skin",
]);

/** A capsule of a member: the segment `a` → `b`, its radius and the bone that it stands for. */
export interface Capsule {
  readonly bone: string;
  readonly a: Vector3;
  readonly b: Vector3;
  readonly radius: number;
}

const toVector = (at: Vec3 | undefined): Vector3 | null => (at === undefined ? null : new Vector3(at[0], at[1], at[2]));

/** The point at `length` metres past `to` on the line `from` → `to`. */
function beyond(from: Vector3, to: Vector3, length: number): Vector3 {
  const way = to.clone().sub(from);
  const size = way.length();
  return size === 0 ? to.clone() : to.clone().addScaledVector(way, length / size);
}

/**
 * The capsules of a member from its joints: the trunk, the neck, the head, and each arm, hand, thigh, calf and foot. A
 * hand goes from the wrist to the tip of the middle finger (a glTF character) or 17 cm farther along the forearm
 * (graybox).
 */
export function memberCapsules(joints: Joints, tips?: PickMember["tips"]): Capsule[] {
  const out: Capsule[] = [];
  const add = (bone: string, a: Vector3 | null, b: Vector3 | null, radius: number): void => {
    if (a !== null && b !== null) out.push({ bone, a, b, radius });
  };
  const pelvis = toVector(joints.pelvis);
  const head = toVector(joints.head);
  if (pelvis !== null && head !== null) {
    // The base of the neck: 12 cm from the head joint toward the pelvis.
    const neck = head.clone().addScaledVector(pelvis.clone().sub(head).normalize(), 0.12);
    add("spine_02", pelvis, neck, 0.15);
    add("neck_01", neck, head, 0.06);
    add("head", head, beyond(pelvis, head, 0.2), 0.11);
  }
  for (const side of ["l", "r"] as const) {
    const shoulder = toVector(joints[`shoulder_${side}`]);
    const elbow = toVector(joints[`elbow_${side}`]);
    const wrist = toVector(joints[`wrist_${side}`]);
    add(`upperarm_${side}`, shoulder, elbow, 0.055);
    add(`lowerarm_${side}`, elbow, wrist, 0.045);
    const tip = toVector(tips?.[side] ?? undefined);
    if (elbow !== null && wrist !== null) add(`hand_${side}`, wrist, tip ?? beyond(elbow, wrist, 0.17), 0.05);
    const hip = toVector(joints[`hip_${side}`]);
    const knee = toVector(joints[`knee_${side}`]);
    const ankle = toVector(joints[`ankle_${side}`]);
    add(`thigh_${side}`, hip, knee, 0.08);
    add(`calf_${side}`, knee, ankle, 0.06);
    add(`foot_${side}`, ankle, ankle, 0.07);
  }
  return out;
}

function raySphere(ray: Ray, center: Vector3, radius: number): number | null {
  const offset = ray.origin.clone().sub(center);
  const b = offset.dot(ray.direction);
  const c = offset.dot(offset) - radius * radius;
  const h = b * b - c;
  if (h < 0) return null;
  const t = -b - Math.sqrt(h);
  if (t >= 0) return t;
  return c <= 0 ? 0 : null;
}

/**
 * The distance along a ray (a unit direction) to its first hit of a capsule, or null. A ray that starts in the capsule
 * hits it at 0.
 */
export function rayCapsule(ray: Ray, a: Vector3, b: Vector3, radius: number): number | null {
  const axis = b.clone().sub(a);
  const length = axis.length();
  if (length < 1e-9) return raySphere(ray, a, radius);
  const dir = axis.divideScalar(length);
  const offset = ray.origin.clone().sub(a);
  const along = ray.direction.dot(dir);
  const offsetAlong = offset.dot(dir);
  // The cylinder about the axis: |(offset + t d) - ((offset + t d)·dir) dir|² = r².
  const qa = 1 - along * along;
  const qb = offset.dot(ray.direction) - offsetAlong * along;
  const qc = offset.dot(offset) - offsetAlong * offsetAlong - radius * radius;
  let best: number | null = null;
  if (qa > 1e-12) {
    const h = qb * qb - qa * qc;
    if (h >= 0) {
      const t = (-qb - Math.sqrt(h)) / qa;
      const s = offsetAlong + t * along;
      if (s >= 0 && s <= length) best = Math.max(0, t);
    }
  }
  for (const end of [a, b]) {
    const t = raySphere(ray, end, radius);
    if (t !== null && (best === null || t < best)) best = t;
  }
  return best;
}

/** True when the object and each of its parents show (the Raycaster tests hidden objects too). */
function shows(object: Object3D): boolean {
  for (let node: Object3D | null = object; node !== null; node = node.parent) if (!node.visible) return false;
  return true;
}

/** True for the root of a lab layer over the scene (SKIP_NAMES): the pick and the pane hide skip it. */
export function isLabLayer(name: string): boolean {
  return SKIP_NAMES.has(name);
}

/**
 * The item of a node name: a prop, a scratch prop, an item of a plugin kind or a member, else null. `hit` is the name
 * of the hit object below the node (a plugin can name the part of the hit).
 */
export function itemOfName(name: string, hit = ""): PickItem | null {
  if (name.startsWith("prop-")) return { kind: "prop", id: name.slice(5) };
  // A scratch prop of the checkout (scratch.ts).
  if (name.startsWith(SCRATCH_PREFIX)) return { kind: "scratch", id: name.slice(SCRATCH_PREFIX.length) };
  // The names of the plugin kinds (pickKinds.ts).
  const item = pluginItemOf(name, hit);
  if (item !== null) return item;
  // A bystander (person:) or a member that the pick did not get as a member (member:).
  if (/^(member|person):/.test(name)) return { kind: "member", id: name.slice(name.indexOf(":") + 1) };
  return null;
}

/** The kind and the ID of a hit object: the first named parent that is a prop or an item of a plugin kind. */
export function ownerOf(object: Object3D): { kind: PickKind; id: string; root: Object3D | null } {
  let room: string | null = null;
  for (let node: Object3D | null = object; node !== null; node = node.parent) {
    const name = node.name;
    // The names of the items are in itemOfName, which the pane hide also reads.
    const item = itemOfName(name, object.name);
    if (item !== null) return { ...item, root: node };
    if (room === null && name !== "" && name !== "room") room = name;
  }
  return { kind: "room", id: room ?? "room", root: null };
}

/** The nearest bone of a skinned mesh to a point, or null for a mesh without a skeleton. */
function nearestBone(object: Object3D, point: Vector3): string | null {
  const skeleton = (object as Partial<SkinnedMesh>).skeleton;
  if (skeleton === undefined) return null;
  let best: string | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  const at = new Vector3();
  for (const bone of skeleton.bones) {
    const distance = bone.getWorldPosition(at).distanceTo(point);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = bone.name;
    }
  }
  return best;
}

type Hit = ReturnType<Raycaster["intersectObject"]>[number];

/** The distance along the ray to the bound of a skinned mesh (skinBounds.ts), or null when the ray misses it. */
function skinnedDistance(ray: Ray, mesh: SkinnedMesh): number | null {
  const box = skinnedBox(mesh);
  // Without a bound the pick tests the mesh.
  if (box === null) return 0;
  if (box.isEmpty()) return null;
  const entry = ray.intersectBox(box, new Vector3());
  return entry === null ? null : entry.distanceTo(ray.origin);
}

/**
 * The hits of the skinned meshes that the ray reaches before `limit`. A skinned mesh costs a skinning of each vertex,
 * so the pick tests its bound (skinBounds.ts) first. The pick does not test a mesh behind a nearer hit or off the ray.
 * It tests a mesh that the ray reaches as a plain mesh of its current pose (posedMesh.ts): one skinning of each vertex
 * in place of five or more. The hits name the skinned mesh, so the owner and the bone of a hit stay the same.
 */
function skinnedHits(raycaster: Raycaster, meshes: readonly SkinnedMesh[], limit: number): Hit[] {
  const plain = new Map<Object3D, SkinnedMesh>();
  for (const mesh of meshes) {
    const distance = skinnedDistance(raycaster.ray, mesh);
    if (distance !== null && distance < limit) plain.set(posedMesh(mesh), mesh);
  }
  if (plain.size === 0) return [];
  return raycaster
    .intersectObjects([...plain.keys()], false)
    .map((hit) => ({ ...hit, object: plain.get(hit.object) ?? hit.object }));
}

/** The mesh hits of a ray, the nearest first: the visible meshes outside the members and the lab layers. */
function meshHits(raycaster: Raycaster, scene: Object3D, skip: ReadonlySet<Object3D>): Hit[] {
  const plain: Object3D[] = [];
  const skinned: SkinnedMesh[] = [];
  scene.traverse((node) => {
    if ((node as { isMesh?: boolean }).isMesh !== true || !shows(node)) return;
    for (let up: Object3D | null = node; up !== null; up = up.parent) {
      if (skip.has(up) || SKIP_NAMES.has(up.name)) return;
    }
    if ((node as Partial<SkinnedMesh>).isSkinnedMesh === true) skinned.push(node as SkinnedMesh);
    else plain.push(node);
  });
  const hits = raycaster.intersectObjects(plain, false);
  // A skinned mesh just behind the first hit can still own it (ownerOfHit), so the limit adds SCREEN_DEPTH.
  const more = skinnedHits(raycaster, skinned, (hits[0]?.distance ?? Number.POSITIVE_INFINITY) + SCREEN_DEPTH);
  return more.length === 0 ? hits : [...hits, ...more].sort((a, b) => a.distance - b.distance);
}

/**
 * The box of a prop in the frame of its place (the place position at the origin, before the turn): the corners of the
 * box of each mesh, taken to that frame. A model turns with its place, so its box stays tight.
 */
export function placeBox(root: Object3D, place: { readonly at: Vec3; readonly yaw: number }): { min: Vec3; max: Vec3 } {
  const toPlace = new Matrix4().makeRotationY(place.yaw).setPosition(place.at[0], place.at[1], place.at[2]).invert();
  const box = new Box3();
  const corner = new Vector3();
  root.updateWorldMatrix(true, true);
  root.traverse((node) => {
    const mesh = node as { isMesh?: boolean; geometry?: { boundingBox: Box3 | null; computeBoundingBox(): void } };
    if (mesh.isMesh !== true || mesh.geometry === undefined || !shows(node)) return;
    if (mesh.geometry.boundingBox === null) mesh.geometry.computeBoundingBox();
    const local = mesh.geometry.boundingBox;
    if (local === null) return;
    for (let i = 0; i < 8; i += 1) {
      corner.set(
        i & 1 ? local.max.x : local.min.x,
        i & 2 ? local.max.y : local.min.y,
        i & 4 ? local.max.z : local.min.z,
      );
      box.expandByPoint(corner.applyMatrix4(node.matrixWorld).applyMatrix4(toPlace));
    }
  });
  if (box.isEmpty()) return { min: [0, 0, 0], max: [0, 0, 0] };
  return { min: [box.min.x, box.min.y, box.min.z], max: [box.max.x, box.max.y, box.max.z] };
}

/**
 * The owner of the first hit. A part without an owner (a screen of the room, a glass) a few centimetres in front of a
 * prop or an item belongs to that prop or item: a pick on the screen of a device names the device.
 */
function ownerOfHit(hits: readonly Hit[]): ReturnType<typeof ownerOf> {
  const first = hits[0];
  if (first === undefined) return { kind: "room", id: "room", root: null };
  const owner = ownerOf(first.object);
  if (owner.kind !== "room") return owner;
  for (const hit of hits.slice(1)) {
    if (hit.distance - first.distance > SCREEN_DEPTH) break;
    const behind = ownerOf(hit.object);
    if (behind.kind !== "room") return behind;
  }
  return owner;
}

/** The first member capsule on a ray: the member, the bone and the distance, or null. */
function memberHit(ray: Ray, members: Iterable<PickMember>): { id: string; bone: string; t: number } | null {
  let best: { id: string; bone: string; t: number } | null = null;
  for (const member of members) {
    for (const capsule of memberCapsules(member.joints, member.tips)) {
      const t = rayCapsule(ray, capsule.a, capsule.b, capsule.radius);
      if (t !== null && (best === null || t < best.t)) best = { id: member.id, bone: capsule.bone, t };
    }
  }
  return best;
}

/** The camera of a pick result. */
function pickCamera(input: PickInput): PickCamera {
  return {
    world: [...input.camera.matrixWorld.elements],
    projectionInverse: [...input.camera.projectionMatrixInverse.elements],
    width: input.width,
    height: input.height,
  };
}

/**
 * Pick at a point of the canvas (CSS pixels from its top left corner): the nearest of the mesh hits and the member
 * capsules, or null when the ray hits nothing. `radius` is the radius of the near points.
 */
export function pickScene(
  input: PickInput,
  x: number,
  y: number,
  options: { readonly pane?: number; readonly radius?: number } = {},
): PickResult | null {
  if (input.width <= 0 || input.height <= 0 || !Number.isFinite(x) || !Number.isFinite(y)) return null;
  const raycaster = new Raycaster();
  raycaster.setFromCamera(new Vector2((x / input.width) * 2 - 1, -(y / input.height) * 2 + 1), input.camera);
  const members = [...input.members];
  const hits = meshHits(raycaster, input.scene, new Set(members.map((member) => member.root)));
  const mesh = hits[0];
  const member = memberHit(raycaster.ray, members);
  const base = { pane: options.pane ?? 0, camera: pickCamera(input) };
  if (member !== null && (mesh === undefined || member.t <= mesh.distance)) {
    const at = raycaster.ray.at(member.t, new Vector3());
    const point: Vec3 = [at.x, at.y, at.z];
    return {
      kind: "member",
      id: member.id,
      object: member.bone,
      bone: member.bone,
      point,
      distance: member.t,
      near: nearPoints(input.points, point, options.radius),
      local: null,
      ...base,
    };
  }
  if (mesh === undefined) return null;
  const owner = ownerOfHit(hits);
  const point: Vec3 = [mesh.point.x, mesh.point.y, mesh.point.z];
  const place =
    owner.kind === "prop"
      ? input.places[owner.id]
      : owner.kind === "scratch" && owner.root !== null
        ? scratchPlaceOf(owner.root)
        : undefined;
  return {
    kind: owner.kind,
    id: owner.id,
    object: mesh.object.name,
    bone: bonePickKind(owner.kind) ? nearestBone(mesh.object, mesh.point) : null,
    point,
    distance: mesh.distance,
    near: nearPoints(input.points, point, options.radius),
    local: owner.root !== null && place !== undefined ? placeBox(owner.root, place) : null,
    ...base,
  };
}
