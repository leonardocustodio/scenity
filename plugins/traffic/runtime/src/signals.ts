// SPDX-License-Identifier: Apache-2.0
/**
 * The phases of the crossing signal. The cycle is green, amber, all red, walk,
 * clearance, and green again. Green holds until a button press, and at least `minGreen`. Each other phase has a fixed
 * time. A phase change has an exact time (the end of the phase before it), so the phase at a time does not depend on
 * the step of the simulation.
 *
 * A press counts on green and on clearance (the request of the next cycle). A press on amber, all red or walk changes
 * nothing: the walk of this cycle comes, or is on.
 */
import type { Phase, Signal, Timing } from "./state";

/** The phase after each phase. */
const NEXT: Readonly<Record<Phase, Phase>> = {
  green: "amber",
  amber: "allRed",
  allRed: "walk",
  walk: "clearance",
  clearance: "green",
};

/** The end time of the phase of a signal, or null for a green with no request. */
export function phaseEnd(signal: Signal, timing: Timing): number | null {
  if (signal.phase === "green") {
    return signal.request === null ? null : Math.max(signal.since + timing.minGreen, signal.request);
  }
  return signal.since + timing[signal.phase];
}

/** The signal at the time `t`: each phase that ends at or before `t` gives its place to the next. */
export function signalAt(signal: Signal, timing: Timing, t: number): Signal {
  let out = signal;
  for (let end = phaseEnd(out, timing); end !== null && end <= t; end = phaseEnd(out, timing)) {
    const phase = NEXT[out.phase];
    // Amber serves the request. A request of the clearance stays for the next green.
    out = { phase, since: end, request: phase === "amber" ? null : out.request };
  }
  return out;
}

/** The signal after a button press at the time `t`. */
export function pressed(signal: Signal, t: number): Signal {
  if (signal.request !== null) return signal;
  return signal.phase === "green" || signal.phase === "clearance" ? { ...signal, request: t } : signal;
}

/** True when a car must not pass the stop line in this phase (amber counts: a car stops unless it cannot). */
export function stopsCars(phase: Phase): boolean {
  return phase !== "green";
}

/** The lit lamp of a head of the signal in a phase: `car` (red, amber, green) or `walk` (walk, wait). */
export function litLamp(head: "car" | "walk", phase: Phase): string {
  if (head === "walk") return phase === "walk" ? "walk" : "wait";
  if (phase === "green") return "green";
  return phase === "amber" ? "amber" : "red";
}
