// SPDX-License-Identifier: Apache-2.0
/**
 * The inspect report of a scene document: what the document core drew at a frame, as plain data. The editor scene page
 * shows it (`__scenity.inspect()`), and the tools read it. It has each entity with its world transform, its world
 * bounds, its components, its sockets, the joints of its skeleton and its draw stats.
 */

type Vec3 = readonly [number, number, number];
type Quat = readonly [number, number, number, number];

/** A box with the axes of the world. */
export interface BoxReport {
  readonly min: Vec3;
  readonly max: Vec3;
}

/** The draw stats of one entity: its own meshes, without the meshes of its child entities. */
export interface EntityStats {
  readonly meshes: number;
  /** The triangles of one copy of each mesh. */
  readonly triangles: number;
  /** The draw calls of its meshes. An entity in an instance batch has none: the batch draws it (`instanced`). */
  readonly drawCalls: number;
  /** True when an instance batch draws the entity. */
  readonly instanced: boolean;
  /** The current level of detail (0 is the best), or null for a model with no `lod` value. */
  readonly lod: number | null;
}

/** One entity of the report. The numbers are in metres, in the world frame, rounded to 0.1 mm. */
export interface EntityReport {
  readonly id: string;
  readonly name: string | null;
  readonly parent: string | null;
  readonly tags: readonly string[];
  /** The component IDs of the entity in the document, in sorted order. */
  readonly components: readonly string[];
  /** True when the entity and each of its parents show. */
  readonly visible: boolean;
  readonly transform: { readonly position: Vec3; readonly rotation: Quat; readonly scale: Vec3 };
  /** The world box of the entity and its subtree, or null when it has no geometry. */
  readonly bounds: BoxReport | null;
  /**
   * The world box of the own meshes of the entity, without its child entities, or null when it has no own
   * geometry. The gizmos take the surfaces of a snap from it.
   */
  readonly ownBounds?: BoxReport | null;
  /** The world point of each socket of the `socket` component. */
  readonly sockets: Readonly<Record<string, Vec3>>;
  /** The world point of each bone of its model, by the canonical humanoid name or the node name; null with no bones. */
  readonly joints: Readonly<Record<string, Vec3>> | null;
  readonly stats: EntityStats;
  /**
   * The parts of the model of a `model` component, as the material overrides name them: the named nodes with
   * meshes (a key `mesh:<name>`) and the material names of the model asset. Absent with no loaded model.
   */
  readonly parts?: ModelParts;
}

/** The part names of a model asset, in sorted order. */
export interface ModelParts {
  /** The clip names of the model asset (its glTF animations), in sorted order. */
  readonly clips?: readonly string[];
  /** The length of each clip in seconds, by clip name. */
  readonly clipSeconds?: Readonly<Record<string, number>>;
  /** The clip names of the clip source of the animator of the entity (its own asset), after it loads. */
  readonly sourceClips?: readonly string[];
  /** The bone names of the skeletons of the model asset, in sorted order. */
  readonly bones?: readonly string[];
  readonly meshes: readonly string[];
  readonly materials: readonly string[];
}

/** The report of a frame of a scene document. */
export interface SceneInspectReport {
  /** The simulation time of the frame, or null before the first time or with no sequence. */
  readonly simMs: number | null;
  /** The world box of the whole scene, or null for an empty scene. */
  readonly bounds: BoxReport | null;
  /** The entities in sorted ID order. */
  readonly entities: readonly EntityReport[];
  /** The sums of the entity stats. */
  readonly totals: { readonly entities: number; readonly triangles: number; readonly drawCalls: number };
  /** The debug layers that the core can draw, and the layers that are on. */
  readonly layers: { readonly names: readonly string[]; readonly on: readonly string[] };
  /** The count of the onion skin meshes that the core draws (absent: none). */
  readonly onion?: number;
  /** The count of the ghost meshes of the changes that wait (absent: none). */
  readonly ghosts?: number;
  /** The state of each layer of each animator at the time of the last frame (absent: none). */
  readonly animators?: readonly AnimatorLayersReport[];
}

/** The layers of the animator of an entity at a time: the state of each, and the state that it fades from. */
export interface AnimatorLayersReport {
  readonly entity: string;
  readonly layers: readonly { readonly name: string; readonly state: string; readonly from: string | null }[];
}
