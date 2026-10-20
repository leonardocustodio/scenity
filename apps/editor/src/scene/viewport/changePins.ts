// SPDX-License-Identifier: Apache-2.0
/**
 * The marks of the changes of the agents in the Scene view. Each entity of a change set that waits gets a pin at its
 * place, in the colour of the session. The pin shows ＋ (added), ~ (changed or moved) or − (removed), so the colour is
 * never the only cue. An added or moved entity has its pin at the new place. A moved entity also has a line from its
 * old place. A click selects the entity. The pins are HTML over the canvas, as the icons of the lights
 * (viewIcons.ts). They never go into a frame of the core.
 */
import type { ComponentRegistry } from "@scenity/scene";
import type { SceneDocument } from "@scenity/scene/schema/documents";
import { qrotate, vadd } from "@scenity/scene/math";
import { worldTransform } from "@scenity/scene/world";
import type { AgentPresence } from "../agent/presence";
import { t } from "../../texts";
import { actorColour } from "../actorColour";
import { projectPoint, type CameraView } from "../dragMath";
import { placePart } from "../pageParts";
import { CAMERA_SHOW_MS } from "../agent/presence";
import { proposedDoc, reviewSet } from "../review/reviewModel";
import type { ReviewState } from "../review/reviewState";

const SVG = "http://www.w3.org/2000/svg";
/** The size of a pin (CSS pixels). */
const PIN_PX = 18;
const MARKS = { added: "＋", removed: "−", changed: "~", moved: "~", working: "…" } as const;

/** A pin on the canvas (CSS pixels from the top left corner of the canvas). */
export interface ChangePin {
  readonly id: string;
  /** "working" for an entity that a turn changes while it runs. */
  readonly change: keyof typeof MARKS;
  readonly colour: string;
  readonly name: string;
  readonly x: number;
  readonly y: number;
  /** The old place of a moved entity, or null. */
  readonly from: { readonly x: number; readonly y: number } | null;
}

/** The pins of the change sets on a canvas of `width` × `height` CSS pixels. */
export function changePins(
  review: Pick<ReviewState, "sets">,
  doc: SceneDocument,
  registry: ComponentRegistry,
  view: CameraView,
  size: { readonly width: number; readonly height: number },
): ChangePin[] {
  const pins: ChangePin[] = [];
  const project = (at: SceneDocument, id: string) => {
    const world = worldTransform(at, id);
    const point = world === undefined ? null : projectPoint(view, world.position, size.width, size.height);
    return point === null || point.x < 0 || point.y < 0 || point.x > size.width || point.y > size.height
      ? null
      : { x: Math.round(point.x * 10) / 10, y: Math.round(point.y * 10) / 10 };
  };
  for (const set of review.sets.value) {
    const after = proposedDoc(doc, set, registry) ?? doc;
    for (const row of reviewSet(set, doc).rows) {
      if (row.entity === null) continue;
      const old = row.change === "added" ? null : project(doc, row.entity);
      const now = row.change === "removed" ? old : project(after, row.entity);
      if (now === null) continue;
      const moved = old !== null && (old.x !== now.x || old.y !== now.y);
      const change = moved && row.change === "changed" ? "moved" : row.change;
      pins.push({
        id: row.entity,
        change,
        colour: actorColour(set.actor),
        name: row.name,
        ...now,
        from: moved ? old : null,
      });
    }
  }
  return pins;
}

/** The camera of a frame of an agent as a triangle on the canvas (the eye and the two sides of its view). */
export interface AgentFrustum {
  readonly session: string;
  readonly colour: string;
  readonly eye: { readonly x: number; readonly y: number };
  readonly left: { readonly x: number; readonly y: number };
  readonly right: { readonly x: number; readonly y: number };
}

/** The length of the drawn view of an agent camera (metres). */
const FRUSTUM_M = 1.5;

/**
 * The pins of the entities that a turn changes while it runs ("…" in the colour of its session). An entity with a
 * change pin keeps that pin. The result also has the camera of the last frame of each session for `CAMERA_SHOW_MS`.
 */
export function presencePins(
  presences: Iterable<AgentPresence>,
  doc: SceneDocument,
  view: CameraView,
  size: { readonly width: number; readonly height: number },
  now = Date.now(),
): { readonly pins: ChangePin[]; readonly frustums: AgentFrustum[] } {
  const project = (point: readonly [number, number, number]) => projectPoint(view, [...point], size.width, size.height);
  const pins: ChangePin[] = [];
  const frustums: AgentFrustum[] = [];
  for (const presence of presences) {
    const colour = actorColour(presence.session);
    for (const id of presence.running ? presence.entities : []) {
      const world = worldTransform(doc, id);
      const point = world === undefined ? null : project(world.position);
      if (point === null) continue;
      const name = doc.entities[id]?.name ?? id;
      pins.push({ id, change: "working", colour, name, x: point.x, y: point.y, from: null });
    }
    const camera = presence.camera === null ? undefined : worldTransform(doc, presence.camera);
    if (camera === undefined || presence.cameraAt === null || now - presence.cameraAt > CAMERA_SHOW_MS) continue;
    const ahead = (side: number) =>
      vadd(camera.position, qrotate(camera.rotation, [side * FRUSTUM_M * 0.6, 0, -FRUSTUM_M]));
    const [eye, left, right] = [project(camera.position), project(ahead(-1)), project(ahead(1))];
    if (eye !== null && left !== null && right !== null)
      frustums.push({ session: presence.session.id, colour, eye, left, right });
  }
  return { pins, frustums };
}

/** The layer of the pins over the canvas. */
export class PinLayer {
  readonly root = document.createElement("div");
  readonly #lines = document.createElementNS(SVG, "svg");
  readonly #buttons = new Map<string, HTMLButtonElement>();

  constructor(private readonly select: (id: string) => void) {
    this.root.id = "scene-change-pins";
    this.root.dataset.testid = "scene-change-pins";
    this.#lines.setAttribute("aria-hidden", "true");
    this.root.append(this.#lines);
    placePart(this.root, "view");
  }

  /** Place the layer over the canvas box and show the pins and the frustums of the agent cameras. */
  show(box: DOMRect, pins: readonly ChangePin[], frustums: readonly AgentFrustum[] = []): void {
    const px = (value: number): string => `${String(value)}px`;
    Object.assign(this.root.style, {
      left: px(box.left),
      top: px(box.top),
      width: px(box.width),
      height: px(box.height),
    });
    this.#lines.replaceChildren();
    for (const frustum of frustums) this.#frustum(frustum);
    const shown = new Set<string>();
    for (const pin of pins) {
      shown.add(pin.id);
      if (pin.from !== null) this.#line(pin);
      const button = this.#button(pin.id);
      button.dataset.change = pin.change;
      button.textContent = MARKS[pin.change];
      const title = t("viewport-change-pin", { name: pin.name, change: t(`review-change-${pin.change}`) });
      if (button.title !== title) {
        button.title = title;
        button.setAttribute("aria-label", title);
      }
      Object.assign(button.style, {
        left: px(pin.x - PIN_PX / 2),
        top: px(pin.y - PIN_PX / 2),
        borderColor: pin.colour,
        color: pin.colour,
      });
    }
    for (const [id, button] of this.#buttons) {
      if (shown.has(id)) continue;
      button.remove();
      this.#buttons.delete(id);
    }
  }

  #button(id: string): HTMLButtonElement {
    const found = this.#buttons.get(id);
    if (found !== undefined) return found;
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.testid = `scene-change-${id}`;
    button.addEventListener("click", () => {
      this.select(id);
    });
    this.root.append(button);
    this.#buttons.set(id, button);
    return button;
  }

  #frustum(frustum: AgentFrustum): void {
    const shape = document.createElementNS(SVG, "polygon");
    const points = [frustum.eye, frustum.left, frustum.right].map((point) => `${String(point.x)},${String(point.y)}`);
    shape.setAttribute("points", points.join(" "));
    shape.setAttribute("stroke", frustum.colour);
    shape.setAttribute("fill", "none");
    shape.dataset.testid = `scene-agent-camera-${frustum.session}`;
    this.#lines.append(shape);
  }

  #line(pin: ChangePin): void {
    if (pin.from === null) return;
    const line = document.createElementNS(SVG, "line");
    line.setAttribute("x1", String(pin.from.x));
    line.setAttribute("y1", String(pin.from.y));
    line.setAttribute("x2", String(pin.x));
    line.setAttribute("y2", String(pin.y));
    line.setAttribute("stroke", pin.colour);
    this.#lines.append(line);
  }
}
