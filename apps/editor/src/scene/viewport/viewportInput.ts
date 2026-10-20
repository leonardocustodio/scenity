// SPDX-License-Identifier: Apache-2.0
/**
 * The pointer and the keys of the editor camera, with the camera keys of the lab where they fit the scene page:
 *
 * - A drag of the left button that starts on no movable entity turns the camera about its target (orbit). With Shift,
 *   it pans. A drag on a movable entity stays the entity drag, and a handle of a gizmo gets its press first. The orbit
 *   starts after a move of 4 px, so a click still selects.
 * - A drag of the middle button pans. The wheel moves the camera nearer or farther.
 * - A drag of the right button turns the view in place (fly). While the right button is down, W, A, S and D move the
 *   camera along and across the view, and Q and E move it down and up (Shift: faster). At all other times, W, E and R
 *   choose the gizmo mode. The gizmo ignores the keys while the canvas has `data-fly`.
 * - The arrow keys turn the view in place.
 *
 * The speeds come from the editor settings (settings/pageSettings.ts): the fly speed, the turn speed of the arrow
 * keys, and the factors of the orbit and of the wheel. F (frame) and the keys 0 to 9 (the cameras) are page commands
 * of the key map (startViewport.ts). The fly keys and the arrow keys stay here. They move the camera while they are
 * down, so they are not commands of one press.
 */
import { chordOfEvent, dolly, fly, look, orbit, pan } from "@scenity/editor-core";
import { typingInto } from "../../core/labUi";
import { messageIdOf, t } from "../../texts";
import { pageKeys, SCENE_CONTEXT, type PageKeyCommandSpec } from "../settings/pageKeys";
import { pageSettings } from "../settings/pageSettings";
import type { ViewportCamera } from "./viewportCamera";
import { mainViewBox } from "./mainView";

/** A drag turns the camera by a quarter turn across the width of the canvas and an eighth across its height (lab). */
const TURN_ACROSS = Math.PI / 2;
const TURN_DOWN = Math.PI / 4;
/** The turn of the view in place for each CSS pixel of a drag of the right button (radians). */
const LOOK_PER_PX = 0.004;
/** The move of the pointer that starts an orbit or a pan of the left button (CSS pixels). */
const DRAG_START = 4;
/** The wheel factor of the distance for each wheel unit, and the wait before the wheel move stops (ms). */
const WHEEL_SCALE = 0.0015;
const WHEEL_SETTLE = 200;
/**
 * The held keys of the camera are entries of the key map, so a person can change them. The fly keys (across, along,
 * up; lab WALK_KEYS) are in the context `fly` (the right button is down). The look keys (turn, tilt; lab LOOK_KEYS)
 * are in the scene context. The speeds are editor settings (metres per second, radians per second).
 */
const FLY_KEYS: Readonly<Record<string, { key: string; way: readonly [number, number, number] }>> = {
  "camera.fly.forward": { key: "W", way: [0, 1, 0] },
  "camera.fly.back": { key: "S", way: [0, -1, 0] },
  "camera.fly.left": { key: "A", way: [-1, 0, 0] },
  "camera.fly.right": { key: "D", way: [1, 0, 0] },
  "camera.fly.down": { key: "Q", way: [0, 0, -1] },
  "camera.fly.up": { key: "E", way: [0, 0, 1] },
};
const LOOK_KEYS: Readonly<Record<string, { key: string; turn: readonly [number, number] }>> = {
  "camera.look.left": { key: "ArrowLeft", turn: [-1, 0] },
  "camera.look.right": { key: "ArrowRight", turn: [1, 0] },
  "camera.look.up": { key: "ArrowUp", turn: [0, 1] },
  "camera.look.down": { key: "ArrowDown", turn: [0, -1] },
};
/** The context of the fly keys in the key map. */
export const FLY_CONTEXT = "fly";

/** The held keys as entries of the key map. */
export function heldKeyCommands(): PageKeyCommandSpec[] {
  const fly = Object.entries(FLY_KEYS).map(([id, item]) => ({ id, key: item.key, context: FLY_CONTEXT }));
  const turn = Object.entries(LOOK_KEYS).map(([id, item]) => ({ id, key: item.key, context: SCENE_CONTEXT }));
  return [...fly, ...turn].map(({ id, key, context }) => ({
    id,
    title: t(messageIdOf("viewport-held", id)),
    keys: [key],
    keyContext: context,
    keyKind: "held" as const,
    run: () => undefined,
  }));
}

/** The current command of a held key (the key map of the person), or undefined. */
function heldCommand(event: KeyboardEvent, ids: readonly string[]): string | undefined {
  const chord = chordOfEvent({
    key: event.key,
    code: event.code,
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
  });
  if (chord === null) return undefined;
  const map = pageKeys().keyMap();
  return ids.find((id) => map.keysOf(id).includes(chord));
}
/** The longest time step of one frame of a key move (seconds). */
const STEP_MAX = 0.1;

/** What the input reads of the page. */
export interface InputParts {
  readonly canvas: HTMLCanvasElement;
  readonly camera: ViewportCamera;
  /** True while an edit drag of the page runs (the entity drag, a gizmo drag). */
  live(): boolean;
}

type DragKind = "orbit" | "pan" | "look";

/** A press of a pointer on the canvas and the drag that it gives (null until it starts). */
interface Press {
  readonly pointer: number;
  readonly button: number;
  readonly shift: boolean;
  readonly start: { readonly x: number; readonly y: number };
  last: { x: number; y: number };
  kind: DragKind | null;
}

/** True when a key must go to the page and not to the camera: a field, a control of a panel, a modifier. */
function notForCamera(event: KeyboardEvent, canvas: HTMLCanvasElement): boolean {
  if (event.metaKey || event.ctrlKey || event.altKey || event.defaultPrevented || typingInto(event.target)) return true;
  // A press on the canvas gives the focus to the container of the Scene view panel, which holds the canvas.
  const target = event.target;
  return !(
    target === document.body ||
    target instanceof HTMLCanvasElement ||
    (target instanceof Element && target.contains(canvas))
  );
}

/** The pointer of the editor camera on the canvas. */
function listenPointer(parts: InputParts, fly: { on: boolean }): void {
  const { canvas, camera } = parts;
  let press: Press | null = null;
  const begin = (current: Press, kind: DragKind): void => {
    current.kind = kind;
    canvas.dataset.orbit = kind;
    if (kind === "look") canvas.dataset.fly = "1";
    canvas.setPointerCapture(current.pointer);
  };
  canvas.addEventListener("pointerdown", (event) => {
    if (press !== null || parts.live()) return;
    const at = { x: event.clientX, y: event.clientY };
    press = { pointer: event.pointerId, button: event.button, shift: event.shiftKey, start: at, last: at, kind: null };
    if (event.button === 1) begin(press, "pan");
    if (event.button === 2) begin(press, "look");
    fly.on = event.button === 2;
    if (event.button !== 0) event.preventDefault();
  });
  canvas.addEventListener("pointermove", (event) => {
    const current = press;
    if (current?.pointer !== event.pointerId) return;
    const at = { x: event.clientX, y: event.clientY };
    if (current.kind === null) {
      const data = canvas.dataset;
      const free = data.drag === undefined && data.press === undefined && data.gizmoDrag === undefined;
      const far = Math.hypot(at.x - current.start.x, at.y - current.start.y) > DRAG_START;
      if (!far || !free || parts.live()) return;
      begin(current, current.shift ? "pan" : "orbit");
    }
    const [dx, dy] = [at.x - current.last.x, at.y - current.last.y];
    current.last = at;
    const box = mainViewBox(canvas);
    const width = Math.max(1, box.width);
    const height = Math.max(1, box.height);
    const factor = pageSettings().value.camera.orbitSpeed;
    if (current.kind === "orbit")
      camera.change((each) => orbit(each, (dx / width) * TURN_ACROSS * factor, -(dy / height) * TURN_DOWN * factor));
    else if (current.kind === "pan") camera.change((each) => pan(each, dx, dy, height));
    else camera.change((each) => look(each, dx * LOOK_PER_PX, -dy * LOOK_PER_PX));
  });
  const end = (event: PointerEvent): void => {
    if (press?.pointer !== event.pointerId) return;
    press = null;
    fly.on = false;
    delete canvas.dataset.orbit;
    delete canvas.dataset.fly;
    camera.settle();
  };
  canvas.addEventListener("pointerup", end);
  canvas.addEventListener("pointercancel", end);
  canvas.addEventListener("contextmenu", (event) => {
    event.preventDefault();
  });
  let wheelTimer: ReturnType<typeof setTimeout> | null = null;
  canvas.addEventListener(
    "wheel",
    (event) => {
      event.preventDefault();
      const scale = WHEEL_SCALE * pageSettings().value.camera.zoomSpeed;
      camera.change((each) => dolly(each, Math.exp(event.deltaY * scale)));
      if (wheelTimer !== null) clearTimeout(wheelTimer);
      wheelTimer = setTimeout(() => {
        camera.settle();
      }, WHEEL_SETTLE);
    },
    { passive: false },
  );
}

/** The keys that move the camera each frame while they are down: the fly keys and the arrow keys. */
function listenHeldKeys(parts: InputParts, held: Map<string, string>, flying: { on: boolean }): void {
  let frame: number | null = null;
  let last = 0;
  let fast = false;
  const step = (now: number): void => {
    const seconds = Math.min(STEP_MAX, (now - last) / 1000);
    last = now;
    const way = [0, 0, 0];
    const turn = [0, 0];
    for (const id of held.values()) {
      const flyWay = flying.on ? FLY_KEYS[id]?.way : undefined;
      flyWay?.forEach((value, axis) => (way[axis] = (way[axis] ?? 0) + value));
      LOOK_KEYS[id]?.turn.forEach((value, axis) => (turn[axis] = (turn[axis] ?? 0) + value));
    }
    const speeds = pageSettings().value.camera;
    const speed = fast ? speeds.flyFastSpeed : speeds.flySpeed;
    const turnSpeed = (fast ? speeds.lookFastSpeed : speeds.lookSpeed) * seconds;
    const metres = speed * seconds;
    parts.camera.change((each) =>
      look(
        fly(each, (way[0] ?? 0) * metres, (way[1] ?? 0) * metres, (way[2] ?? 0) * metres),
        (turn[0] ?? 0) * turnSpeed,
        (turn[1] ?? 0) * turnSpeed,
      ),
    );
    frame = held.size > 0 ? requestAnimationFrame(step) : null;
    if (frame === null) parts.camera.settle();
  };
  window.addEventListener("keydown", (event) => {
    const id = heldCommand(event, [...(flying.on ? Object.keys(FLY_KEYS) : []), ...Object.keys(LOOK_KEYS)]);
    if (id === undefined || notForCamera(event, parts.canvas)) return;
    event.preventDefault();
    fast = event.shiftKey;
    held.set(event.code, id);
    if (frame !== null) return;
    last = performance.now();
    frame = requestAnimationFrame(step);
  });
  window.addEventListener("keyup", (event) => {
    held.delete(event.code);
    fast = event.shiftKey;
  });
  window.addEventListener("blur", () => {
    held.clear();
  });
}

/** Listen to the pointer and the keys of the editor camera. */
export function listenViewportInput(parts: InputParts): void {
  const flying = { on: false };
  listenPointer(parts, flying);
  pageKeys().register(heldKeyCommands());
  listenHeldKeys(parts, new Map(), flying);
}
