// SPDX-License-Identifier: Apache-2.0
/**
 * The views and the projection of the editor camera. There are six views along the world axes (front, back, right,
 * left, top, bottom) and a switch between the perspective and the orthographic projection. The core draws each frame
 * with a perspective camera, so the orthographic projection is a long lens. It is a field of view of `ORTHO_FOV`
 * degrees from far away, with the same height of the view at the target. The levels of detail use the size on the
 * screen, so they do not change. The fog of the scene increases with the distance.
 *
 * The keys copy the number pad of Blender on the number row with Alt: Alt+1 front, Alt+3 right, Alt+7 top. Shift
 * gives the opposite view, and Alt+5 changes the projection.
 */
import { MAX_PITCH, type OrbitCamera, type ViewPose } from "@scenity/editor-core";
import { vlength, vnormalize, vscale, vsub } from "@scenity/scene/math";
import { t } from "../../texts";
import { SCENE_CONTEXT, type PageKeyCommandSpec } from "../settings/pageKeys";

/** The field of view of the orthographic projection (degrees). */
export const ORTHO_FOV = 1;

export type Projection = "perspective" | "orthographic";

export const EDITOR_VIEWS = ["front", "back", "right", "left", "top", "bottom"] as const;
export type EditorViewName = (typeof EDITOR_VIEWS)[number];

/** The turn, the tilt (radians; yaw 0 and pitch 0 look along -Z) and the key of each view. */
const VIEWS: Readonly<
  Record<EditorViewName, { readonly yaw: number; readonly pitch: number; readonly chord: string }>
> = {
  front: { yaw: 0, pitch: 0, chord: "Alt+1" },
  back: { yaw: Math.PI, pitch: 0, chord: "Alt+Shift+1" },
  right: { yaw: -Math.PI / 2, pitch: 0, chord: "Alt+3" },
  left: { yaw: Math.PI / 2, pitch: 0, chord: "Alt+Shift+3" },
  top: { yaw: 0, pitch: -MAX_PITCH, chord: "Alt+7" },
  bottom: { yaw: 0, pitch: MAX_PITCH, chord: "Alt+Shift+7" },
};

/** The key of the projection switch. */
const PROJECTION = { chord: "Alt+5" } as const;

/** The view from the side of an axis: +X is the right view, +Y the top view, +Z the front view. */
export function viewOfAxis(axis: "x" | "y" | "z", positive: boolean): EditorViewName {
  if (axis === "x") return positive ? "right" : "left";
  if (axis === "y") return positive ? "top" : "bottom";
  return positive ? "front" : "back";
}

/** The editor camera turned to a view. The target and the distance do not change. */
export function turnedTo(camera: OrbitCamera, view: EditorViewName): OrbitCamera {
  const { yaw, pitch } = VIEWS[view];
  return { ...camera, yaw, pitch };
}

/** The long lens of the orthographic projection for a view, with the same target and the same height of the view. */
export function telephoto(view: ViewPose): ViewPose {
  const offset = vsub(view.target, view.position);
  const half = vlength(offset) * Math.tan((view.fov * Math.PI) / 360);
  const distance = half / Math.tan((ORTHO_FOV * Math.PI) / 360);
  const forward = vnormalize(offset);
  return { position: vsub(view.target, vscale(forward, distance)), target: view.target, fov: ORTHO_FOV };
}

/** What the commands use of the editor camera. */
export interface EditorViewPort {
  view(name: EditorViewName): void;
  readonly projection: Projection;
  setProjection(next: Projection): void;
}

/**
 * The commands of the views and of the projection (the submenu Edit ▸ Editor camera). `idle` gives the reason why the
 * camera cannot change (for example, during a fly), or null.
 */
export function editorViewCommands(port: EditorViewPort, idle: () => string | null): PageKeyCommandSpec[] {
  return [
    ...EDITOR_VIEWS.map((name): PageKeyCommandSpec => ({
      id: `view.${name}`,
      title: t(`viewport-command-view-${name}`),
      keys: [VIEWS[name].chord],
      keyContext: SCENE_CONTEXT,
      menu: "edit/camera",
      when: idle,
      run: () => port.view(name),
    })),
    {
      id: "view.projection",
      title: t("viewport-command-projection"),
      keys: [PROJECTION.chord],
      keyContext: SCENE_CONTEXT,
      menu: "edit/camera",
      when: idle,
      run: () => port.setProjection(port.projection === "perspective" ? "orthographic" : "perspective"),
    },
  ];
}
