// SPDX-License-Identifier: Apache-2.0
/**
 * The place of a floating panel of the lab (the cards of the selection, the layout status and the proposals). The
 * owner drags the panel by its grip to another part of the screen, so it does not cover the scene. The offset from the
 * corner of the panel is a setting of this browser (localStorage), not an input of the scene. A double click on the
 * grip returns the panel to its corner.
 */
import { computed, ref, type ComputedRef, type Ref } from "vue";
import { storageItem } from "@scenity/labs-platform/storageKeys";

export interface PanelOffset {
  readonly x: number;
  readonly y: number;
}

export interface PanelPlace {
  readonly offset: Ref<PanelOffset>;
  /** The CSS of the panel: a translation by the offset. */
  readonly style: ComputedRef<{ transform: string }>;
  /** True while the owner drags the panel. */
  readonly moving: Ref<boolean>;
  grab(event: PointerEvent): void;
  move(event: PointerEvent): void;
  drop(event: PointerEvent): void;
  reset(): void;
  /** The keys of the grip: the arrows move the panel by 20 px (Shift: 80 px), and Home returns it to its corner. */
  key(event: KeyboardEvent): void;
}

/** The step of an arrow key on the grip (CSS pixels). Shift gives four steps. */
const KEY_STEP = 20;

/** The part of the panel that stays on the screen (CSS pixels), so the owner can always grab it again. */
const KEEP = 96;

function readOffset(key: string): PanelOffset {
  try {
    const value = JSON.parse(storageItem(globalThis.localStorage, key) ?? "null") as Partial<PanelOffset> | null;
    if (typeof value?.x === "number" && typeof value.y === "number") return { x: value.x, y: value.y };
  } catch {
    // A browser without storage, or an incorrect value: the panel stays at its corner.
  }
  return { x: 0, y: 0 };
}

function writeOffset(key: string, offset: PanelOffset): void {
  try {
    globalThis.localStorage.setItem(key, JSON.stringify(offset));
  } catch {
    // A browser without storage: the place stays until the page closes.
  }
}

/**
 * Keep the offset of a panel at the top right corner in the window. The panel can move left and down, and a part of
 * KEEP pixels stays on the screen.
 */
export function clampOffset(offset: PanelOffset, width: number, height: number): PanelOffset {
  return {
    x: Math.round(Math.min(0, Math.max(-(width - KEEP), offset.x))),
    y: Math.round(Math.min(height - KEEP, Math.max(-40, offset.y))),
  };
}

/** The place of the panel with the storage key `key`. */
export function usePanelPlace(key: string): PanelPlace {
  const offset = ref<PanelOffset>(readOffset(key));
  const moving = ref(false);
  let start: { readonly x: number; readonly y: number; readonly from: PanelOffset } | null = null;
  const size = (): { width: number; height: number } => ({
    width: globalThis.innerWidth || 1280,
    height: globalThis.innerHeight || 800,
  });
  return {
    offset,
    moving,
    style: computed(() => ({ transform: `translate(${String(offset.value.x)}px, ${String(offset.value.y)}px)` })),
    grab(event) {
      // A press on a button of the grip (the fold, the clear) is not a drag.
      if (event.button !== 0 || (event.target as Element | null)?.closest("button") != null) return;
      event.preventDefault();
      (event.currentTarget as Element | null)?.setPointerCapture(event.pointerId);
      start = { x: event.clientX, y: event.clientY, from: offset.value };
      moving.value = true;
    },
    move(event) {
      if (start === null) return;
      const next = { x: start.from.x + event.clientX - start.x, y: start.from.y + event.clientY - start.y };
      const { width, height } = size();
      offset.value = clampOffset(next, width, height);
    },
    drop() {
      if (start === null) return;
      start = null;
      moving.value = false;
      writeOffset(key, offset.value);
    },
    reset() {
      offset.value = { x: 0, y: 0 };
      writeOffset(key, offset.value);
    },
    key(event) {
      const step = event.shiftKey ? KEY_STEP * 4 : KEY_STEP;
      const moves: Readonly<Record<string, readonly [number, number]>> = {
        ArrowLeft: [-step, 0],
        ArrowRight: [step, 0],
        ArrowUp: [0, -step],
        ArrowDown: [0, step],
      };
      const by = moves[event.key];
      if (event.key === "Home") {
        offset.value = { x: 0, y: 0 };
      } else if (by !== undefined) {
        const { width, height } = size();
        offset.value = clampOffset({ x: offset.value.x + by[0], y: offset.value.y + by[1] }, width, height);
      } else {
        return;
      }
      event.preventDefault();
      // The keys of the scene (the arrows nudge a prop) do not get this key.
      event.stopPropagation();
      writeOffset(key, offset.value);
    },
  };
}
