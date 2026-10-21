// SPDX-License-Identifier: Apache-2.0
/**
 * The fake lab plugin of the tests of the lab core (docs/testing.md): a tiny editor face with neutral data. Two
 * robots, Ada and Bo, meet in a hall: the take `greet` (Ada walks to the door, Bo waves) and the take `parade` (both
 * walk to the stage). The plugin gives the take model only. The other faces are empty, so a test that needs one adds
 * it with a spread.
 */
import type { EditorPlugin } from "../../../src/core/plugin";
import type { LabEvent, LabState, PresetName } from "../../../src/core/sequence";

/** A take name of the fixture. */
const take = (name: string): PresetName => name as PresetName;

/** The events of each take. */
export const FIXTURE_TAKES = [
  { name: take("idle"), label: "Idle", events: [] },
  {
    name: take("greet"),
    label: "Greet",
    events: [
      { at: 0, kind: "place", member: "ada", to: "hall" },
      { at: 0, kind: "place", member: "bo", to: "stage" },
      { at: 1_500, kind: "place", member: "ada", to: "door" },
      { at: 4_000, kind: "act", member: "bo" },
    ],
  },
  {
    name: take("parade"),
    label: "Parade",
    events: [
      { at: 0, kind: "place", member: "ada", to: "door" },
      { at: 0, kind: "place", member: "bo", to: "door" },
      { at: 2_000, kind: "place", member: "ada", to: "stage" },
      { at: 2_500, kind: "place", member: "bo", to: "stage" },
    ],
  },
] as const satisfies readonly { name: PresetName; label: string; events: readonly LabEvent[] }[];

/** The named moments of each take. */
export const FIXTURE_MOMENTS = { greet: { start: 0, walk: 1_500, wave: 4_000 }, parade: { start: 0, stage: 2_500 } };

/** The place of each member of a fixture state. */
interface FixtureMember {
  readonly id: string;
  readonly at: string;
}

/** The state at a time: the last place event of each member at or before the time. */
function stateAt(events: readonly LabEvent[], simMs: number): LabState {
  const places = new Map<string, string>();
  for (const event of events) if (event.at <= simMs && event.kind === "place") places.set(event.member, event.to);
  const members: FixtureMember[] = [...places].map(([id, at]) => ({ id, at }));
  return { members };
}

/** The sweep length of each take of the fixture (ms). */
const LENGTHS: Readonly<Record<string, number>> = { greet: 6_000, parade: 4_000 };

/** The take model of the fixture. */
const sequence: EditorPlugin["sequence"] = {
  takes: FIXTURE_TAKES,
  stateAt,
  members: (state) => state.members.map((member) => member.id),
  encode: (events) => JSON.stringify(events),
  decode(text) {
    try {
      const value: unknown = JSON.parse(text);
      return Array.isArray(value) ? (value as LabEvent[]) : null;
    } catch {
      return null;
    }
  },
  emptyScene: () => [],
  replaces: (last, next) => last.kind === next.kind && next.at - last.at < 250,
  moments: FIXTURE_MOMENTS,
  marks: (events, end) =>
    events
      .filter((event) => event.kind === "place" && event.at > 0 && event.at <= end)
      .map((event) => ({ at: event.at, label: event.kind === "place" ? `${event.member} to ${event.to}` : "" })),
  lanesIn: (name, from, to) =>
    Object.hasOwn(LENGTHS, name) ? { ada: [{ clip: "walk", family: "walk", from, to }] } : {},
  length: (name) => LENGTHS[name] ?? 0,
  swept: (name) => Object.hasOwn(LENGTHS, name),
};

/** The fake lab plugin: the take model, and no other face. */
export const fixtureLabPlugin = { id: "fixture-lab", sequence } as unknown as EditorPlugin;
