// SPDX-License-Identifier: Apache-2.0
/**
 * The grid and the axes of the editor viewport: lines on the floor plane (y = 0) at each metre, a heavier line at each
 * fifth metre, the X axis (red) and the Z axis (blue) through the origin, and a short Y axis (green) up from the
 * origin. The lines use the depth test, so a model in front of the grid hides it.
 *
 * The grid is a core layer of the dev document core ("grid"): the editor shows it only in the edit mode. It is not
 * an entity: the pick, the inspect report and the bounds of the scene do not see it, and the camera preview hides it.
 */
import { BufferAttribute, BufferGeometry, LineBasicMaterial, LineSegments, type Object3D } from "three";

/** The half size of the grid (metres) and the height of its lines over the floor (no depth fight with a floor). */
export const GRID_HALF = 20;
const LIFT = 0.004;
const AXIS_UP = 1;
const MINOR = [0.36, 0.36, 0.4] as const;
const MAJOR = [0.55, 0.55, 0.6] as const;
const AXIS_X = [0.9, 0.25, 0.25] as const;
const AXIS_Y = [0.3, 0.85, 0.3] as const;
const AXIS_Z = [0.3, 0.45, 0.95] as const;

/** The vertices and the colours of the grid lines (two vertices for each line). */
export function gridLines(half = GRID_HALF): { positions: number[]; colors: number[] } {
  const positions: number[] = [];
  const colors: number[] = [];
  const line = (a: readonly number[], b: readonly number[], color: readonly number[]): void => {
    positions.push(...a, ...b);
    colors.push(...color, ...color);
  };
  for (let step = -half; step <= half; step += 1) {
    const x = step === 0 ? AXIS_Z : step % 5 === 0 ? MAJOR : MINOR;
    const z = step === 0 ? AXIS_X : step % 5 === 0 ? MAJOR : MINOR;
    // A line along Z at x = step (the Z axis at 0), and a line along X at z = step (the X axis at 0).
    line([step, LIFT, -half], [step, LIFT, half], x);
    line([-half, LIFT, step], [half, LIFT, step], z);
  }
  line([0, LIFT, 0], [0, AXIS_UP, 0], AXIS_Y);
  return { positions, colors };
}

/** The grid object of a dev document core. The core adds it to the scene at the first use. */
export class ViewGrid {
  #lines: LineSegments | null = null;

  /** Show the grid in `scene` (`on`), or hide it. */
  apply(scene: Object3D, on: boolean): void {
    if (!on && this.#lines === null) return;
    const lines = this.#lines ?? this.#make(scene);
    lines.visible = on;
  }

  /** Hide the grid for one draw (the camera preview); the result shows it again. */
  hide(): () => void {
    const lines = this.#lines;
    if (lines?.visible !== true) return () => undefined;
    lines.visible = false;
    return () => {
      lines.visible = true;
    };
  }

  dispose(): void {
    this.#lines?.removeFromParent();
    this.#lines?.geometry.dispose();
    (this.#lines?.material as LineBasicMaterial | undefined)?.dispose();
    this.#lines = null;
  }

  #make(scene: Object3D): LineSegments {
    const { positions, colors } = gridLines();
    const geometry = new BufferGeometry();
    geometry.setAttribute("position", new BufferAttribute(new Float32Array(positions), 3));
    geometry.setAttribute("color", new BufferAttribute(new Float32Array(colors), 3));
    const lines = new LineSegments(geometry, new LineBasicMaterial({ vertexColors: true }));
    lines.name = "editor-grid";
    lines.frustumCulled = false;
    scene.add(lines);
    this.#lines = lines;
    return lines;
  }
}
