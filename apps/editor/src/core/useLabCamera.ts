// SPDX-License-Identifier: Apache-2.0
/**
 * The camera of the 3D room lab: the framing of the room kit, a named camera (cameras.ts) or a free view. A drag on
 * the scene (a swipe on a phone) turns the camera about its target. The wheel or a pinch moves it nearer or farther.
 * W, A, S, D, Q and E move it in the room, and the arrow keys turn it in place. The URL keeps the camera: `camera` for
 * a named camera, `view` for a free view. Thus a reload or a shared link shows the same angle.
 */
import type { CameraView } from "@scenity/runtime/framing";
import { framedFov, orbitView } from "@scenity/runtime/camera";
import { onBeforeUnmount, onMounted, ref, shallowRef, type Ref, type ShallowRef } from "vue";
import { cameraNames, cameraView, isCameraName, parseView, viewText, type CameraName } from "./cameras";
import { typingInto } from "./labUi";
import { editorRoom } from "./sceneSource";

/** A drag turns the camera by a quarter turn across the width of the scene and an eighth across its height. */
const TURN_ACROSS = Math.PI / 2;
const TURN_DOWN = Math.PI / 4;
/** The camera stays in the room: inside the walls, above the floor and below the ceiling. */
// The walls of the room less 0.15 m: x ±9.2, z -2.4 to 16.0, ceiling 7.6 m (temporary).
const ROOM_BOUNDS = { min: [-9.05, 0.3, -2.25], max: [9.05, 7.45, 15.85] } as const;

/**
 * W, A, S and D move the camera over the floor: W and S along the view, A and D across it. Q lowers it to the floor and
 * E raises it to the ceiling. The target moves with the camera, thus the angle stays. Shift moves it faster. Each key:
 * across, along, up.
 */
const WALK_KEYS: Readonly<Record<string, readonly [number, number, number]>> = {
  KeyW: [0, 1, 0],
  KeyS: [0, -1, 0],
  KeyA: [-1, 0, 0],
  KeyD: [1, 0, 0],
  KeyQ: [0, 0, -1],
  KeyE: [0, 0, 1],
};
/** The speed of the camera on a walk key (metres per second), and with Shift. */
const WALK_SPEED = { normal: 1.5, fast: 3.5 } as const;
/** The longest time step of one frame of a walk (seconds): a slow frame does not jump the camera. */
const WALK_STEP_MAX = 0.1;
/**
 * The arrow keys turn the camera in place: left and right about the vertical, up and down to the ceiling and to the
 * floor. The camera stays, and the target turns about it at the same distance. Each key: turn (+1 to the right), tilt
 * (+1 up).
 */
const LOOK_KEYS: Readonly<Record<string, readonly [number, number]>> = {
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  ArrowUp: [0, 1],
  ArrowDown: [0, -1],
};
/** The speed of the turn on an arrow key (radians per second), and with Shift. */
const LOOK_SPEED = { normal: 1.2, fast: 2.6 } as const;
/** The largest tilt of the view up or down (radians, about 83°): the camera does not turn over. */
const LOOK_TILT_MAX = 1.45;
/** The keys 1 to 9 choose the named cameras in their order. */
const NUMBER_KEYS = ["Digit1", "Digit2", "Digit3", "Digit4", "Digit5", "Digit6", "Digit7", "Digit8", "Digit9"];

/** True for an arrow key on a control of the panel that uses the arrow keys (the tabs, a radio group, a slider). */
function arrowsInto(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    target.closest(
      '[role="tab"], [role="tablist"], [role="radiogroup"], [role="radio"], [role="slider"], [role="listbox"], [role="option"], [role="menu"], [role="menuitem"]',
    ) !== null
  );
}

export interface LabCamera {
  /** The view of the scene: a named or free view, or null for the framing of the room kit. */
  readonly view: ShallowRef<CameraView | null>;
  /** The named camera in use, or null for a free view. */
  readonly name: Ref<CameraName | null>;
  /** The view at the end of the last move of the camera: equal to `view` when the camera does not move. */
  readonly settled: ShallowRef<CameraView | null>;
  setCamera(name: CameraName): void;
  /**
   * A named camera as the keys 1 to 9 give it: of the focused pane of the split screen, else of this camera (the
   * command `camera.open`).
   */
  openCamera(name: CameraName): void;
  setView(view: CameraView | null): void;
  /**
   * The current view of the focused pane, else of this camera. For the framing of the room kit, the result has its
   * place, its target and the field of view of its framing.
   */
  current(): CameraView;
  /** Open a free view (a bookmark) in the focused pane, else in this camera. */
  openView(view: CameraView): void;
  reset(): void;
  onDown(event: PointerEvent): void;
  onMove(event: PointerEvent): void;
  onUp(event: PointerEvent): void;
  onWheel(event: WheelEvent): void;
  /**
   * The drag, the wheel, the walk keys, the arrow keys and the number keys act on another camera (the focused pane of
   * the split screen), or on this camera again (null).
   */
  focusOn(target: PaneCameraTarget | null): void;
}

/** A camera that the keys and the orbit can move in place of the main camera (a pane of the split screen). */
export interface PaneCameraTarget {
  /** The view of the pane, or null for the framing of the room kit. */
  view(): CameraView | null;
  /** A new view of the pane: a named camera, or a free view (name null). */
  set(view: CameraView | null, name: CameraName | null): void;
  /** The move ended: keep the view. */
  keep(): void;
  /** The box of the pane on the screen (CSS pixels), or null. */
  box(): { readonly width: number; readonly height: number } | null;
}

export function useLabCamera(scene: Ref<HTMLElement | null>, params: URLSearchParams): LabCamera {
  const startName = params.get("camera");
  const free = parseView(params.get("view"));
  const name = ref<CameraName | null>(
    startName !== null && isCameraName(startName) ? startName : free === null ? "overview" : null,
  );
  const view = shallowRef<CameraView | null>(name.value === null ? free : cameraView(name.value));
  /** The camera of the focused pane, or null for this camera. */
  let focused: PaneCameraTarget | null = null;

  /** The box of the moved camera on the screen: the focused pane, else the scene. */
  function screenBox(): { readonly width: number; readonly height: number } | undefined {
    return focused?.box() ?? scene.value?.getBoundingClientRect();
  }

  /** The current camera: the view, else the place, the target and the framed field of view of the room kit. */
  function currentView(): CameraView {
    const current = focused === null ? view.value : focused.view();
    if (current !== null) return current;
    const box = screenBox();
    const aspect = box !== undefined && box.height > 0 ? box.width / box.height : 16 / 9;
    const { kit } = editorRoom();
    const spec = kit.camera;
    return { position: spec.position, target: spec.target, fov: framedFov(spec, kit.safeFrame, aspect) };
  }

  /**
   * The camera at the end of its last move: the view after a drag, a pinch, the wheel or a walk, or a named camera.
   * The frame strip makes the keys of its frames from it. Thus an orbit does not change the keys of the strip at each
   * move.
   */
  const settled = shallowRef<CameraView | null>(view.value);

  /** The end of a move: keep the camera of the focused pane, else this camera. */
  function keepView(): void {
    if (focused === null) keepMain();
    else focused.keep();
  }

  /** Keep the camera in the URL: `camera` for a named camera (none for the overview), else `view`. */
  function keepMain(): void {
    settled.value = view.value;
    const url = new URL(globalThis.location.href);
    url.searchParams.delete("view");
    url.searchParams.delete("camera");
    if (name.value !== null && name.value !== "overview") url.searchParams.set("camera", name.value);
    else if (name.value === null && view.value !== null) url.searchParams.set("view", viewText(view.value));
    globalThis.history.replaceState(globalThis.history.state, "", url);
  }

  /** A free view from a drag, a pinch, the wheel or a walk key. */
  function move(next: CameraView): void {
    if (focused !== null) {
      focused.set(next, null);
      return;
    }
    name.value = null;
    view.value = next;
  }

  /** A named camera from a number key: of the focused pane, else of this camera. */
  function keyCamera(next: CameraName): void {
    if (focused === null) {
      setCamera(next);
      return;
    }
    focused.set(cameraView(next), next);
    focused.keep();
  }

  function setCamera(next: CameraName): void {
    name.value = next;
    view.value = cameraView(next);
    keepMain();
  }

  function setView(next: CameraView | null): void {
    name.value = next === null ? "overview" : null;
    view.value = next;
    keepMain();
  }

  // ---------------------------------------------------------------------------------------------
  // The orbit: a drag or a swipe turns the camera about its target, the wheel or a pinch changes its distance.

  /** The pointers that currently press on the scene, at their last places (CSS pixels). */
  const pressing = new Map<number, { readonly x: number; readonly y: number }>();

  function onDown(event: PointerEvent): void {
    // A press on a control of the scene (the panel button, the dock, the time line, the frame statistics) is a click,
    // not a turn of the camera.
    const controls = "button, a, input, select, label, nav, [data-scene-control]";
    if (event.target instanceof Element && event.target.closest(controls) !== null) return;
    pressing.set(event.pointerId, { x: event.clientX, y: event.clientY });
    scene.value?.setPointerCapture(event.pointerId);
  }

  function onMove(event: PointerEvent): void {
    const last = pressing.get(event.pointerId);
    if (last === undefined) return;
    const next = { x: event.clientX, y: event.clientY };
    const box = screenBox();
    if (pressing.size === 1 && box !== undefined && box.width > 0 && box.height > 0) {
      // A drag to the right moves the camera to the left about the target (the room turns with the pointer).
      const yaw = (-(next.x - last.x) / box.width) * TURN_ACROSS;
      const pitch = ((next.y - last.y) / box.height) * TURN_DOWN;
      move(orbitView(currentView(), yaw, pitch, 1, ROOM_BOUNDS));
    } else if (pressing.size === 2) {
      const other = [...pressing.entries()].find(([id]) => id !== event.pointerId)?.[1];
      if (other !== undefined) {
        const before = Math.hypot(last.x - other.x, last.y - other.y);
        const after = Math.hypot(next.x - other.x, next.y - other.y);
        if (before > 0 && after > 0) move(orbitView(currentView(), 0, 0, before / after, ROOM_BOUNDS));
      }
    }
    pressing.set(event.pointerId, next);
  }

  function onUp(event: PointerEvent): void {
    if (!pressing.delete(event.pointerId)) return;
    if (pressing.size === 0) keepView();
  }

  function onWheel(event: WheelEvent): void {
    move(orbitView(currentView(), 0, 0, Math.exp(event.deltaY * 0.0015), ROOM_BOUNDS));
    keepView();
  }

  // ---------------------------------------------------------------------------------------------
  // The walk keys, the arrow keys and the number keys.

  const walking = new Set<string>();
  let walkFast = false;
  let walkFrame: number | null = null;
  let walkLast = 0;

  function walkStep(now: number): void {
    const seconds = Math.min(WALK_STEP_MAX, (now - walkLast) / 1000);
    walkLast = now;
    let across = 0;
    let along = 0;
    let up = 0;
    let turn = 0;
    let tilt = 0;
    for (const code of walking) {
      const way = WALK_KEYS[code];
      if (way !== undefined) {
        across += way[0];
        along += way[1];
        up += way[2];
      }
      const look = LOOK_KEYS[code];
      if (look !== undefined) {
        turn += look[0];
        tilt += look[1];
      }
    }
    if (turn !== 0 || tilt !== 0) lookStep(turn, tilt, (walkFast ? LOOK_SPEED.fast : LOOK_SPEED.normal) * seconds);
    const current = currentView();
    const [px, py, pz] = current.position;
    const [tx, ty, tz] = current.target;
    // The view direction over the floor, and its right (the camera looks along forward, y up).
    const flat = Math.hypot(tx - px, tz - pz) || 1;
    const forward = [(tx - px) / flat, (tz - pz) / flat] as const;
    const right = [-forward[1], forward[0]] as const;
    const keys = Math.hypot(across, along, up);
    if (keys > 0) {
      const step = (walkFast ? WALK_SPEED.fast : WALK_SPEED.normal) * seconds;
      const clamp = (value: number, axis: 0 | 1 | 2) =>
        Math.min(ROOM_BOUNDS.max[axis], Math.max(ROOM_BOUNDS.min[axis], value));
      const x = clamp(px + ((forward[0] * along + right[0] * across) / keys) * step, 0);
      const y = clamp(py + (up / keys) * step, 1);
      const z = clamp(pz + ((forward[1] * along + right[1] * across) / keys) * step, 2);
      const dx = x - px;
      const dy = y - py;
      const dz = z - pz;
      if (dx !== 0 || dy !== 0 || dz !== 0) {
        move({ position: [x, y, z], target: [tx + dx, ty + dy, tz + dz], fov: current.fov });
      }
    }
    if (walking.size > 0) {
      walkFrame = requestAnimationFrame(walkStep);
      return;
    }
    walkFrame = null;
    keepView();
  }

  /**
   * Turn the camera in place: the target turns about the camera at the same distance, `turn` to the right and `tilt`
   * up (each −1, 0 or 1), by `step` radians.
   */
  function lookStep(turn: number, tilt: number, step: number): void {
    const current = currentView();
    const [px, py, pz] = current.position;
    const [tx, ty, tz] = current.target;
    const distance = Math.hypot(tx - px, ty - py, tz - pz) || 1;
    // The direction of the view: its angle about the vertical (from +z toward +x) and its tilt from the floor.
    const yaw = Math.atan2(tx - px, tz - pz) - turn * step;
    const pitch = Math.min(
      LOOK_TILT_MAX,
      Math.max(-LOOK_TILT_MAX, Math.asin(Math.min(1, Math.max(-1, (ty - py) / distance))) + tilt * step),
    );
    const flat = Math.cos(pitch) * distance;
    move({
      position: current.position,
      target: [px + Math.sin(yaw) * flat, py + Math.sin(pitch) * distance, pz + Math.cos(yaw) * flat],
      fov: current.fov,
    });
  }

  function onKey(event: KeyboardEvent, down: boolean): void {
    walkFast = event.shiftKey;
    const blocked = event.ctrlKey || event.metaKey || event.altKey || typingInto(event.target);
    const number = NUMBER_KEYS.indexOf(event.code);
    if (down && number >= 0 && !blocked && !event.repeat) {
      const named = cameraNames()[number];
      if (named !== undefined && isCameraName(named)) {
        event.preventDefault();
        keyCamera(named);
      }
      return;
    }
    const look = event.code in LOOK_KEYS;
    if (!(event.code in WALK_KEYS) && !look) return;
    if (down && blocked) return;
    if (down && look && arrowsInto(event.target)) return;
    event.preventDefault();
    if (down) walking.add(event.code);
    else walking.delete(event.code);
    if (walking.size > 0 && walkFrame === null) {
      walkLast = performance.now();
      walkFrame = requestAnimationFrame(walkStep);
    }
  }

  const onKeyDown = (event: KeyboardEvent) => {
    onKey(event, true);
  };
  const onKeyUp = (event: KeyboardEvent) => {
    onKey(event, false);
  };
  const stopWalk = () => {
    walking.clear();
  };
  onMounted(() => {
    globalThis.addEventListener("keydown", onKeyDown);
    globalThis.addEventListener("keyup", onKeyUp);
    globalThis.addEventListener("blur", stopWalk);
  });
  onBeforeUnmount(() => {
    globalThis.removeEventListener("keydown", onKeyDown);
    globalThis.removeEventListener("keyup", onKeyUp);
    globalThis.removeEventListener("blur", stopWalk);
    if (walkFrame !== null) cancelAnimationFrame(walkFrame);
  });

  return {
    view,
    name,
    settled,
    setCamera,
    openCamera: keyCamera,
    setView,
    current: currentView,
    openView: (next) => {
      if (focused === null) {
        setView(next);
        return;
      }
      focused.set(next, null);
      focused.keep();
    },
    reset: () => {
      setCamera("overview");
    },
    onDown,
    onMove,
    onUp,
    onWheel,
    focusOn: (target) => {
      // A walk of the camera before the change stops with its camera.
      walking.clear();
      focused = target;
    },
  };
}
