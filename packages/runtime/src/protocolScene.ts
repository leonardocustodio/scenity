// SPDX-License-Identifier: Apache-2.0
/**
 * The document part of protocol 2: the payload of the "load" message (the scene documents and the asset manifest),
 * the results of "load" and "patch", and the options and the result of "pick" (the entity ID, the component and the
 * sub-target). protocol.ts has the messages and re-exports these types. This module has only types.
 */
import type { PrefabDocument, SceneDocument } from "@scenity/scene/schema/documents";
import type { SceneOp } from "@scenity/scene/schema/entity";
import type { SequenceDocument } from "@scenity/scene/sequence";
import type { MaterialDocument } from "@scenity/scene/schema/material";
import type { AssetManifest, AssetRecord } from "./manifest";

export type { AssetManifest, AssetRecord, SceneDocument, SceneOp };

/**
 * The documents of a "load" message. The page reads and checks them with the reader of `@scenity/scene`, so the
 * worker does not parse them again.
 */
export interface SceneDocuments {
  readonly scene: SceneDocument;
  /**
   * The sequence over the scene. The core shows the scene of the sequence at the time of the clock and poses the
   * animated models at that time. Absent: the scene does not move with the time.
   */
  readonly sequence?: SequenceDocument;
  /**
   * The prefabs of the instances of the scene. The core draws and picks the expanded scene: each instance gets the
   * entities of its prefab (`<instance>/<entity>`). A patch is ops on the scene before the expansion. The core expands
   * the scene again after each patch. Absent: the core draws the scene as it is.
   */
  readonly prefabs?: ScenePrefabs;
}

/** The prefab documents of a scene and the paths to find them. */
export interface ScenePrefabs {
  /** The path of the scene in the project: a relative prefab source starts from its folder. */
  readonly path: string;
  /** The prefab documents by their path in the project. */
  readonly set: Readonly<Record<string, PrefabDocument>>;
  /** The project path of the source file of an asset ID, for a prefab source `asset:<id>`. */
  readonly assets?: Readonly<Record<string, string>>;
}

/**
 * The documents and the asset manifest that a core loads (the "load" message without its type and ID). An absent field
 * keeps the value before it.
 *
 * How the records reach the worker: the page reads the manifest (Manifest 2, `parseAssetManifest` of
 * `@scenity/runtime/manifest` for a built manifest) and sends its records in the message, with the URL of each file.
 * The worker does not fetch or parse the manifest again. A dev manifest of source files (the scene page) has no sizes
 * and no hashes: the size and SHA-256 checks of the asset loader apply only to the files of a build. A plugin core gets
 * a `ManifestRef` (the URL of its built manifest) in `init` and in "load" with `assets`.
 */
export interface SceneLoad {
  readonly documents?: SceneDocuments;
  /** The asset manifest (Manifest 2). Null removes it. */
  readonly manifest?: AssetManifest | null;
  /** The URL of each file of the records, by the file name of the record. The client makes them absolute. */
  readonly files?: Readonly<Record<string, string>>;
  /** The LOD tier to load (default "high"). A record without that tier loads its first LOD, else its first file. */
  readonly tier?: string;
  /** The same-origin URLs of the WASM decoders: KTX2 textures need `basisWasm`, Draco meshes need `dracoWasm`. */
  readonly decoders?: SceneDecoders;
  /**
   * The asset references (`asset:<id>`) to load again from the manifest of this message (hot reload in dev). The core
   * loads the new file of each one. It puts the new file into each entity that uses it and into the environment map.
   * Then it disposes the previous GPU resources. The answer comes after the frame that shows the new assets.
   */
  readonly reload?: readonly string[];
  /**
   * A new sequence over the base scene of the last load (the sequencer of the editor). The core keeps its base scene
   * and shows the scene of the new sequence at the time of the clock. Null removes the sequence. A load with
   * `documents` takes the sequence of `documents` instead.
   */
  readonly sequence?: SequenceDocument | null;
  /**
   * The edited material documents by asset reference (`asset:<id>`), from the material editor. Each one goes in
   * place of the document of its material asset: the shared material of the asset changes for each entity that uses
   * it, with no load of the asset file. The answer comes after the frame that shows the new values.
   */
  readonly materials?: Readonly<Record<string, MaterialDocument>>;
  /**
   * A new prefab set over the base scene of the last load (an apply of overrides to a prefab, an undo, an edit in the
   * prefab mode). The core expands the base scene again. The answer comes after the frame that shows it.
   */
  readonly prefabs?: ScenePrefabs;
}

/** The URLs of the WASM decoders of the asset loader. An absent decoder fails the first file that needs it. */
export interface SceneDecoders {
  readonly basisWasm?: string;
  readonly dracoWasm?: string;
}

/**
 * The result of a load. The core sends it after the frame that shows the documents with each asset that loads (or
 * fails). `warnings` are the problems that did not stop the load (a failed asset, a failed presenter).
 */
export type LoadResult =
  | { readonly ok: true; readonly entities: number; readonly warnings: readonly string[] }
  | { readonly ok: false; readonly reason: string };

/**
 * The result of a patch: the ops apply as one transaction. The core sends it after the frame that shows the change.
 * A bad op changes nothing. `index` is the index of the first bad op.
 */
export type PatchResult =
  | { readonly ok: true; readonly warnings: readonly string[] }
  | { readonly ok: false; readonly index: number; readonly reason: string };

/**
 * The part of an entity under a pick: a glTF node of a model, a bone of a skeleton, a socket or a point of a path.
 */
export interface PickTarget {
  readonly kind: "node" | PickSubKind;
  readonly id: string;
}

/**
 * The kinds of sub-target that a pick can name: a socket point, a bone of the model, or a point of the path
 * (`path.<index>`). The name is the `<sub>` of the reference `entity:<id>#<sub>`.
 */
export type PickSubKind = "socket" | "bone" | "pathPoint";

/** The options of a pick. With no options, a pick hits each pickable entity and names no sub-target. */
export interface PickOptions {
  /** Hit only the entities with one of these pick layers (the `layers` of the `pickable` component). */
  readonly layers?: readonly string[];
  /** Name the nearest sub-target of the hit entity: true for each kind, or a list of kinds. */
  readonly sub?: boolean | readonly PickSubKind[];
}

/** The result of a pick: the entity ID, the component, the sub-target and the world point of the hit. */
export interface PickHit {
  readonly entity: string;
  /** The component whose object the ray hit, or null for an object of the entity itself. */
  readonly component: string | null;
  readonly target: PickTarget | null;
  /** The nearest sub-target when the pick asked for one. The reference is `entity:<entity>#<sub>`. */
  readonly sub?: string;
  /** The world point of the hit in metres. */
  readonly point: readonly [number, number, number];
  /** The distance from the camera to the hit in metres. */
  readonly distance: number;
}

/** The ops of a "patch" message (the scene ops of `@scenity/scene`). */
export type PatchOps = readonly SceneOp[];
