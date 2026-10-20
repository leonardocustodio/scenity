// SPDX-License-Identifier: Apache-2.0
/**
 * The walks in the Scene view. When an actor is selected, the overlay `#scene-walks` draws the route of each of its
 * walks (walkRoutes.ts) on the floor. The number and the start time of the walk show at its stand point. A move of a
 * stand point or of an obstacle (the gizmo, the inspector) shows the new route immediately. The command `walk.add`
 * adds a walk of an actor to a stand point at a time (one step). `__scenity.walkRoutes()` gives the routes of the
 * selected actor to the scripts and the tests. The overlay gets no pointer events.
 */
import { pageKeys } from "../settings/pageKeys";
import { t } from "../../texts";
import { pageView, projectPoint, type ViewSource } from "../dragMath";
import type { ScenePageEditor } from "../sceneEditor";
import { mainViewBox } from "../viewport/mainView";
import { walkRoutes, walksOf, type WalkRoute } from "./walkRoutes";
import "./walks.css";

/** What the walks read of the page. */
export interface WalkParts extends ViewSource {
  readonly canvas: HTMLCanvasElement;
  readonly editor: ScenePageEditor;
  readonly selection: { readonly ids: readonly string[] };
}

/** The height of a route over the floor (m), so the floor does not hide it. */
const LIFT = 0.03;

/** Draw the routes on the overlay. */
function drawRoutes(overlay: HTMLCanvasElement, routes: readonly WalkRoute[], parts: WalkParts): void {
  const box = mainViewBox(parts.canvas);
  const px = (value: number): string => `${String(value)}px`;
  Object.assign(overlay.style, { left: px(box.left), top: px(box.top), width: px(box.width), height: px(box.height) });
  const dpr = globalThis.devicePixelRatio || 1;
  overlay.width = Math.max(1, Math.round(box.width * dpr));
  overlay.height = Math.max(1, Math.round(box.height * dpr));
  const context = overlay.getContext("2d");
  if (context === null) return;
  context.setTransform(dpr, 0, 0, dpr, 0, 0);
  context.clearRect(0, 0, box.width, box.height);
  const view = pageView(parts.editor.posed(), parts);
  if (view === null) return;
  const style = getComputedStyle(overlay);
  context.strokeStyle = style.color;
  context.fillStyle = style.color;
  context.lineWidth = 2;
  context.font = style.font;
  for (const route of routes) {
    context.beginPath();
    route.points.forEach(([x, z], at) => {
      const point = projectPoint(view, [x, LIFT, z], box.width, box.height);
      if (point === null) return;
      if (at === 0) context.moveTo(point.x, point.y);
      else context.lineTo(point.x, point.y);
    });
    context.stroke();
    const end = route.points.at(-1);
    const label = end === undefined ? null : projectPoint(view, [end[0], LIFT, end[1]], box.width, box.height);
    if (label !== null) {
      context.beginPath();
      context.arc(label.x, label.y, 4, 0, Math.PI * 2);
      context.fill();
      context.fillText(
        t("walk-label", { index: route.index + 1, seconds: (route.t / 1000).toFixed(1) }),
        label.x + 6,
        label.y - 6,
      );
    }
  }
}

/** The script API of the walks. */
export interface WalksApi {
  /** The routes of the walks of the selected actor. */
  walkRoutes(): readonly WalkRoute[];
}

/** Start the walks of the Scene view. The result gives the routes of the selected actor. */
export function startWalks(parts: WalkParts): WalksApi {
  const overlay = document.createElement("canvas");
  overlay.id = "scene-walks";
  overlay.dataset.testid = "scene-walks";
  overlay.setAttribute("aria-hidden", "true");
  parts.canvas.after(overlay);
  const routes = (): WalkRoute[] => {
    const id = parts.selection.ids[0];
    return id === undefined || parts.editor.play.active ? [] : walkRoutes(parts.editor.posed(), id);
  };
  let last = "";
  const step = (): void => {
    const now = routes();
    const box = mainViewBox(parts.canvas);
    const key = JSON.stringify([now, box, pageView(parts.editor.posed(), parts)]);
    if (key !== last) {
      last = key;
      overlay.dataset.routes = String(now.length);
      drawRoutes(overlay, now, parts);
    }
    requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
  pageKeys().register([
    {
      id: "walk.add",
      menu: "entity",
      title: t("walk-add-title"),
      agents: true,
      args: {
        to: { type: "string", description: t("walk-arg-to") },
        t: { type: "number", description: t("walk-arg-t") },
        entity: { type: "string", description: t("walk-arg-entity"), optional: true },
      },
      run: async (args) => {
        const actor = typeof args.entity === "string" && args.entity !== "" ? args.entity : parts.selection.ids[0];
        const to = typeof args.to === "string" ? args.to.replace(/^entity:/, "") : "";
        if (actor === undefined || to === "") throw new Error(t("walk-none"));
        const time = typeof args.t === "number" ? Math.max(0, Math.round(args.t)) : 0;
        const doc = parts.editor.doc;
        const walks = [
          ...walksOf(doc, actor).map((walk) => ({ t: walk.t, to: `entity:${walk.to}` })),
          { t: time, to: `entity:${to}` },
        ];
        walks.sort((a, b) => a.t - b.t);
        const has = doc.entities[actor]?.components.locomotion !== undefined;
        const command = has ? "component.set" : "component.add";
        const value = JSON.stringify(has ? walks : { walks });
        await pageKeys().execute(command, {
          entity: actor,
          component: "locomotion",
          ...(has ? { field: "walks" } : {}),
          value,
        });
      },
    },
  ]);
  return { walkRoutes: routes };
}
