// SPDX-License-Identifier: Apache-2.0
/**
 * The editor overlay of the labs: the lines, the dots and the labels that the scene editor of the lab page draws over
 * the scene. The snap target of a drag, the measurements of the measure tool, the place markers of the team, the reach
 * spheres and the walk paths of the clearance overlay use it. The lab page calculates the shapes from the room data
 * and its picks. This layer only draws them.
 *
 * The overlay is a view of the lab, not an input of a frame: it is not in the URL or in `frameKey`. Thus the pictures
 * of the core (the captures, the strip and the frame index) never show it: `suppress` hides it while the core draws
 * them, as the selection outline and the ghosts. The pick skips it (pick.ts). The layer keeps no scene state between
 * frames: it draws the shapes of the last `set` and reads nothing of the scene.
 *
 * The lines and the dots have no depth test, so a wall or a prop does not hide them. A label is a quad with the text on
 * a canvas texture (a basic material: the three.js build of the room has no sprite shader). Before each camera draws it
 * (each pane), the quad turns to that camera and takes a fixed size on the screen. A thread without a canvas (a test)
 * draws no label quad, but the list keeps the label.
 */
import type { Vec3 } from "@scenity/character/math";
import {
  BufferGeometry,
  CanvasTexture,
  Float32BufferAttribute,
  Group,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  SphereGeometry,
  PlaneGeometry,
  Quaternion,
  Vector3,
  type Camera,
  type PerspectiveCamera,
  SRGBColorSpace,
} from "three";

/**
 * The tone of a shape: the snap target of a drag, a measurement, a part (a leg) of a measurement, or a place marker
 * of the team. `reach`: a reach sphere and a target in reach. `walk`: a walk path with enough free width. `narrow`: a
 * walk as narrow as in the layout of the code (known). `blocked`: a walk under the walkway limit or a target out of
 * reach (red). `handle`: a point that a drag moves (the control points of a cable route, a hand target). `ghost`: a
 * faint copy of a proposed cable route or hand target.
 */
export type OverlayTone =
  "snap" | "measure" | "part" | "place" | "reach" | "walk" | "narrow" | "blocked" | "handle" | "ghost";

/** A line through points; `closed` joins the last point to the first. */
export interface OverlayLine {
  readonly points: readonly Vec3[];
  readonly tone: OverlayTone;
  readonly closed?: boolean;
}

export interface OverlayDot {
  readonly at: Vec3;
  readonly tone: OverlayTone;
}

export interface OverlayLabel {
  readonly at: Vec3;
  readonly text: string;
  readonly tone: OverlayTone;
}

/** The shapes of the overlay. An empty spec removes them. */
export interface OverlaySpec {
  readonly lines: readonly OverlayLine[];
  readonly dots: readonly OverlayDot[];
  readonly labels: readonly OverlayLabel[];
}

/** The overlay as the layer draws it (the script API and the tests): the counts and the label texts. */
export interface OverlayView {
  readonly lines: number;
  readonly segments: number;
  readonly dots: number;
  readonly labels: readonly string[];
  /** The count of the label quads that the layer draws (0 in a thread without a canvas). */
  readonly drawnLabels: number;
  /** The count of the lines of each tone that has lines (a blocked walk gives `blocked`). */
  readonly tones?: Readonly<Partial<Record<OverlayTone, number>>>;
}

/** The box of a prop in the frame of its place (as the pick gives `local`): the snap of a drag reads it. */
export interface PropBox {
  readonly min: Vec3;
  readonly max: Vec3;
}

/** The name of the root of the overlay in the scene: the pick skips it, and the lab marker gate finds it. */
export const OVERLAY_ROOT = "lab-editor-overlay";

/** An empty spec. */
export const NO_OVERLAY: OverlaySpec = { lines: [], dots: [], labels: [] };

/**
 * The colours of the tones: an amber for the snap, a magenta for a measurement, a light magenta for its parts, a cyan
 * for a place marker. A teal for a reach sphere, a green for a free walk, a yellow for a walk that is as narrow as in
 * the code, and a red for a blocked walk or a target out of reach. A white for a handle, and a grey blue for a ghost.
 */
const TONE_COLOR: Readonly<Record<OverlayTone, number>> = {
  snap: 0xffb020,
  measure: 0xff3df0,
  part: 0xffa8f6,
  place: 0x3ddcff,
  reach: 0x2ee6b8,
  walk: 0x7dff6a,
  narrow: 0xffe14d,
  blocked: 0xff3030,
  handle: 0xf4f4f4,
  ghost: 0x8fa8c8,
};
const TONE_CSS: Readonly<Record<OverlayTone, string>> = {
  snap: "#ffb020",
  measure: "#ff3df0",
  part: "#ffa8f6",
  place: "#3ddcff",
  reach: "#2ee6b8",
  walk: "#7dff6a",
  narrow: "#ffe14d",
  blocked: "#ff3030",
  handle: "#f4f4f4",
  ghost: "#8fa8c8",
};
/** The radius of a dot (metres). */
const DOT_RADIUS = 0.012;
/** The height of a label on the screen (a share of the view height), and the font and padding of its canvas. */
const LABEL = { share: 0.035, fontPx: 36, padPx: 10 } as const;
const cameraAt = new Vector3();
const cameraTurn = new Quaternion();
const DEG = Math.PI / 180;

/**
 * Turn a label quad to a camera and size it to LABEL.share of the view height at its distance (a perspective camera;
 * another camera gets the size at 1 m). The quad has the height 1 and the aspect of its text before the scale.
 */
function faceCamera(quad: Mesh, camera: Camera, aspect: number): void {
  camera.getWorldPosition(cameraAt);
  camera.getWorldQuaternion(cameraTurn);
  const fov = (camera as Partial<PerspectiveCamera>).fov ?? 50;
  const height = 2 * Math.tan((fov * DEG) / 2) * quad.position.distanceTo(cameraAt) * LABEL.share;
  quad.quaternion.copy(cameraTurn);
  quad.scale.set(height * aspect, height, 1);
  quad.updateMatrixWorld();
}

/** A canvas for the text of a label, or null in a thread without one. */
function labelCanvas(width: number, height: number): OffscreenCanvas | HTMLCanvasElement | null {
  if (typeof OffscreenCanvas === "function") return new OffscreenCanvas(width, height);
  if (typeof document !== "undefined") {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    return canvas;
  }
  return null;
}

/** The texture of a label text, and its aspect (width over height), or null without a canvas. */
function labelTexture(
  text: string,
  tone: OverlayTone,
): { texture: CanvasTexture<OffscreenCanvas | HTMLCanvasElement>; aspect: number } | null {
  const font = `600 ${String(LABEL.fontPx)}px system-ui, sans-serif`;
  const probe = labelCanvas(8, 8);
  const measure = probe?.getContext("2d") as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
  if (probe === null || measure === null) return null;
  measure.font = font;
  const width = Math.ceil(measure.measureText(text).width) + LABEL.padPx * 2;
  const height = LABEL.fontPx + LABEL.padPx * 2;
  const canvas = labelCanvas(width, height);
  const draw = canvas?.getContext("2d") as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
  if (canvas === null || draw === null) return null;
  draw.fillStyle = "rgba(16, 18, 24, 0.82)";
  draw.fillRect(0, 0, width, height);
  draw.font = font;
  draw.fillStyle = TONE_CSS[tone];
  draw.textBaseline = "middle";
  draw.fillText(text, LABEL.padPx, height / 2);
  const texture = new CanvasTexture<OffscreenCanvas | HTMLCanvasElement>(canvas);
  texture.colorSpace = SRGBColorSpace;
  return { texture, aspect: width / height };
}

/** The segment pairs of the lines of one tone (two points per segment). */
function segmentsOf(lines: readonly OverlayLine[], tone: OverlayTone): number[] {
  const out: number[] = [];
  for (const line of lines) {
    if (line.tone !== tone) continue;
    const points = line.closed === true && line.points.length > 2 ? [...line.points, line.points[0]] : line.points;
    for (let i = 1; i < points.length; i += 1) {
      const [a, b] = [points[i - 1], points[i]];
      if (a !== undefined && b !== undefined) out.push(...a, ...b);
    }
  }
  return out;
}

const TONES: readonly OverlayTone[] = [
  "snap",
  "measure",
  "part",
  "place",
  "reach",
  "walk",
  "narrow",
  "blocked",
  "handle",
  "ghost",
];

export class OverlayLayer {
  readonly root = new Group();
  private readonly lineMaterials = new Map<OverlayTone, LineBasicMaterial>();
  private readonly dotMaterials = new Map<OverlayTone, MeshBasicMaterial>();
  private readonly dot = new SphereGeometry(DOT_RADIUS, 12, 8);
  private spec: OverlaySpec = NO_OVERLAY;
  private drawnLabels = 0;
  /** The geometries of the lines, for their dispose. */
  private readonly geometries: BufferGeometry[] = [];
  /** The materials and the textures of the label quads, for their dispose. */
  private readonly labelMaterials: MeshBasicMaterial[] = [];
  private readonly textures: CanvasTexture<OffscreenCanvas | HTMLCanvasElement>[] = [];
  /** The quad of a label: height 1, its bottom edge at its place. */
  private readonly quad = new PlaneGeometry(1, 1).translate(0, 0.5, 0);
  private suppressed = false;

  constructor() {
    this.root.name = OVERLAY_ROOT;
    // Over the scene, the ghosts (1001) and the outline (1002).
    this.root.renderOrder = 1003;
    this.root.visible = false;
    for (const tone of TONES) {
      const color = TONE_COLOR[tone];
      // A ghost is faint.
      const opacity = tone === "ghost" ? 0.55 : 1;
      this.lineMaterials.set(tone, new LineBasicMaterial({ color, depthTest: false, transparent: true, opacity }));
      this.dotMaterials.set(tone, new MeshBasicMaterial({ color, depthTest: false, transparent: true, opacity }));
    }
  }

  /** Set the new shapes and remove the shapes before them. */
  set(spec: OverlaySpec): void {
    this.clear();
    this.spec = { lines: [...spec.lines], dots: [...spec.dots], labels: [...spec.labels] };
    for (const tone of TONES) {
      const pairs = segmentsOf(spec.lines, tone);
      if (pairs.length === 0) continue;
      const geometry = new BufferGeometry();
      geometry.setAttribute("position", new Float32BufferAttribute(pairs, 3));
      this.geometries.push(geometry);
      const lines = new LineSegments(geometry, this.lineMaterials.get(tone));
      lines.renderOrder = this.root.renderOrder;
      lines.frustumCulled = false;
      this.root.add(lines);
    }
    for (const dot of spec.dots) {
      const mesh = new Mesh(this.dot, this.dotMaterials.get(dot.tone));
      mesh.position.set(dot.at[0], dot.at[1], dot.at[2]);
      mesh.renderOrder = this.root.renderOrder;
      this.root.add(mesh);
    }
    for (const label of spec.labels) this.addLabel(label);
    this.show();
  }

  private addLabel(label: OverlayLabel): void {
    const made = labelTexture(label.text, label.tone);
    if (made === null) return;
    this.textures.push(made.texture);
    const material = new MeshBasicMaterial({
      map: made.texture,
      depthTest: false,
      transparent: true,
      toneMapped: false,
    });
    this.labelMaterials.push(material);
    const quad = new Mesh(this.quad, material);
    quad.position.set(label.at[0], label.at[1], label.at[2]);
    quad.renderOrder = this.root.renderOrder + 1;
    quad.frustumCulled = false;
    // Each pane draws with its own camera: the quad turns to the camera of the draw.
    quad.onBeforeRender = (_renderer, _scene, camera) => {
      faceCamera(quad, camera, made.aspect);
    };
    this.root.add(quad);
    this.drawnLabels += 1;
  }

  /** The overlay as the layer draws it. */
  list(): OverlayView {
    const segments = TONES.reduce((count, tone) => count + segmentsOf(this.spec.lines, tone).length / 6, 0);
    const tones: Partial<Record<OverlayTone, number>> = {};
    for (const line of this.spec.lines) tones[line.tone] = (tones[line.tone] ?? 0) + 1;
    return {
      lines: this.spec.lines.length,
      segments,
      dots: this.spec.dots.length,
      labels: this.spec.labels.map((label) => label.text),
      drawnLabels: this.drawnLabels,
      tones,
    };
  }

  /** Hide the overlay while the core draws a picture of a frame (true), and show it again (false). */
  suppress(on: boolean): void {
    this.suppressed = on;
    this.show();
  }

  private show(): void {
    const { lines, dots, labels } = this.spec;
    this.root.visible = !this.suppressed && lines.length + dots.length + labels.length > 0;
  }

  private clear(): void {
    for (const child of [...this.root.children]) this.root.remove(child);
    for (const geometry of this.geometries.splice(0)) geometry.dispose();
    for (const texture of this.textures.splice(0)) texture.dispose();
    for (const material of this.labelMaterials.splice(0)) material.dispose();
    this.spec = NO_OVERLAY;
    this.drawnLabels = 0;
  }

  dispose(): void {
    this.clear();
    for (const material of [...this.lineMaterials.values(), ...this.dotMaterials.values()]) material.dispose();
    this.dot.dispose();
    this.quad.dispose();
    this.root.removeFromParent();
  }
}
