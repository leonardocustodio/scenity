// SPDX-License-Identifier: Apache-2.0
/**
 * The take model of the editor: a take is a list of events on the clock of the lab. The state of the scene at a time
 * is a pure function of the events (`labStateAt`). The plugin gives the model (`EditorPlugin.sequence`). This module
 * gives its functions to the core by the names of the lab.
 *
 * No Vue import: the tools and the tests read it. A function reads the plugin when it runs, never when the module loads.
 */
import type { LabEvent, LabState, PresetName } from "../plugins";
import type { Lanes } from "./lanes";
import { editorPlugin } from "./plugin";

export type { LabEvent, LabState, PresetName };

/** A take of the plugin: its name, its label and its events. */
export interface Take {
  readonly name: PresetName;
  readonly label: string;
  readonly events: readonly LabEvent[];
}

/** A mark of the time line: a time and its words (a member that changes its work). */
export interface PhaseMark {
  readonly at: number;
  readonly label: string;
}

/** The take model of a plugin. */
export interface EditorSequence {
  /** The takes with their labels, in their order ("idle" is the take without events). */
  readonly takes: readonly Take[];
  /** The state of the scene at a time of the events. */
  stateAt(events: readonly LabEvent[], simMs: number): LabState;
  /** The IDs of the members of a state (the Team tab selects one; a press on a member in the scene selects it). */
  members(state: LabState): readonly string[];
  /** The events as the text of the `rec` URL parameter, and the reverse (null for a text that is not an event list). */
  encode(events: readonly LabEvent[]): string;
  decode(text: string): LabEvent[] | null;
  /** The events that remove the team from the scene at time 0 (`team=0`: the empty room of the poster image). */
  emptyScene(): LabEvent[];
  /** True when a new event replaces the last event (the values of a slider within a short time). */
  replaces(last: LabEvent, next: LabEvent): boolean;
  /** The named moments of each take: name → time (ms). */
  readonly moments: Readonly<Record<string, Readonly<Record<string, number>>>>;
  /** The marks of the time line where a member changes its work, from 0 to `end` (ms). */
  marks(events: readonly LabEvent[], end: number): readonly PhaseMark[];
  /** The clip lanes of the sweep of a take inside a range (`labs scenes`). */
  lanesIn(take: string, from: number, to: number): Lanes;
  /** The end of the sweep of a take, and true when the sweep has the take. */
  length(take: string): number;
  swept(take: string): boolean;
  /** The take of the compare view (side A) and of the tools. Without it, the first take with events. */
  readonly defaultTake?: string;
  /** The take of side B of the compare view. Without it, the next take with events after side A. */
  readonly compareTake?: string;
  /** The short name of a member ID in the lanes and in the sheets. Without it, the ID. */
  memberLabel?(member: string): string;
}

const sequence = (): EditorSequence => editorPlugin().sequence;

/** The take of a name, or undefined. */
export function takeNamed(name: string | null): Take | undefined {
  return sequence().takes.find((take) => take.name === name);
}

/** The takes of the plugin. */
export function takeList(): readonly Take[] {
  return sequence().takes;
}

export function labStateAt(events: readonly LabEvent[], simMs: number): LabState {
  return sequence().stateAt(events, simMs);
}

/** The end of the last event: the length of the take on its time line. */
export function takeEnd(events: readonly LabEvent[]): number {
  return events.reduce((end, event) => Math.max(end, event.at), 0);
}

export function encodeEvents(events: readonly LabEvent[]): string {
  return sequence().encode(events);
}

export function decodeEvents(text: string): LabEvent[] | null {
  return sequence().decode(text);
}

/** The named moments of a take (none for an unknown take). */
export function momentsOf(take: string | null): Readonly<Record<string, number>> {
  const all = sequence().moments;
  return take !== null && Object.hasOwn(all, take) ? (all[take] ?? {}) : {};
}

/** The named moments of each take. */
export function allMoments(): Readonly<Record<string, Readonly<Record<string, number>>>> {
  return sequence().moments;
}

export function phaseMarks(events: readonly LabEvent[], end: number): readonly PhaseMark[] {
  return sequence().marks(events, end);
}

export function takeLanesIn(take: string, from: number, to: number): Lanes {
  return sequence().lanesIn(take, from, to);
}

export function takeLength(take: string): number {
  return sequence().length(take);
}

export function takeSwept(take: string): boolean {
  return sequence().swept(take);
}

/** The first take of the compare view: the take of the plugin, else the first take with events. */
export function defaultTakeName(): string | null {
  const { defaultTake, takes } = sequence();
  return defaultTake ?? takes.find((take) => take.events.length > 0)?.name ?? takes[0]?.name ?? null;
}

/** The take of side B of the compare view: the take of the plugin, else the next take with events. */
export function compareTakeName(first: string | null): string | null {
  const { compareTake, takes } = sequence();
  if (compareTake !== undefined) return compareTake;
  const at = takes.findIndex((take) => take.name === first);
  const next = [...takes.slice(at + 1), ...takes.slice(0, Math.max(0, at))].find((take) => take.events.length > 0);
  return next?.name ?? first;
}

/** The short name of a member ID: the rule of the plugin, else the ID. */
export function memberLabel(member: string): string {
  return sequence().memberLabel?.(member) ?? member;
}
