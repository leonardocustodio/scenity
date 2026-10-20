// SPDX-License-Identifier: Apache-2.0
/**
 * The onion skin of the labs: faint copies of the members at times near the clock time, so the owner and Claude see a
 * motion in one frame. The lab page gives the members (the selected member, or the whole team) and the offsets of the
 * copies from the clock time. The labs core poses the scene at each of those times, and this layer copies the pose of
 * each member.
 *
 * - **The pose at a time** is the pose of a frame of a page that opens at that time. The core removes the frame
 *   history and the frame memory (the dev core, `poseOnion`). Then it updates the scene with the scene input of that
 *   time (the page gives it in `samples`, as the samples of the sweep). Thus a copy is a pure function of the input and
 *   the time. Then the core updates the scene at the clock time again. The core does this only when the clock is
 *   stopped. A scene that runs keeps its frame history, so the copies are hidden while the clock runs. A time without
 *   a sample has no copy.
 * - **A copy** shares the geometry and the bind data of each visible mesh of the member (not the hit capsule: its
 *   material does not draw). A skinned mesh gets its own skeleton: bones out of the scene with the world matrices of
 *   the bones at that time. A plain mesh (the graybox mannequin) gets the world matrix of the mesh at that time. Only
 *   the materials are new.
 * - **The tones**: a copy before the clock time is blue, and a copy after it is orange. The opacity decreases with the
 *   distance from the clock time (ONION_OPACITY).
 *
 * The onion skin is a view of the lab, not an input of a frame: it is not in the URL or in `frameKey`. The captures,
 * the strip and the frame index hide it (`suppress`), unless a capture asks for it (`CaptureTarget.onion`) or the page
 * asks for it in every capture (`OnionSpec.capture`, the capture mode of a sheet). The pick skips it (pick.ts). The
 * layer keeps the copies (the meshes) from frame to frame, never a pose: each pass of the core poses them again.
 */
import {
  Bone,
  Group,
  Mesh,
  MeshBasicMaterial,
  Skeleton,
  SkinnedMesh,
  Vector3,
  type Material,
  type Object3D,
} from "three";
import { JOINT_NAMES, type JointName, type Joints } from "./inspect";

/** What the lab page asks for. No offsets: no onion skin. */
export interface OnionSpec<Input = unknown> {
  /** The IDs of the members of the onion skin, or null for every member of the frame. */
  readonly members: readonly string[] | null;
  /** The offsets of the copies from the clock time (ms), for example [-500, -250, 250, 500]. */
  readonly offsets: readonly number[];
  /** True: every capture shows the onion skin (the capture mode of a sheet); false: only a capture that asks. */
  readonly capture: boolean;
  /**
   * The scene input at each time of a copy (the clock time of the page plus each offset), as the samples of the sweep;
   * absent or empty: no copies (a live session of the mock has no input at another time).
   */
  readonly samples?: readonly { readonly simMs: number; readonly input: Input }[];
}

/** One copy as the layer draws it (the script API `onionView()`, the tests). */
export interface OnionCopyView {
  readonly member: string;
  readonly offset: number;
  /** The time of the pose of the copy (ms). */
  readonly simMs: number;
  readonly tone: "before" | "after";
  readonly opacity: number;
  /** The count of the meshes of the copy (0: the member does not show at that time). */
  readonly meshes: number;
  /** The joints of the copy in the room: from the bones of the copy (a glTF character), else from its pose. */
  readonly joints: Joints;
}

export interface OnionView {
  readonly spec: OnionSpec;
  /** The clock time of the last pass, or null. */
  readonly simMs: number | null;
  /** True while the copies show (a pass at a stopped clock). */
  readonly shown: boolean;
  /** Why the copies do not show, or null. */
  readonly reason: string | null;
  readonly copies: readonly OnionCopyView[];
}

/** A member of the scene at one time of a pass: its root and its joints at that time. */
export interface OnionMember {
  readonly id: string;
  readonly root: Object3D;
  joints(): Joints;
}

/** The name of the root of the onion skin in the scene: the pick skips it, and the lab marker gate finds it. */
export const ONION_ROOT = "lab-onion-skin";
/** The colours of the copies before and after the clock time (a blue and an orange that the scene does not use). */
export const ONION_COLORS = { before: 0x4f8dff, after: 0xff9a3c } as const;
/** The opacity of the nearest copy on each side, then the next ones. */
export const ONION_OPACITY: readonly number[] = [0.34, 0.22, 0.14];

/** The bone of the rig spec for each joint (joints.ts). */
const RIG_BONES: Readonly<Record<JointName, string>> = {
  pelvis: "pelvis",
  head: "head",
  shoulder_l: "upperarm_l",
  elbow_l: "lowerarm_l",
  wrist_l: "hand_l",
  shoulder_r: "upperarm_r",
  elbow_r: "lowerarm_r",
  wrist_r: "hand_r",
  hip_l: "thigh_l",
  knee_l: "calf_l",
  ankle_l: "foot_l",
  hip_r: "thigh_r",
  knee_r: "calf_r",
  ankle_r: "foot_r",
};

/** True when the object and each of its parents show. */
function shows(node: Object3D): boolean {
  for (let up: Object3D | null = node; up !== null; up = up.parent) if (!up.visible) return false;
  return true;
}

/** True when a mesh draws: a material of it is visible (the hit capsule of a member has an invisible material). */
function draws(mesh: Mesh): boolean {
  const materials: readonly Material[] = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  return materials.some((material) => material.visible);
}

/** The tone and the opacity of each offset: the side of the clock time, and the rank of the distance on that side. */
export function onionTones(offsets: readonly number[]): { tone: "before" | "after"; opacity: number }[] {
  return offsets.map((offset) => {
    const side = offsets.filter((other) => Math.sign(other) === Math.sign(offset));
    const rank = side.filter((other) => Math.abs(other) < Math.abs(offset)).length;
    return {
      tone: offset < 0 ? "before" : "after",
      opacity: ONION_OPACITY[Math.min(rank, ONION_OPACITY.length - 1)] ?? 0.14,
    };
  });
}

/** The copy of one mesh: a skinned copy with its own bones, or a plain copy. */
interface MeshCopy {
  readonly mesh: Mesh;
  readonly bones: readonly { readonly copy: Bone; readonly source: Object3D }[];
}

/** The copy of one member at one offset. */
interface MemberCopy {
  readonly group: Group;
  readonly parts: Map<Mesh, MeshCopy>;
  simMs: number;
  meshes: number;
  joints: Joints;
}

const at = new Vector3();

export class OnionLayer {
  readonly root = new Group();
  private spec: OnionSpec = { members: null, offsets: [], capture: false, samples: [] };
  private readonly copies = new Map<string, MemberCopy>();
  private readonly materials = new Map<string, MeshBasicMaterial>();
  private simMs: number | null = null;
  private posed = false;
  private reason: string | null = "no offsets";
  private suppressed = false;

  constructor() {
    this.root.name = ONION_ROOT;
    // Before the ghosts (1001) and the outline (1002).
    this.root.renderOrder = 1000;
    this.root.visible = false;
  }

  /** The members and the offsets; the next pass of the core poses the copies. */
  set(spec: OnionSpec): void {
    this.spec = {
      members: spec.members === null ? null : [...spec.members],
      offsets: [...spec.offsets],
      capture: spec.capture,
      samples: spec.samples ?? [],
    };
    if (spec.offsets.length === 0) this.idle("no offsets");
    for (const [key, copy] of this.copies) {
      const [offset, member] = key.split("|");
      if (this.wants(member ?? "", Number(offset))) continue;
      this.root.remove(copy.group);
      this.copies.delete(key);
    }
  }

  /** True when the page asks for copies. */
  get active(): boolean {
    return this.spec.offsets.length > 0;
  }

  /** True when every capture shows the onion skin (the capture mode of a sheet). */
  get inCaptures(): boolean {
    return this.spec.capture;
  }

  /** No pass at this frame (the clock runs, or no frame time): the copies are hidden. */
  idle(reason: string): void {
    this.posed = false;
    this.reason = reason;
    this.show();
  }

  /**
   * One pass at the clock time `simMs`: for each offset with a sample of its time, the core poses the scene at that
   * time with the input of the sample (`poseAt` gives the members), and the layer copies the poses. The core poses the
   * scene at the clock time again after the pass.
   */
  pose(simMs: number, poseAt: (time: number, input: unknown) => Iterable<OnionMember>): void {
    this.simMs = simMs;
    const tones = onionTones(this.spec.offsets);
    const seen = new Set<string>();
    let posed = 0;
    this.spec.offsets.forEach((offset, index) => {
      const time = simMs + offset;
      const sample = this.spec.samples?.find((item) => item.simMs === time);
      if (time < 0 || sample === undefined) return;
      posed += 1;
      const tone = tones[index] ?? { tone: "after", opacity: 0.14 };
      for (const member of poseAt(time, sample.input)) {
        if (!this.wants(member.id, offset)) continue;
        const key = `${String(offset)}|${member.id}`;
        seen.add(key);
        const copy = this.copyOf(key);
        copy.simMs = time;
        copy.joints = member.joints();
        this.poseCopy(copy, member.root, this.material(tone.tone, tone.opacity));
      }
    });
    for (const [key, copy] of this.copies) copy.group.visible = seen.has(key);
    this.posed = posed > 0;
    this.reason =
      posed > 0 ? null : "no scene input at the times of the copies (the page sends them for a stopped clock)";
    this.show();
  }

  /** True when the spec has a sample at a time of a copy near `simMs` (the core needs no pass without one). */
  hasSamples(simMs: number): boolean {
    return this.spec.offsets.some(
      (offset) => this.spec.samples?.some((item) => item.simMs === simMs + offset) === true,
    );
  }

  /** The copies as the layer draws them. */
  list(): OnionView {
    const tones = onionTones(this.spec.offsets);
    const copies = [...this.copies].map(([key, copy]): OnionCopyView => {
      const [offsetText, member = ""] = key.split("|");
      const offset = Number(offsetText);
      const tone = tones[this.spec.offsets.indexOf(offset)] ?? { tone: "after" as const, opacity: 0 };
      return {
        member,
        offset,
        simMs: copy.simMs,
        ...tone,
        meshes: copy.group.visible ? copy.meshes : 0,
        joints: this.copyJoints(copy),
      };
    });
    return { spec: this.spec, simMs: this.simMs, shown: this.root.visible, reason: this.reason, copies };
  }

  /** Hide the copies while the core draws a picture of a frame (true), and show them again (false). */
  suppress(on: boolean): void {
    this.suppressed = on;
    this.show();
  }

  dispose(): void {
    for (const copy of this.copies.values()) this.root.remove(copy.group);
    this.copies.clear();
    for (const material of this.materials.values()) material.dispose();
    this.materials.clear();
    this.root.removeFromParent();
  }

  private wants(member: string, offset: number): boolean {
    const members = this.spec.members;
    return this.spec.offsets.includes(offset) && (members === null || members.includes(member));
  }

  private show(): void {
    this.root.visible = !this.suppressed && this.posed && this.active;
  }

  private copyOf(key: string): MemberCopy {
    const known = this.copies.get(key);
    if (known !== undefined) return known;
    const group = new Group();
    group.name = `onion:${key}`;
    this.root.add(group);
    const made: MemberCopy = { group, parts: new Map(), simMs: 0, meshes: 0, joints: {} };
    this.copies.set(key, made);
    return made;
  }

  private material(tone: "before" | "after", opacity: number): MeshBasicMaterial {
    const key = `${tone}:${String(opacity)}`;
    const known = this.materials.get(key);
    if (known !== undefined) return known;
    // The polygon offset puts a copy behind a surface of the same depth. Where a copy and the current member have one
    // pose, the current member shows clean (no stripes of the two surfaces).
    const made = new MeshBasicMaterial({
      color: ONION_COLORS[tone],
      transparent: true,
      opacity,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: 1,
      polygonOffsetUnits: 4,
    });
    this.materials.set(key, made);
    return made;
  }

  /** Pose a copy from the current meshes of a member: each visible mesh gets its copy with the current matrices. */
  private poseCopy(copy: MemberCopy, root: Object3D, material: Material): void {
    const used = new Set<Mesh>();
    root.updateWorldMatrix(true, true);
    root.traverse((node) => {
      const mesh = node as Partial<Mesh> & Object3D;
      if (
        mesh.isMesh !== true ||
        mesh.geometry === undefined ||
        (mesh as { isInstancedMesh?: boolean }).isInstancedMesh === true
      )
        return;
      const source = mesh as Mesh;
      if (!draws(source)) return;
      const part = copy.parts.get(source) ?? this.copyMesh(copy, source);
      used.add(source);
      part.mesh.visible = shows(source);
      part.mesh.material = material;
      part.mesh.matrix.copy(source.matrixWorld);
      part.mesh.matrixWorld.copy(source.matrixWorld);
      for (const bone of part.bones) bone.copy.matrixWorld.copy(bone.source.matrixWorld);
      const influences = source.morphTargetInfluences;
      if (influences !== undefined) part.mesh.morphTargetInfluences = [...influences];
    });
    for (const [source, part] of copy.parts) {
      if (used.has(source)) continue;
      copy.group.remove(part.mesh);
      copy.parts.delete(source);
    }
    copy.meshes = [...copy.parts.values()].filter((part) => part.mesh.visible).length;
  }

  /** The copy of a mesh: the geometry and the bind data of the mesh, its own bones for a skinned mesh. */
  private copyMesh(copy: MemberCopy, source: Mesh): MeshCopy {
    const skinned = source as Partial<SkinnedMesh>;
    let mesh: Mesh;
    let bones: MeshCopy["bones"] = [];
    if (skinned.isSkinnedMesh === true && skinned.skeleton !== undefined) {
      const from = source as SkinnedMesh;
      bones = from.skeleton.bones.map((bone) => {
        const made = new Bone();
        made.name = bone.name;
        made.matrixAutoUpdate = false;
        made.matrixWorldAutoUpdate = false;
        return { copy: made, source: bone };
      });
      const made = new SkinnedMesh(from.geometry);
      made.bindMode = from.bindMode;
      made.bind(
        new Skeleton(
          bones.map((bone) => bone.copy),
          from.skeleton.boneInverses,
        ),
        from.bindMatrix,
      );
      made.morphTargetDictionary = from.morphTargetDictionary;
      mesh = made;
    } else mesh = new Mesh(source.geometry);
    mesh.name = `onion:${source.name}`;
    mesh.matrixAutoUpdate = false;
    mesh.matrixWorldAutoUpdate = false;
    mesh.frustumCulled = false;
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    mesh.renderOrder = this.root.renderOrder;
    copy.group.add(mesh);
    const part: MeshCopy = { mesh, bones };
    copy.parts.set(source, part);
    return part;
  }

  /** The joints of a copy: the world places of the bones of the copy by the names of the rig, else its pose joints. */
  private copyJoints(copy: MemberCopy): Joints {
    const bones = new Map<string, Bone>();
    for (const part of copy.parts.values()) for (const bone of part.bones) bones.set(bone.copy.name, bone.copy);
    if (bones.size === 0) return { ...copy.joints };
    const out: Partial<Record<JointName, readonly [number, number, number]>> = {};
    for (const name of JOINT_NAMES) {
      const bone = bones.get(RIG_BONES[name]);
      if (bone === undefined) continue;
      at.setFromMatrixPosition(bone.matrixWorld);
      out[name] = [at.x, at.y, at.z];
    }
    return out;
  }
}
