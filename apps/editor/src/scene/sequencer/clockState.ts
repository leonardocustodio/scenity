// SPDX-License-Identifier: Apache-2.0
/**
 * The clock of the open sequence in the editor window: the time, the play state, the speed and the loop between A and
 * B, read at each animation frame. The page has one clock state, so the clock group of the main toolbar and the
 * sequencer panel show the same clock. The clock keys are page commands (`clock.*`) while a sequence is open, not only
 * while the panel shows: Space plays and pauses, comma and period step 50 ms (Shift: 250 ms), [ and ] set A and B, \
 * clears the loop. `clock.seek` and `clock.speed` take a time and a speed. In the play mode the keys of the clock go to
 * the input of the game: the key commands do not run then.
 */
import { computed, shallowRef, type ComputedRef, type ShallowRef } from "vue";
import { t } from "../../texts";
import { pageKeys, type PageKeyCommandSpec } from "../settings/pageKeys";
import type { PageTime } from "./pageSequence";

/** A step of the step buttons and of the comma and period keys (ms), and with Shift. */
export const STEP = { short: 50, long: 250 } as const;
/** The speeds of the clock. */
export const CLOCK_SPEEDS = [0.25, 0.5, 1, 2, 4] as const;

/** What the clock reads of the open sequence. */
export interface ClockParts {
  readonly time: PageTime;
  /** The duration of the open sequence (ms). */
  duration(): number;
  /** Why the key commands of the clock cannot run at this time (the play mode), or null. */
  blocked?(): string | null;
}

export class ClockState {
  readonly time: ShallowRef<number>;
  readonly playing: ShallowRef<boolean>;
  readonly speed: ShallowRef<number>;
  readonly loopFrom: ShallowRef<number | null> = shallowRef(null);
  readonly loopTo: ShallowRef<number | null> = shallowRef(null);
  readonly looping: ComputedRef<boolean> = computed(
    () => this.loopFrom.value !== null && this.loopTo.value !== null && this.loopTo.value > this.loopFrom.value,
  );
  readonly #parts: ClockParts;
  readonly blocked = (): string | null => this.#parts.blocked?.() ?? null;
  #frame: number | null = null;

  constructor(parts: ClockParts) {
    this.#parts = parts;
    this.time = shallowRef(Math.round(parts.time.now()));
    this.playing = shallowRef(parts.time.playing());
    this.speed = shallowRef(parts.time.speed?.() ?? 1);
    this.#frame = requestAnimationFrame(this.#tick);
  }

  /** Read the clock; in a loop, return to A at B. */
  readonly #tick = (): void => {
    const { time } = this.#parts;
    const now = Math.round(time.now());
    this.playing.value = time.playing();
    if (
      this.playing.value &&
      this.looping.value &&
      (now >= (this.loopTo.value ?? 0) || now < (this.loopFrom.value ?? 0))
    ) {
      time.seek(this.loopFrom.value ?? 0);
      time.play();
    }
    this.time.value = Math.round(time.now());
    this.#frame = requestAnimationFrame(this.#tick);
  };

  seek(at: number): void {
    const { time } = this.#parts;
    time.seek(Math.min(Math.max(0, Math.round(at)), this.#parts.duration()));
    this.time.value = Math.round(time.now());
    this.playing.value = false;
  }

  toggle(): void {
    const { time } = this.#parts;
    if (time.playing()) time.pause();
    else time.play();
    this.playing.value = time.playing();
  }

  step(direction: 1 | -1, long: boolean): void {
    this.seek(this.#parts.time.now() + direction * (long ? STEP.long : STEP.short));
  }

  setLoop(edge: "from" | "to"): void {
    (edge === "from" ? this.loopFrom : this.loopTo).value = Math.round(this.#parts.time.now());
  }

  clearLoop(): void {
    this.loopFrom.value = null;
    this.loopTo.value = null;
  }

  /** Set the speed of the clock (a clock with no speed control stays at 1). */
  setSpeed(speed: number): void {
    this.#parts.time.setSpeed?.(speed);
    this.speed.value = this.#parts.time.speed?.() ?? 1;
  }

  /** True when the clock reads this page time. */
  reads(time: PageTime): boolean {
    return this.#parts.time === time;
  }

  dispose(): void {
    if (this.#frame !== null) cancelAnimationFrame(this.#frame);
    this.#frame = null;
  }
}

/** The clock commands of the key map. */
export function clockCommands(clock: ClockState): PageKeyCommandSpec[] {
  const step = (id: string, title: string, key: string, direction: 1 | -1, long: boolean): PageKeyCommandSpec => ({
    ...{ id, title, keys: [key], repeat: true },
    run: () => clock.step(direction, long),
  });
  const keyed: PageKeyCommandSpec[] = [
    {
      id: "clock.toggle",
      menu: "sequence",
      title: t("sequencer-command-toggle"),
      keys: ["Space"],
      run: () => clock.toggle(),
    },
    step("clock.stepBack", t("sequencer-back", { ms: STEP.short }), ",", -1, false),
    step("clock.stepForward", t("sequencer-forward", { ms: STEP.short }), ".", 1, false),
    step("clock.stepBackLong", t("sequencer-back", { ms: STEP.long }), "Shift+,", -1, true),
    step("clock.stepForwardLong", t("sequencer-forward", { ms: STEP.long }), "Shift+.", 1, true),
    {
      id: "clock.loopFrom",
      menu: "sequence/loop",
      title: t("sequencer-command-loop-from"),
      keys: ["["],
      run: () => clock.setLoop("from"),
    },
    {
      id: "clock.loopTo",
      menu: "sequence/loop",
      title: t("sequencer-command-loop-to"),
      keys: ["]"],
      run: () => clock.setLoop("to"),
    },
    {
      id: "clock.loopClear",
      menu: "sequence/loop",
      title: t("sequencer-loop-clear"),
      keys: ["\\"],
      run: () => clock.clearLoop(),
    },
  ];
  return [
    ...keyed.map((command) => ({ ...command, when: clock.blocked })),
    {
      id: "clock.seek",
      title: t("clock-command-seek"),
      agents: true,
      args: { ms: { type: "number", description: t("clock-arg-ms") } },
      run: (args) => clock.seek(typeof args.ms === "number" ? args.ms : 0),
    },
    {
      id: "clock.speed",
      title: t("clock-command-speed"),
      agents: true,
      args: { speed: { type: "number", description: t("clock-arg-speed") } },
      run: (args) => clock.setSpeed(typeof args.speed === "number" ? args.speed : 1),
    },
  ];
}

/** The clock state of the page (none with no open sequence). */
let current: ClockState | null = null;

export function pageClockState(): ClockState | null {
  return current;
}

/** Start the clock state of the open sequence and its commands; the result stops them. */
export function startClockState(parts: ClockParts): { clock: ClockState; stop(): void } {
  current?.dispose();
  const clock = new ClockState(parts);
  current = clock;
  const unregister = pageKeys().register(clockCommands(clock));
  return {
    clock,
    stop: () => {
      unregister();
      clock.dispose();
      if (current === clock) current = null;
    },
  };
}
