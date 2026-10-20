// SPDX-License-Identifier: Apache-2.0
/**
 * The light of the lab page: the key light handle in each pane (the editor overlay, part `light`), its drag, the key
 * I, and the slider changes of the Light section (LightSection.vue).
 *
 * The handle is a dot on the sphere around the aim of the key light, in the direction of the light (lightEdit.ts). A
 * press on the dot drags it on the plane that faces the camera. The light turns to the new direction and keeps its
 * distance from the aim. The drag writes the tune values of `light.key.at` as a prop drag writes its place. The core
 * sets its lights from them immediately, and the drag is one step of the undo history. "Save placement" writes them
 * into the source with `labs tune-apply`. ⌘ at the press stages the move as a proposal (`light.move`). Then the drag
 * writes no tune value, and the proposed handle is faint.
 *
 * The handle reads the tune values and the pointer. It keeps no state of the scene, and it is not an input of a frame
 * (the core hides the overlay in its pictures). The script API gets `lightHandle()`: the current light and the handle.
 */
import type { Vec3 } from "@scenity/character";
import {
  computed,
  getCurrentInstance,
  onBeforeUnmount,
  onMounted,
  ref,
  shallowRef,
  watch,
  type ComputedRef,
  type InjectionKey,
  type Ref,
} from "vue";
import type { PlaceDrag } from "../edit/scenePointer";
import { installApi } from "../edit/useEditPanel";
import type { KeyRun, SceneEdit } from "../edit/useSceneEdit";
import { typingInto } from "../labUi";
import type { Args, LightHost } from "./commandKit";
import { handlePoint, nearestHandle, type HandleStart } from "./handleDrag";
import {
  hexOf,
  keyFromHandle,
  keyHandle,
  lightOf,
  lightShapes,
  moveOps,
  type ColourPart,
  type LightPart,
  type LightView,
  type Rgb,
} from "./lightEdit";
import { applyTuneOps, tuneOps, type EditOp, type TuneOp } from "./ops";
import { setOverlayLayer } from "./useEditorOverlay";

/** The name of the part of the editor overlay. */
const LAYER = "light";

export interface LightParts {
  readonly edit: Pick<SceneEdit, "overlayLayers" | "history" | "defaults">;
  readonly tunes: Ref<Record<string, number>>;
  /** The edits that wait (the proposals of the runner). The handle of a proposed key light is faint. */
  readonly proposals: () => readonly { readonly edit: { readonly ops: readonly EditOp[] } }[];
  readonly run: KeyRun;
  /** Add the method to the script API and listen to the key I (default: true). The tests set false. */
  readonly api?: boolean;
}

/** A drag of the key light handle. */
interface LightDrag {
  readonly start: HandleStart;
  /** The light at the start. The aim and the distance stay the same while the handle moves. */
  readonly view: LightView;
  readonly propose: boolean;
  /** The current position of the key light (a staged drag), or null before the first move. */
  readonly at: Vec3 | null;
}

export interface LightTool {
  readonly shown: Ref<boolean>;
  /** The current light, or null when the runtime has no light tunables. */
  readonly view: ComputedRef<LightView | null>;
  readonly host: LightHost;
  readonly pointer: PlaceDrag;
  /** A slider changes a value (lightEdit.ts ops). The first change of a gesture starts one step of the history. */
  preview(ops: readonly TuneOp[]): void;
  /** The end of a slider gesture (its value commit). This ends the step. */
  commit(): void;
  /** One change of an intensity or a colour (the commands `light.intensity`, `light.colour`). */
  intensity(part: LightPart, value: number): void;
  colour(part: ColourPart, rgb: Rgb): void;
}

/** The Light section of the Tune tab (LightSection.vue): the tool and the command run of the owner. */
export interface LightContext {
  readonly tool: LightTool;
  run(id: string, args?: Args): void;
}

export const LIGHT_TOOL: InjectionKey<LightContext> = Symbol("light-tool");

/** The methods of the script API. */
export interface LabLightApi {
  lightHandle(): { readonly shown: boolean; readonly light: LightView | null; readonly handle: Vec3 | null };
}

/** The drag of the key light handle: the tune values of the light during the move, or a proposal at its end (⌘). */
function lightPointer(parts: LightParts, tool: Pick<LightTool, "shown" | "view">, drag: Ref<LightDrag | null>) {
  const { edit, tunes } = parts;
  const pointer: PlaceDrag = {
    active: () => tool.shown.value && tool.view.value !== null,
    grab(hit, x, y, propose) {
      const view = tool.view.value;
      if (view === null || nearestHandle(hit.camera, [keyHandle(view)], x, y) === null) return false;
      drag.value = { start: { at: keyHandle(view), camera: hit.camera, x, y, mode: "face" }, view, propose, at: null };
      if (!propose) edit.history.begin();
      return true;
    },
    move(x, y) {
      const now = drag.value;
      if (now === null) return;
      const at = keyFromHandle(now.view, handlePoint(now.start, x, y, 0));
      drag.value = { ...now, at };
      if (!now.propose) tunes.value = applyTuneOps(tunes.value, moveOps("key", at), edit.defaults);
    },
    end(moved) {
      const now = drag.value;
      drag.value = null;
      if (now === null) return;
      if (!now.propose) {
        edit.history.end();
        return;
      }
      if (!moved || now.at === null) return;
      const [x, y, z] = now.at;
      parts.run("light.move", { part: "key", x, y, z }, true);
    },
  };
  return pointer;
}

/** Listen to the key I while the component lives. */
function useLightKey(run: KeyRun): void {
  const onKey = (event: KeyboardEvent): void => {
    if (event.code !== "KeyI" || event.repeat || event.metaKey || event.ctrlKey || event.altKey) return;
    if (typingInto(event.target)) return;
    event.preventDefault();
    run("light.show");
  };
  if (getCurrentInstance() === null) return;
  onMounted(() => {
    globalThis.addEventListener("keydown", onKey);
  });
  onBeforeUnmount(() => {
    globalThis.removeEventListener("keydown", onKey);
  });
}

export function useLight(parts: LightParts): LightTool {
  const { edit, tunes } = parts;
  const shown = ref(false);
  const view = computed(() => lightOf(tunes.value, edit.defaults));
  const drag = shallowRef<LightDrag | null>(null);

  /** The light after the tune ops of a proposal (or of a staged drag), or null without a change of the light. */
  const lightAfter = (ops: readonly EditOp[]): LightView | null => {
    if (!tuneOps(ops).some((op) => op.path.startsWith("light.key."))) return null;
    return lightOf(applyTuneOps(tunes.value, ops, edit.defaults), edit.defaults);
  };
  const shapes = computed(() => {
    const now = view.value;
    if (!shown.value || now === null) return null;
    const staged = drag.value;
    const ghost =
      staged?.propose === true && staged.at !== null
        ? lightAfter(moveOps("key", staged.at))
        : (parts
            .proposals()
            .map((item) => lightAfter(item.edit.ops))
            .find((item) => item !== null) ?? null);
    return lightShapes(now, staged !== null, ghost);
  });
  watch(
    () => JSON.stringify(shapes.value),
    () => {
      setOverlayLayer(edit.overlayLayers, LAYER, shapes.value);
    },
    { immediate: true },
  );

  let gesture = false;
  const tool: LightTool = {
    shown,
    view,
    host: {
      show: (on) => {
        shown.value = on ?? !shown.value;
        return shown.value;
      },
    },
    pointer: lightPointer(parts, { shown, view }, drag),
    preview(ops) {
      if (!gesture) edit.history.begin();
      gesture = true;
      tunes.value = applyTuneOps(tunes.value, ops, edit.defaults);
    },
    commit() {
      if (gesture) edit.history.end();
      gesture = false;
    },
    intensity: (part, value) => {
      parts.run("light.intensity", { part, value });
    },
    colour: (part, rgb) => {
      parts.run("light.colour", { part, colour: hexOf(rgb) });
    },
  };

  if (parts.api !== false) {
    const api: LabLightApi = {
      lightHandle: () => ({
        shown: shown.value,
        light: view.value === null ? null : structuredClone(view.value),
        handle: view.value === null ? null : keyHandle(view.value),
      }),
    };
    installApi(api);
    useLightKey(parts.run);
  }
  return tool;
}
