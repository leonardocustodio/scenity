// SPDX-License-Identifier: Apache-2.0
/**
 * The overlays of the Scene view: small panels over the canvas that dock to its four edges and fold. Each overlay has
 * a head. Its title folds it, and its menu docks it to a different edge or hides it. A drag of the head to an edge
 * docks it there. The overlay menu (the backtick key, `overlay.menu`) shows and hides each overlay. The places (edge,
 * order, fold, hidden) go into the state of the Scene view panel. Thus the layout of the editor window keeps them
 * after a restart.
 */
import { shallowRef } from "vue";
import { t } from "../../texts";

export const OVERLAY_EDGES = ["top", "right", "bottom", "left"] as const;
export type OverlayEdge = (typeof OVERLAY_EDGES)[number];

/** The place of an overlay. */
export interface OverlayPlace {
  readonly edge: OverlayEdge;
  readonly order: number;
  readonly folded: boolean;
  readonly hidden: boolean;
}

/** An overlay: its ID, its title, its default place and its content. */
export interface OverlaySpec {
  readonly id: string;
  title(): string;
  readonly edge: OverlayEdge;
  readonly order: number;
  readonly content: HTMLElement;
  readonly hidden?: boolean;
}

/** The saved places of a state value (without the bad entries). */
export function readPlaces(value: unknown): Record<string, OverlayPlace> {
  if (typeof value !== "object" || value === null) return {};
  const out: Record<string, OverlayPlace> = {};
  for (const [id, raw] of Object.entries(value as Record<string, unknown>)) {
    if (typeof raw !== "object" || raw === null) continue;
    const place = raw as Record<string, unknown>;
    const edge = OVERLAY_EDGES.find((item) => item === place.edge);
    if (edge === undefined || typeof place.order !== "number") continue;
    out[id] = { edge, order: place.order, folded: place.folded === true, hidden: place.hidden === true };
  }
  return out;
}

/** The edge of a box that is nearest to a point. */
export function nearestEdge(
  box: { readonly left: number; readonly top: number; readonly width: number; readonly height: number },
  x: number,
  y: number,
): OverlayEdge {
  const gaps: [OverlayEdge, number][] = [
    ["top", y - box.top],
    ["right", box.left + box.width - x],
    ["bottom", box.top + box.height - y],
    ["left", x - box.left],
  ];
  return gaps.reduce((best, gap) => (gap[1] < best[1] ? gap : best))[0];
}

/** One overlay in the dock. */
interface Item {
  readonly spec: OverlaySpec;
  readonly element: HTMLElement;
  readonly fold: HTMLButtonElement;
}

function button(text: string, testid: string, click: () => void): HTMLButtonElement {
  const node = document.createElement("button");
  node.type = "button";
  node.textContent = text;
  node.dataset.testid = testid;
  node.addEventListener("click", click);
  return node;
}

/** The overlays of one Scene view. */
export class OverlayDock {
  readonly root: HTMLElement;
  readonly #edges: Record<OverlayEdge, HTMLElement>;
  readonly #items = new Map<string, Item>();
  #places: Record<string, OverlayPlace> = {};
  readonly #listeners = new Set<(places: Record<string, OverlayPlace>) => void>();
  #menu: HTMLElement | null = null;
  /** The layer of the menus: over each part of the view (the layout tools, the panels of the page). */
  readonly #menus: HTMLElement;

  constructor(parent: HTMLElement) {
    this.root = document.createElement("div");
    this.root.id = "scene-overlays";
    this.root.dataset.testid = "scene-overlays";
    const edge = (name: OverlayEdge): HTMLElement => {
      const node = document.createElement("div");
      node.className = "scene-overlay-edge";
      node.dataset.edge = name;
      this.root.append(node);
      return node;
    };
    this.#edges = { top: edge("top"), right: edge("right"), bottom: edge("bottom"), left: edge("left") };
    this.#menus = document.createElement("div");
    this.#menus.id = "scene-overlay-menus";
    parent.append(this.root, this.#menus);
  }

  /** Add an overlay. The result removes it. */
  add(spec: OverlaySpec): () => void {
    const element = document.createElement("section");
    element.className = "scene-overlay";
    element.dataset.overlay = spec.id;
    element.dataset.testid = `overlay-${spec.id}`;
    element.setAttribute("aria-label", spec.title());
    const head = document.createElement("header");
    const fold = button(spec.title(), `overlay-${spec.id}-fold`, () => {
      this.set(spec.id, { folded: !this.place(spec.id).folded });
    });
    fold.className = "scene-overlay-title";
    const more = button("⋯", `overlay-${spec.id}-menu`, () => this.#placeMenu(spec.id, more));
    more.title = t("overlay-menu-of", { name: spec.title() });
    more.setAttribute("aria-haspopup", "menu");
    head.append(fold, more);
    this.#drag(spec.id, head);
    const body = document.createElement("div");
    body.className = "scene-overlay-body";
    body.append(spec.content);
    element.append(head, body);
    this.#items.set(spec.id, { spec, element, fold });
    this.#layout();
    return () => {
      this.#items.delete(spec.id);
      element.remove();
    };
  }

  /** The content of an overlay, or null. */
  content(id: string): HTMLElement | null {
    return this.#items.get(id)?.spec.content ?? null;
  }

  /** The current place of an overlay (the saved place, else its default). */
  place(id: string): OverlayPlace {
    const saved = this.#places[id];
    if (saved !== undefined) return saved;
    const spec = this.#items.get(id)?.spec;
    return { edge: spec?.edge ?? "top", order: spec?.order ?? 0, folded: false, hidden: spec?.hidden === true };
  }

  /** Change the place of an overlay. */
  set(id: string, patch: Partial<OverlayPlace>): void {
    const now = this.place(id);
    // An overlay that goes to another edge goes after the overlays there.
    const moved = patch.edge !== undefined && patch.edge !== now.edge && patch.order === undefined;
    const order = moved ? this.#lastOrder(patch.edge ?? now.edge) + 1 : (patch.order ?? now.order);
    this.#places = { ...this.#places, [id]: { ...now, ...patch, order } };
    this.#layout();
    for (const listener of this.#listeners) listener(this.saved());
  }

  /** Take the saved places (the state of the panel), with no change event. */
  load(value: unknown): void {
    this.#places = { ...this.#places, ...readPlaces(value) };
    this.#layout();
  }

  /** The places to save. */
  saved(): Record<string, OverlayPlace> {
    return { ...this.#places };
  }

  onChange(listener: (places: Record<string, OverlayPlace>) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  /** The overlays with their titles and places. */
  list(): { readonly id: string; readonly title: string; readonly place: OverlayPlace }[] {
    return [...this.#items.values()].map((item) => ({
      id: item.spec.id,
      title: item.spec.title(),
      place: this.place(item.spec.id),
    }));
  }

  /** The overlay menu: a check for each overlay (shown or hidden). Escape or a second press closes it. */
  toggleMenu(): void {
    if (this.#closeMenu()) return;
    const menu = this.#popup("scene-overlay-menu", t("overlay-menu"));
    for (const item of this.list()) {
      const entry = button(item.title, `overlay-menu-${item.id}`, () => {
        this.set(item.id, { hidden: !this.place(item.id).hidden });
        entry.setAttribute("aria-checked", String(!this.place(item.id).hidden));
      });
      entry.setAttribute("role", "menuitemcheckbox");
      entry.setAttribute("aria-checked", String(!item.place.hidden));
      menu.append(entry);
    }
    this.#menus.append(menu);
    menu.querySelector("button")?.focus();
  }

  #lastOrder(edge: OverlayEdge): number {
    const orders = [...this.#items.keys()].map((id) => this.place(id)).filter((place) => place.edge === edge);
    return orders.reduce((most, place) => Math.max(most, place.order), -1);
  }

  /** Put each overlay at its edge in its order, folded or hidden. */
  #layout(): void {
    const items = [...this.#items.values()].sort((a, b) => this.place(a.spec.id).order - this.place(b.spec.id).order);
    for (const item of items) {
      const place = this.place(item.spec.id);
      this.#edges[place.edge].append(item.element);
      item.element.hidden = place.hidden;
      item.element.dataset.edge = place.edge;
      item.element.toggleAttribute("data-folded", place.folded);
      item.fold.setAttribute("aria-expanded", String(!place.folded));
    }
  }

  /** The menu of one overlay: fold, dock to another edge, hide. */
  #placeMenu(id: string, from: HTMLElement): void {
    if (this.#closeMenu()) return;
    const place = this.place(id);
    const menu = this.#popup(
      "scene-overlay-place",
      t("overlay-menu-of", { name: this.#items.get(id)?.spec.title() ?? id }),
    );
    const act = (text: string, testid: string, patch: Partial<OverlayPlace>): void => {
      const entry = button(text, testid, () => {
        this.#closeMenu();
        this.set(id, patch);
      });
      entry.setAttribute("role", "menuitem");
      menu.append(entry);
    };
    act(place.folded ? t("overlay-unfold") : t("overlay-fold"), `overlay-${id}-toggle`, { folded: !place.folded });
    for (const edge of OVERLAY_EDGES) {
      if (edge !== place.edge) act(t(`overlay-dock-${edge}`), `overlay-${id}-dock-${edge}`, { edge });
    }
    act(t("overlay-hide"), `overlay-${id}-hide`, { hidden: true });
    this.#menus.append(menu);
    // The menu opens under its button, at the right edge of the button.
    const box = from.getBoundingClientRect();
    const layer = this.#menus.getBoundingClientRect();
    menu.style.top = `${String(box.bottom - layer.top)}px`;
    menu.style.right = `${String(layer.right - box.right)}px`;
    menu.style.left = "auto";
    menu.querySelector("button")?.focus();
  }

  #popup(testid: string, label: string): HTMLElement {
    const menu = document.createElement("div");
    menu.className = "scene-overlay-popup";
    menu.dataset.testid = testid;
    menu.setAttribute("role", "menu");
    menu.setAttribute("aria-label", label);
    menu.addEventListener("keydown", (event) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      this.#closeMenu();
    });
    this.#menu = menu;
    return menu;
  }

  /** Close the open menu. The result is true when a menu was open. */
  #closeMenu(): boolean {
    const open = this.#menu;
    this.#menu = null;
    open?.remove();
    return open !== null;
  }

  /** A drag of the head of an overlay docks it to the edge that is nearest to the pointer at the drop. */
  #drag(id: string, head: HTMLElement): void {
    head.addEventListener("pointerdown", (down) => {
      if (down.button !== 0 || (down.target as HTMLElement).closest("button") !== null) return;
      head.setPointerCapture(down.pointerId);
      const up = (event: PointerEvent): void => {
        head.removeEventListener("pointerup", up);
        if (Math.hypot(event.clientX - down.clientX, event.clientY - down.clientY) < 8) return;
        const edge = nearestEdge(this.root.getBoundingClientRect(), event.clientX, event.clientY);
        if (edge !== this.place(id).edge) this.set(id, { edge });
      };
      head.addEventListener("pointerup", up);
    });
  }
}

/** The overlays of the Scene view of the page, in a reactive cell (the Scene view panel keeps their places). */
const current = shallowRef<OverlayDock | null>(null);

/** The overlays of the page, or null before the viewport starts. */
export function pageOverlays(): OverlayDock | null {
  return current.value;
}

export function setPageOverlays(dock: OverlayDock | null): void {
  current.value = dock;
}
