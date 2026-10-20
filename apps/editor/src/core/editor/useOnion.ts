// SPDX-License-Identifier: Apache-2.0
/**
 * The onion skin of the lab page: the key O (the command `view.onion`), the URL flag `onion=` at the start (onion.ts),
 * and the spec for the room view. The room view gives the spec to the labs core (`onion.ts` of `@scenity/runtime-dev`).
 * The members of the copies are the selected member, or the full team.
 *
 * The onion skin is a view of the lab, not an input of a frame. No data from this module goes into the URL,
 * `frameKey` or the take. The core poses the copies from the pose model at the times around the clock time. It uses the
 * scene input of each time (the samples of the spec, from the take events). It does this only while the clock is
 * stopped.
 *
 * The script API (`globalThis.__room3dLab`) gets `onion(change?)` and `onionView()`. `onion` returns the state after
 * the change, with the state before the change in `before`. `onionView` returns the copies as the core draws them,
 * with their joints.
 */
import type { SceneInput } from "../../plugins";
import type { OnionSpec, OnionView } from "@scenity/runtime-dev";
import { computed, onBeforeUnmount, onMounted, shallowRef, watch, type ComputedRef, type ShallowRef } from "vue";
import { installApi } from "../edit/useEditPanel";
import type { KeyRun } from "../edit/useSceneEdit";
import type { LabClock } from "../useLabClock";
import { typingInto } from "../labUi";
import type { OnionHost } from "./commandKit";
import { changeOnion, onionSpec, parseOnion, type OnionChange, type OnionState } from "./onion";

/** The parts of the room view (LabsRoomView) that the onion skin uses. */
export interface OnionViewHandle {
  onion?(spec: OnionSpec): void;
  onionView?(): Promise<OnionView | null>;
}

/** The methods of the script API. */
export interface LabOnionApi {
  /** Change the onion skin, or read it without a change. The answer has the state after and the state before. */
  onion(change?: OnionChange & { readonly read?: boolean }): OnionState & { readonly before: OnionState };
  onionView(): Promise<OnionView | null>;
}

export interface OnionParts {
  /** The selected member, or null. */
  readonly member: () => string | null;
  readonly view: () => OnionViewHandle | null;
  readonly params: URLSearchParams;
  /** The clock of the page. A stopped clock gets the samples of the copies around its time. */
  readonly clock: Pick<LabClock, "running" | "displayMs" | "epoch" | "simNow">;
  /** The scene input at a time (the take events of the page), or null. A live session of the mock has no copies. */
  readonly inputAt: ((time: number) => SceneInput) | null;
  /** The command run of the keys (the runner of the page). */
  readonly run: KeyRun;
  /** Add the methods to the script API and the key O (default: true). The tests set false. */
  readonly api?: boolean;
}

export interface Onion {
  readonly state: ShallowRef<OnionState>;
  readonly spec: ComputedRef<OnionSpec>;
  readonly host: OnionHost;
}

export function useOnion(parts: OnionParts): Onion {
  const state = shallowRef<OnionState>(parseOnion(parts.params.get("onion")));
  const spec = computed(() => {
    const { clock } = parts;
    // The samples change with each seek and pause of the clock (reactive reads), and with the events in `inputAt`.
    const stopped = !clock.running.value && clock.displayMs.value >= 0 && clock.epoch.value >= 0;
    const at = stopped && state.value.on ? clock.simNow() : null;
    return onionSpec(state.value, parts.member(), at, parts.inputAt);
  });
  // A plain copy, because the worker message cannot hold the reactive values of the page.
  const send = (): void => parts.view()?.onion?.(structuredClone(spec.value));
  watch(() => JSON.stringify(spec.value), send);
  watch(parts.view, send, { immediate: true });
  const host: OnionHost = {
    set(change) {
      state.value = changeOnion(state.value, change);
      return state.value;
    },
  };
  if (parts.api !== false) {
    const api: LabOnionApi = {
      onion: (change = { read: true }) => {
        const before = state.value;
        const { read, ...rest } = change;
        if (read !== true) host.set(rest);
        return { ...state.value, before };
      },
      onionView: async () => structuredClone((await parts.view()?.onionView?.()) ?? null),
    };
    installApi(api);
    // The key O runs `view.onion`, which shows or hides the onion skin.
    const onKey = (event: KeyboardEvent): void => {
      if (event.code !== "KeyO" || event.repeat || event.metaKey || event.ctrlKey || event.altKey) return;
      if (typingInto(event.target)) return;
      event.preventDefault();
      parts.run("view.onion");
    };
    onMounted(() => {
      globalThis.addEventListener("keydown", onKey);
    });
    onBeforeUnmount(() => {
      globalThis.removeEventListener("keydown", onKey);
    });
  }
  return { state, spec, host };
}
