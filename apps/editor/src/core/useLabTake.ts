// SPDX-License-Identifier: Apache-2.0
/**
 * The live take of the 3D room lab: the events of a take and of the panel, and the lab state at the time of the clock
 * (`labStateAt`). The URL keeps the take (`take`), the events of the panel (`rec`) and the time (`t`, with `paused=1`
 * for a stopped clock). Thus a reload after a code change shows the same moment, and a shared link shows the same
 * frame.
 */
import { ref, shallowRef, watch, type Ref, type ShallowRef } from "vue";
import {
  decodeEvents,
  encodeEvents,
  labStateAt,
  takeNamed,
  type LabEvent,
  type LabState,
  type PresetName,
} from "./sequence";
import { editorPlugin } from "./plugin";
import type { LabClock } from "./useLabClock";

/** The longest `rec` text in the URL. The URL does not keep a longer live take. */
const MAX_URL_EVENTS = 6000;
/** The interval at which the URL gets the time of a running clock (ms). */
const URL_TIME_STEP_MS = 1000;

/** An event without its time: the take gives it the time of the clock. */
export type LabAction = LabEvent extends infer E ? (E extends LabEvent ? Omit<E, "at"> : never) : never;

export interface LabTake {
  /** The name of the take that the live take starts with (`take` or `preset` of the URL, or `loadTake`), or null. */
  readonly base: Ref<PresetName | null>;
  readonly events: ShallowRef<readonly LabEvent[]>;
  /** The lab state at the time of the clock (a new object only when the state changes). */
  readonly state: ShallowRef<LabState>;
  /** Add an event at the time of the clock. */
  push(action: LabAction): void;
  /** Start again with a named take (null: no take) and no events of the panel; the clock does not move. */
  loadTake(name: PresetName | null): void;
  /** Replace the events of the panel (after the events of the take); the clock does not move. */
  setEvents(events: readonly LabEvent[]): void;
  /** The events of the panel: the events after the take and `team=0` (the `rec` events of the URL). */
  panel(): readonly LabEvent[];
  /** Calculate the state again at the current time of the clock (after a seek). */
  refresh(): void;
}

/** The start of the live take: the take of the URL, `team=0`, then the events of the panel (`rec`). */
export interface TakeStart {
  readonly base: PresetName | null;
  readonly events: readonly LabEvent[];
  /** The events of the take and of `team=0`: the URL keeps them as parameters, not in `rec`. */
  readonly fixed: number;
}

export function startEvents(params: URLSearchParams): TakeStart {
  const take = takeNamed(params.get("take") ?? params.get("preset"));
  const events: LabEvent[] = [...(take?.events ?? [])];
  // No team: the empty room for the poster image.
  if (params.get("team") === "0") events.push(...editorPlugin().sequence.emptyScene());
  const fixed = events.length;
  const rec = params.get("rec");
  if (rec !== null) events.push(...(decodeEvents(rec) ?? []));
  return { base: take?.name ?? null, events, fixed };
}

export function useLabTake(clock: LabClock, start: TakeStart, options: { readonly keepUrl: boolean }): LabTake {
  const events = shallowRef<readonly LabEvent[]>(start.events);
  const base = ref<PresetName | null>(start.base);
  /** The events of the take and of `team=0` at the start of the list (TakeStart.fixed). */
  let fixed = start.fixed;
  /** A take of loadTake has no `team=0` events. Then the URL removes the parameter. */
  let dropTeam = false;
  const state = shallowRef<LabState>(labStateAt(events.value, clock.simNow()));
  let stateText = JSON.stringify(state.value);
  /** The events and the time of the last state. The same pair gives the same state, thus no work occurs. */
  let computedFor: { readonly events: readonly LabEvent[]; readonly simMs: number } = {
    events: events.value,
    simMs: clock.simNow(),
  };

  function compute(simMs: number): void {
    if (computedFor.events === events.value && computedFor.simMs === simMs) return;
    computedFor = { events: events.value, simMs };
    const next = labStateAt(events.value, simMs);
    const text = JSON.stringify(next);
    if (text === stateText) return;
    stateText = text;
    state.value = next;
  }

  watch(clock.displayMs, (ms) => {
    compute(ms);
  });

  // ---------------------------------------------------------------------------------------------
  // The URL.

  let urlTime = Number.NaN;
  let urlPaused = !clock.running.value;
  /** The current values of the URL. The same take, events, time and pause write no new URL. */
  let urlFor: readonly unknown[] = [];

  function keepUrl(): void {
    if (!options.keepUrl) return;
    const now = [base.value, events.value, dropTeam, fixed, Math.round(clock.simNow()), !clock.running.value];
    if (now.length === urlFor.length && now.every((value, index) => value === urlFor[index])) return;
    urlFor = now;
    const url = new URL(globalThis.location.href);
    url.searchParams.delete("preset");
    if (base.value === null) url.searchParams.delete("take");
    else url.searchParams.set("take", base.value);
    if (dropTeam) url.searchParams.delete("team");
    const extra = events.value.slice(fixed);
    const rec = extra.length === 0 ? "" : encodeEvents(extra);
    if (rec === "" || rec.length > MAX_URL_EVENTS) url.searchParams.delete("rec");
    else url.searchParams.set("rec", rec);
    urlTime = Math.round(clock.simNow());
    urlPaused = !clock.running.value;
    url.searchParams.set("t", String(urlTime));
    if (urlPaused) url.searchParams.set("paused", "1");
    else url.searchParams.delete("paused");
    globalThis.history.replaceState(globalThis.history.state, "", url);
  }

  watch(clock.displayMs, (ms) => {
    const paused = !clock.running.value;
    if (paused !== urlPaused || Number.isNaN(urlTime) || Math.abs(ms - urlTime) >= URL_TIME_STEP_MS) keepUrl();
  });

  // One refresh per seek, at the seek (a sync watcher of the seek count). The page and the tools read the state of the
  // new time immediately. A later `refresh` of the same time does no work.
  watch(
    clock.epoch,
    () => {
      refresh();
    },
    { flush: "sync" },
  );

  function refresh(): void {
    compute(clock.simNow());
    keepUrl();
  }

  function push(action: LabAction): void {
    const event = { ...action, at: Math.round(clock.simNow()) } as LabEvent;
    const list = [...events.value];
    const last = list.at(-1);
    // A slider gives many values: the plugin tells when the new value replaces the value before it.
    if (last !== undefined && editorPlugin().sequence.replaces(last, event)) list.pop();
    list.push(event);
    events.value = list;
    compute(clock.simNow());
    keepUrl();
    // A new event on a stopped clock is a seek to the current time, as an edit of the editor does
    // (editor/useEditor.ts). The scene reads the events again from the start of the take. Thus the stopped frame is
    // the frame of a reload of the URL (a work at another anchor does not start a walk).
    if (!clock.running.value) clock.seek(clock.simNow());
  }

  return {
    base,
    events,
    state,
    push,
    loadTake(name) {
      base.value = name;
      const take = takeNamed(name);
      events.value = [...(take?.events ?? [])];
      fixed = events.value.length;
      dropTeam = true;
      compute(clock.simNow());
      keepUrl();
    },
    setEvents(next) {
      events.value = [...events.value.slice(0, fixed), ...next];
      compute(clock.simNow());
      keepUrl();
    },
    panel: () => events.value.slice(fixed),
    refresh,
  };
}
