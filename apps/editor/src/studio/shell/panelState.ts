// SPDX-License-Identifier: Apache-2.0
/**
 * The state of a panel in the layout. Small values of the panel (a search text, a fold, a filter, a locked subject)
 * go into the parameters of the panel in the dock. Thus the layout keeps them, and a reload restores them. A copy of a
 * panel has its own state. `usePanelVisible` tells a panel that stays mounted (the Game view) if its tab shows.
 */
import { inject, ref, watch, type InjectionKey, type Ref } from "vue";

/** True while the tab of the panel shows (a panel that stays mounted can be behind a different tab). */
export const PANEL_VISIBLE_KEY: InjectionKey<Readonly<Ref<boolean>>> = Symbol("scenity.studio.panelVisible");

/** True while the tab of the panel that holds the component shows. Outside a panel, always true. */
export function usePanelVisible(): Readonly<Ref<boolean>> {
  return inject(PANEL_VISIBLE_KEY, null) ?? ref(true);
}

/** The state of one panel. */
export interface PanelState {
  read(key: string): unknown;
  write(key: string, value: unknown): void;
}

export const PANEL_STATE_KEY: InjectionKey<PanelState> = Symbol("scenity.studio.panelState");

/** The parameters of a panel: its state under `state`. */
interface StateParams {
  readonly state?: Readonly<Record<string, unknown>>;
}

/** The state of a panel over its parameters. `changed` keeps the layout after a write. */
export function paramsState(
  params: () => StateParams | undefined,
  update: (next: StateParams) => void,
  changed: () => void,
): PanelState {
  return {
    read: (key) => params()?.state?.[key],
    write: (key, value) => {
      const current = params() ?? {};
      update({ ...current, state: { ...current.state, [key]: value } });
      changed();
    },
  };
}

/**
 * A value of the state of the panel that holds the component. It starts with the stored value (or `fallback`), and
 * each change goes to the layout. Outside a panel, the value is only a ref.
 */
export function usePanelState<T>(key: string, fallback: T): Ref<T> {
  const state = inject(PANEL_STATE_KEY, null);
  const stored = state?.read(key);
  const value = ref((stored === undefined ? fallback : stored) as T) as Ref<T>;
  if (state !== null) watch(value, (next) => state.write(key, next), { deep: true });
  return value;
}
