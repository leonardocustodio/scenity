// SPDX-License-Identifier: Apache-2.0
/**
 * The node materials of a generic scene on WebGPU. The node library of the WebGPU backend (webgpu.ts) has
 * only the materials of the 3D room: standard, basic, line and points. A generic scene also has the materials of a
 * material asset and of the glTF material extensions: physical, Lambert and Phong. The document core of
 * `@scenity/runtime` (documentCoreGpu.ts) adds them with `addSceneMaterials`. The room entries do not import this
 * module, so the room workers do not get larger.
 *
 * The environment map of the scene: WebGLRenderer (r186) lights a Lambert or a Phong material with the irradiance of
 * `scene.environment` (`getIBLIrradiance`, with `scene.environmentIntensity`). The Lambert and Phong node materials of
 * three.js use only their own `envMap`, so on WebGPU the shaded sides of these materials are much darker than on
 * WebGL. The node materials here add the same irradiance when the material has no `envMap` (`SceneIrradianceNode`).
 */
import {
  EnvironmentNode,
  MeshLambertNodeMaterial,
  MeshPhongNodeMaterial,
  MeshPhysicalNodeMaterial,
  type Node,
  type NodeBuilder,
  type Renderer,
} from "three/webgpu";
import type { RenderBackend } from "./types";

/** The parts of the lighting context of a node builder that `SceneIrradianceNode` uses. */
interface IrradianceContext {
  readonly irradiance: { addAssign(node: unknown): unknown };
  readonly iblIrradiance: unknown;
}

/**
 * The irradiance of the environment map of the scene for a Lambert or a Phong material. The environment node of the
 * PBR materials gives the irradiance (π × the PMREM at the normal, × the environment intensity) in `iblIrradiance`,
 * which these lighting models do not read. This node adds it to `irradiance`, as `lights_fragment_end` of WebGL does.
 */
class SceneIrradianceNode extends EnvironmentNode {
  static readonly type = "SceneIrradianceNode";

  override setup(builder: NodeBuilder): undefined {
    super.setup(builder);
    const context = builder.context as IrradianceContext;
    context.irradiance.addAssign(context.iblIrradiance);
    return undefined;
  }
}

/** The environment node of a Lambert or a Phong material: its own `envMap`, else the irradiance of the scene. */
function sceneEnvironment(own: Node | null, builder: NodeBuilder): Node | null {
  const scene = (builder as unknown as { readonly environmentNode: Node | null }).environmentNode;
  if (own !== null || scene === null) return own;
  return new SceneIrradianceNode(scene);
}

/** The Lambert node material with the irradiance of the environment map of the scene. */
class SceneLambertNodeMaterial extends MeshLambertNodeMaterial {
  override setupEnvironment(builder: NodeBuilder): ReturnType<MeshLambertNodeMaterial["setupEnvironment"]> {
    return sceneEnvironment(super.setupEnvironment(builder), builder) as ReturnType<
      MeshLambertNodeMaterial["setupEnvironment"]
    >;
  }
}

/** The Phong node material with the irradiance of the environment map of the scene. */
class ScenePhongNodeMaterial extends MeshPhongNodeMaterial {
  override setupEnvironment(builder: NodeBuilder): ReturnType<MeshPhongNodeMaterial["setupEnvironment"]> {
    return sceneEnvironment(super.setupEnvironment(builder), builder) as ReturnType<
      MeshPhongNodeMaterial["setupEnvironment"]
    >;
  }
}

/** The materials of three.js that `addSceneMaterials` adds, by the type name of the material. */
export const SCENE_MATERIALS = ["MeshPhysicalMaterial", "MeshLambertMaterial", "MeshPhongMaterial"] as const;

/** Add the node materials of the physical, Lambert and Phong materials to the library of a WebGPU backend. */
export function addSceneMaterials(backend: RenderBackend): RenderBackend {
  const library = (backend.renderer as unknown as Renderer).library;
  library.addMaterial(MeshPhysicalNodeMaterial, "MeshPhysicalMaterial");
  library.addMaterial(SceneLambertNodeMaterial, "MeshLambertMaterial");
  library.addMaterial(ScenePhongNodeMaterial, "MeshPhongMaterial");
  return backend;
}
