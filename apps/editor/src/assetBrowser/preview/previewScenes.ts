// SPDX-License-Identifier: Apache-2.0
/**
 * The live previews of the asset inspector: a three.js view in a canvas of the inspector.
 *
 * - The turntable: the model turns round its centre in a neutral room light. A model with clips plays its first clip.
 *   An animation with no mesh shows its skeleton.
 * - The environment: the map behind a mirror ball and a matte ball. The camera turns round the balls.
 * - The material ball: a sphere with the material in a neutral room light. The sphere turns.
 *
 * The canvas gets `data-ready="1"` after the first frame, or `data-error` with the message. `stop` ends the loop and
 * releases the WebGL context.
 */
import {
  ACESFilmicToneMapping,
  AnimationMixer,
  Box3,
  EquirectangularReflectionMapping,
  Group,
  Mesh,
  MeshStandardMaterial,
  PerspectiveCamera,
  PMREMGenerator,
  Scene,
  SkeletonHelper,
  SphereGeometry,
  SRGBColorSpace,
  Vector3,
  WebGLRenderer,
  type Material,
  type Object3D,
  type Texture,
} from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { fitDistance } from "../../still/views";

/** The loads of a preview: the renderer gives the KTX2 target of the GPU. */
export interface PreviewLoads {
  model(renderer: WebGLRenderer): Promise<Object3D>;
  environment(renderer: WebGLRenderer): Promise<Texture>;
  material(renderer: WebGLRenderer): Promise<Material>;
}

/** The live view: `stop` ends it. */
export interface PreviewHandle {
  stop(): void;
}

/** One turn of the turntable takes 12 s. */
const TURN_SPEED = (2 * Math.PI) / 12;
const ELEVATION = (20 * Math.PI) / 180;

/** The box of a model: its meshes, else the positions of its bones (an animation has no mesh). */
function boxOf(model: Object3D): Box3 {
  const box = new Box3().setFromObject(model);
  if (!box.isEmpty()) return box;
  model.updateMatrixWorld(true);
  model.traverse((node) => box.expandByPoint(node.getWorldPosition(new Vector3())));
  if (box.isEmpty() || box.getSize(new Vector3()).length() < 1e-4) box.expandByScalar(0.5);
  return box;
}

/** The turntable scene of a model: a pivot at the centre of the model, the clip mixer and the camera distance. */
function turntable(scene: Scene, model: Object3D, camera: PerspectiveCamera): (seconds: number) => void {
  const box = boxOf(model);
  const centre = box.getCenter(new Vector3());
  const pivot = new Group();
  model.position.sub(centre);
  pivot.add(model);
  scene.add(pivot);
  if (new Box3().setFromObject(model).isEmpty()) scene.add(new SkeletonHelper(model));
  const mixer = model.animations.length > 0 ? new AnimationMixer(model) : null;
  const clip = model.animations[0];
  if (mixer !== null && clip !== undefined) mixer.clipAction(clip).play();
  const direction = new Vector3(0, Math.sin(ELEVATION), Math.cos(ELEVATION));
  const distance = fitDistance(box.clone().translate(centre.clone().negate()), camera, direction);
  const radius = Math.max(box.getSize(new Vector3()).length() / 2, 1e-3);
  camera.position.copy(direction).multiplyScalar(distance);
  camera.near = Math.max(distance - radius * 2, distance / 100);
  camera.far = distance + radius * 4;
  camera.lookAt(0, 0, 0);
  camera.updateProjectionMatrix();
  return (seconds) => {
    pivot.rotation.y += TURN_SPEED * seconds;
    mixer?.update(seconds);
  };
}

/** The balls of an environment map. The camera turns round them. */
function environmentBalls(scene: Scene, map: Texture, camera: PerspectiveCamera): (seconds: number) => void {
  map.mapping = EquirectangularReflectionMapping;
  scene.background = map;
  const geometry = new SphereGeometry(0.85, 96, 48);
  const mirror = new Mesh(geometry, new MeshStandardMaterial({ color: 0xffffff, metalness: 1, roughness: 0.04 }));
  const matte = new Mesh(geometry, new MeshStandardMaterial({ color: 0xd8d8d8, metalness: 0, roughness: 0.9 }));
  mirror.position.x = -0.95;
  matte.position.x = 0.95;
  scene.add(mirror, matte);
  let angle = 0;
  return (seconds) => {
    angle += (TURN_SPEED / 2) * seconds;
    camera.position.set(Math.sin(angle) * 3.6, 0.25, Math.cos(angle) * 3.6);
    camera.lookAt(0, 0, 0);
  };
}

/** The material ball: a sphere with the material. The sphere turns. */
function materialBall(scene: Scene, material: Material, camera: PerspectiveCamera): (seconds: number) => void {
  const ball = new Mesh(new SphereGeometry(1, 96, 48), material);
  scene.add(ball);
  camera.position.set(0, 0.35, 3.2);
  camera.lookAt(0, 0, 0);
  return (seconds) => {
    ball.rotation.y += TURN_SPEED * seconds;
  };
}

/** Start a live preview in a canvas. The promise ends after the first frame. */
export async function startPreview(
  canvas: HTMLCanvasElement,
  kind: "turntable" | "environment" | "material",
  loads: PreviewLoads,
): Promise<PreviewHandle> {
  const renderer = new WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(2, globalThis.devicePixelRatio || 1));
  renderer.setSize(canvas.clientWidth, canvas.clientHeight, false);
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.toneMapping = ACESFilmicToneMapping;
  let frame = 0;
  const stop = (): void => {
    cancelAnimationFrame(frame);
    renderer.dispose();
    renderer.forceContextLoss();
  };
  try {
    const scene = new Scene();
    const camera = new PerspectiveCamera(30, canvas.clientWidth / Math.max(1, canvas.clientHeight), 0.1, 100);
    if (kind !== "environment") {
      scene.environment = new PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture;
    }
    const step =
      kind === "turntable"
        ? turntable(scene, await loads.model(renderer), camera)
        : kind === "environment"
          ? environmentBalls(scene, await loads.environment(renderer), camera)
          : materialBall(scene, await loads.material(renderer), camera);
    let last = performance.now();
    const draw = (now: number): void => {
      step(Math.min(0.1, Math.max(0, now - last) / 1000));
      last = now;
      renderer.render(scene, camera);
      frame = requestAnimationFrame(draw);
    };
    step(0);
    renderer.render(scene, camera);
    canvas.dataset.ready = "1";
    frame = requestAnimationFrame(draw);
  } catch (error) {
    stop();
    canvas.dataset.error = error instanceof Error ? error.message : String(error);
    throw error;
  }
  return { stop };
}
