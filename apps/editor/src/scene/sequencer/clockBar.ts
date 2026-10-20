// SPDX-License-Identifier: Apache-2.0
/**
 * The clock in the main toolbar: a group in the clock place of the toolbar, after the play control, while a sequence is
 * open. It has To the start, Step back, Play or Pause, Step forward, the time field (type a time in seconds, then
 * Enter), the speed, and A, B and Clear for the loop with the loop range. Each button runs a clock command (`clock.*`,
 * clockState.ts), so each clock key of the key map also works from the toolbar. The time field takes the place of the
 * time of the play control. The group uses DOM nodes only, as the play control does.
 */
import { watchEffect } from "vue";
import { t } from "../../texts";
import { placePart } from "../pageParts";
import { pageKeys } from "../settings/pageKeys";
import { CLOCK_SPEEDS, startClockState, type ClockState } from "./clockState";
import type { PageSequence } from "./pageSequence";
import type { ScenePageEditor } from "../sceneEditor";
import type { ViewportPort } from "../viewport/viewportTypes";
import { SequenceKeys, setPageSequenceKeys } from "./sequenceKeys";
import { startOnionSkins } from "./onionSkins";
import { shallowRef } from "vue";

/** The seconds of a time (ms) with two decimals. */
const seconds = (ms: number): string => (ms / 1000).toFixed(2);

function element<K extends keyof HTMLElementTagNameMap>(tag: K, testId: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.dataset.testid = testId;
  return node;
}

/** A button that runs a clock command (with no arguments, or with `args`). */
function commandButton(command: string, testId: string, text: string, title: string, args?: Record<string, unknown>) {
  const node = element("button", testId);
  node.type = "button";
  node.textContent = text;
  node.title = title;
  node.setAttribute("aria-label", title);
  node.dataset.command = command;
  // A refusal (the play mode has the clock keys) changes nothing.
  node.addEventListener(
    "click",
    () =>
      void pageKeys()
        .execute(command, args ?? {})
        .catch(() => undefined),
  );
  return node;
}

/** The time field: it shows the clock. Enter moves the clock to the typed seconds, and Escape shows the clock again. */
function timeField(clock: ClockState): HTMLInputElement {
  const field = element("input", "clock-time");
  field.type = "text";
  field.inputMode = "decimal";
  field.setAttribute("translate", "no");
  field.setAttribute("aria-label", t("clock-time"));
  field.title = t("clock-time-title");
  let editing = false;
  field.addEventListener("focus", () => (editing = true));
  field.addEventListener("blur", () => {
    editing = false;
    field.value = seconds(clock.time.value);
  });
  field.addEventListener("keydown", (event) => {
    // The clock keys (Space, comma, period) are text in the field.
    event.stopPropagation();
    if (event.key === "Escape") field.blur();
    if (event.key !== "Enter") return;
    const typed = Number(field.value.replace(",", "."));
    if (Number.isFinite(typed)) void pageKeys().execute("clock.seek", { ms: Math.round(typed * 1000) });
    field.blur();
  });
  watchEffect(() => {
    const now = clock.time.value;
    if (!editing) field.value = seconds(now);
  });
  return field;
}

/** The speed list. */
function speedField(clock: ClockState): HTMLSelectElement {
  const field = element("select", "clock-speed");
  field.setAttribute("aria-label", t("clock-speed"));
  for (const speed of CLOCK_SPEEDS) {
    const option = document.createElement("option");
    option.value = String(speed);
    option.textContent = t("clock-speed-value", { speed: String(speed) });
    field.append(option);
  }
  field.addEventListener("change", () => void pageKeys().execute("clock.speed", { speed: Number(field.value) }));
  watchEffect(() => (field.value = String(clock.speed.value)));
  return field;
}

/** Mount the clock group in the toolbar; the result removes it. */
export function startClockBar(clock: ClockState): () => void {
  const group = element("span", "scene-clock");
  group.id = "scene-clock";
  group.setAttribute("role", "group");
  group.setAttribute("aria-label", t("clock-group"));
  const toggle = commandButton("clock.toggle", "clock-toggle", "▶", t("sequencer-play-title"));
  const clear = commandButton("clock.loopClear", "clock-loop-clear", "⨯", t("sequencer-loop-clear"));
  const range = element("span", "clock-loop");
  range.setAttribute("translate", "no");
  group.append(
    commandButton("clock.seek", "clock-start", "⏮", t("sequencer-start"), { ms: 0 }),
    commandButton("clock.stepBack", "clock-back", "‹", t("sequencer-back-title")),
    toggle,
    commandButton("clock.stepForward", "clock-forward", "›", t("sequencer-forward-title")),
    timeField(clock),
    speedField(clock),
    commandButton("clock.loopFrom", "clock-loop-a", "A", t("sequencer-loop-from-title")),
    commandButton("clock.loopTo", "clock-loop-b", "B", t("sequencer-loop-to-title")),
    clear,
    range,
  );
  const stop = watchEffect(() => {
    const playing = clock.playing.value;
    toggle.textContent = playing ? "⏸" : "▶";
    toggle.title = playing ? t("sequencer-pause-title") : t("sequencer-play-title");
    toggle.setAttribute("aria-label", toggle.title);
    toggle.setAttribute("aria-pressed", String(playing));
    const from = clock.loopFrom.value;
    const to = clock.loopTo.value;
    clear.disabled = from === null && to === null;
    group.toggleAttribute("data-looping", clock.looping.value);
    range.textContent =
      from === null && to === null
        ? ""
        : t("clock-loop-range", { from: from === null ? "–" : seconds(from), to: to === null ? "–" : seconds(to) });
  });
  placePart(group, "clock");
  // The time field of the group takes the place of the time of the play control.
  const playTime = document.querySelector<HTMLElement>('#scene-play [data-testid="play-time"]');
  playTime?.setAttribute("data-clock-bar", "1");
  return () => {
    stop();
    group.remove();
    playTime?.removeAttribute("data-clock-bar");
  };
}

/** What the onion skins read of the page. */
export interface SequenceToolParts {
  readonly editor: Pick<ScenePageEditor, "doc" | "listen" | "registry">;
  readonly selection?: { readonly ids: readonly string[]; listen(listener: () => void): () => void } | undefined;
  readonly setOnion?: ((spec: Parameters<NonNullable<ViewportPort["setOnion"]>>[0]) => void) | undefined;
}

/**
 * Start the clock of the open sequence and its group in the toolbar (in the play mode the clock keys do not run), the
 * key marks of the inspector and the onion skins of the Scene view.
 */
export function startSequenceClock(
  sequence: PageSequence,
  play: { readonly active: boolean },
  parts?: SequenceToolParts,
): ClockState {
  const { clock } = startClockState({
    ...{ time: sequence.time, duration: () => sequence.channel.doc.duration },
    blocked: () => (play.active ? t("clock-play-mode") : null),
  });
  startClockBar(clock);
  // The key marks of the inspector over the same clock.
  setPageSequenceKeys(new SequenceKeys(sequence, clock));
  const setOnion = parts?.setOnion;
  if (parts !== undefined && setOnion !== undefined) {
    const edits = shallowRef(0);
    const bump = (): void => {
      edits.value += 1;
    };
    parts.editor.listen(bump);
    parts.selection?.listen(bump);
    sequence.channel.listen(bump);
    startOnionSkins({
      ...{ clock, edits, registry: parts.editor.registry, setOnion },
      scene: () => parts.editor.doc,
      sequence: () => sequence.channel.doc,
      selected: () => parts.selection?.ids ?? [],
    });
  }
  return clock;
}
