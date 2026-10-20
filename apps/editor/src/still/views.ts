// SPDX-License-Identifier: Apache-2.0
/**
 * The views of the still page: one picture of one asset for the asset stills of @scenity/assets.
 *
 * - A model: a framed view from its bounds on a neutral background, with a neutral room light and a soft ground shadow.
 * - An environment map: the map behind a mirror sphere and a matte sphere.
 * - A texture: the image, scaled to fit, on a check pattern (the pattern shows the transparent parts).
 *
 * Each view gives a function that draws the picture into a 2D context of the still size. The page gives each view a
 * function that loads the asset with the asset source of the scene page. The source gives the built outputs of a
 * project with a build, else the source files. Thus a still shows what a scene shows.
 */
import {
  ACESFilmicToneMapping,
  Box3,
  Color,
  DirectionalLight,
  EquirectangularReflectionMapping,
  Mesh,
  MeshStandardMaterial,
  PCFShadowMap,
  PerspectiveCamera,
  PlaneGeometry,
  PMREMGenerator,
  Scene,
  ShadowMaterial,
  SphereGeometry,
  SRGBColorSpace,
  Vector3,
  WebGLRenderer,
  type Object3D,
  type Texture,
} from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";

/** A function that draws the picture into a 2D context of the given size. */
export type StillDraw = (context: OffscreenCanvasRenderingContext2D, width: number, height: number) => void;

/** A function that loads an asset. The renderer gives the KTX2 target of the GPU. */
export type StillLoad<T> = (support: { readonly renderer: WebGLRenderer }) => Promise<T>;

/** The neutral background of a model and a texture. */
const BACKGROUND = "#a9adb4";
/** The direction from the model to the camera: 35° round the up axis, 20° above the ground. */
const AZIMUTH = (35 * Math.PI) / 180;
const ELEVATION = (20 * Math.PI) / 180;
/** The vertical field of view of the model camera, in degrees. */
const FOV = 30;
/** The part of the frame that the model fills. */
const FILL = 0.86;

function newRenderer(canvas: HTMLCanvasElement): WebGLRenderer {
  const renderer = new WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1);
  renderer.setSize(canvas.clientWidth, canvas.clientHeight, false);
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.toneMapping = ACESFilmicToneMapping;
  return renderer;
}

/** The copy of the WebGL canvas into the 2D context. */
function copyOf(canvas: HTMLCanvasElement): StillDraw {
  return (context, width, height) => {
    context.drawImage(canvas, 0, 0, width, height);
  };
}

/**
 * The distance from the centre of the box that shows each corner of the box in the frame. The camera looks along
 * `-direction`; `right` and `up` are the axes of the image.
 */
export function fitDistance(box: Box3, camera: PerspectiveCamera, direction: Vector3): number {
  const up = new Vector3(0, 1, 0);
  const right = new Vector3().crossVectors(up, direction).normalize();
  const screenUp = new Vector3().crossVectors(direction, right).normalize();
  const tanV = Math.tan((camera.fov * Math.PI) / 360) * FILL;
  const tanH = tanV * camera.aspect;
  const centre = box.getCenter(new Vector3());
  let distance = 0;
  for (let corner = 0; corner < 8; corner += 1) {
    const point = new Vector3(
      corner & 1 ? box.max.x : box.min.x,
      corner & 2 ? box.max.y : box.min.y,
      corner & 4 ? box.max.z : box.min.z,
    ).sub(centre);
    const depth = point.dot(direction);
    distance = Math.max(
      distance,
      depth + Math.abs(point.dot(right)) / tanH,
      depth + Math.abs(point.dot(screenUp)) / tanV,
    );
  }
  return distance;
}

/** A ground plane under the model that shows only the shadow. */
function ground(box: Box3, size: number): Mesh {
  const plane = new Mesh(new PlaneGeometry(size, size), new ShadowMaterial({ opacity: 0.22 }));
  plane.rotation.x = -Math.PI / 2;
  plane.position.set((box.min.x + box.max.x) / 2, box.min.y, (box.min.z + box.max.z) / 2);
  plane.receiveShadow = true;
  return plane;
}

/** A key light above the model whose shadow camera holds the model. */
function keyLight(box: Box3, radius: number): DirectionalLight {
  const light = new DirectionalLight(0xffffff, 1.6);
  const centre = box.getCenter(new Vector3());
  light.position.copy(centre).add(new Vector3(0.5, 1.4, 0.8).normalize().multiplyScalar(radius * 4));
  light.target.position.copy(centre);
  light.castShadow = true;
  light.shadow.mapSize.set(2048, 2048);
  const shadow = light.shadow.camera;
  shadow.left = shadow.bottom = -radius * 1.5;
  shadow.right = shadow.top = radius * 1.5;
  shadow.near = radius;
  shadow.far = radius * 8;
  shadow.updateProjectionMatrix();
  return light;
}

/** The view of a model: a glTF or GLB file. */
export async function modelView(canvas: HTMLCanvasElement, load: StillLoad<Object3D>): Promise<StillDraw> {
  const renderer = newRenderer(canvas);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = PCFShadowMap;
  const scene = new Scene();
  scene.background = new Color(BACKGROUND);
  const pmrem = new PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.8;
  const model = await load({ renderer });
  model.traverse((node) => {
    if (node instanceof Mesh) node.castShadow = true;
  });
  scene.add(model);
  const box = new Box3().setFromObject(model);
  if (box.isEmpty()) throw new Error("the model has no mesh");
  const radius = Math.max(box.getSize(new Vector3()).length() / 2, 1e-3);
  scene.add(ground(box, radius * 12));
  const light = keyLight(box, radius);
  scene.add(light, light.target);
  const camera = new PerspectiveCamera(FOV, canvas.clientWidth / Math.max(1, canvas.clientHeight));
  const direction = new Vector3(
    Math.sin(AZIMUTH) * Math.cos(ELEVATION),
    Math.sin(ELEVATION),
    Math.cos(AZIMUTH) * Math.cos(ELEVATION),
  );
  const distance = fitDistance(box, camera, direction);
  const centre = box.getCenter(new Vector3());
  camera.position.copy(centre).addScaledVector(direction, distance);
  camera.near = Math.max(distance - radius * 2, distance / 100);
  camera.far = distance + radius * 4;
  camera.lookAt(centre);
  camera.updateProjectionMatrix();
  renderer.render(scene, camera);
  return copyOf(canvas);
}

/** The view of an environment map: a Radiance HDR file behind a mirror sphere and a matte sphere. */
export async function environmentView(canvas: HTMLCanvasElement, load: StillLoad<Texture>): Promise<StillDraw> {
  const renderer = newRenderer(canvas);
  const map = await load({ renderer });
  map.mapping = EquirectangularReflectionMapping;
  const scene = new Scene();
  scene.background = map;
  scene.environment = new PMREMGenerator(renderer).fromEquirectangular(map).texture;
  const geometry = new SphereGeometry(0.85, 96, 48);
  const mirror = new Mesh(geometry, new MeshStandardMaterial({ color: 0xffffff, metalness: 1, roughness: 0.04 }));
  const matte = new Mesh(geometry, new MeshStandardMaterial({ color: 0xd8d8d8, metalness: 0, roughness: 0.9 }));
  mirror.position.x = -0.95;
  matte.position.x = 0.95;
  scene.add(mirror, matte);
  const camera = new PerspectiveCamera(55, canvas.clientWidth / Math.max(1, canvas.clientHeight), 0.1, 100);
  camera.position.set(0, 0.25, 3.6);
  camera.lookAt(0, 0, 0);
  renderer.render(scene, camera);
  return copyOf(canvas);
}

/** The view of a texture: the image, scaled to fit the still, on a check pattern. */
export async function textureView(url: string): Promise<StillDraw> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`no image at ${url} (${String(response.status)})`);
  const image = await createImageBitmap(await response.blob());
  return (context, width, height) => {
    context.fillStyle = BACKGROUND;
    context.fillRect(0, 0, width, height);
    context.fillStyle = "#c4c7cc";
    const cell = 16;
    for (let y = 0; y < height; y += cell) {
      for (let x = (y / cell) % 2 === 0 ? 0 : cell; x < width; x += cell * 2) context.fillRect(x, y, cell, cell);
    }
    const scale = Math.min(width / image.width, height / image.height);
    // A small image keeps sharp texels, so the still does not smooth it when it enlarges it.
    context.imageSmoothingEnabled = scale < 1;
    const w = image.width * scale;
    const h = image.height * scale;
    context.drawImage(image, (width - w) / 2, (height - h) / 2, w, h);
  };
}
