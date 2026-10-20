// SPDX-License-Identifier: Apache-2.0
/**
 * The chip state of the composer of the agent panel. It holds the automatic chips, the added chips (mentions, drops,
 * pictures) and `tick`. The context port gives the automatic chips. A removed automatic chip stays off until the next
 * prompt. The panel increments `tick` to read the automatic chips again.
 */
import { shallowRef, type ShallowRef } from "vue";
import type { CardNames } from "./agentCards";
import { composerChips, type AgentChip } from "./agentContext";

/** What the chips read of the window. */
export interface AgentContextPort {
  /** The current automatic chips for a session (for example, the result of its last review). */
  auto(session: string | null): AgentChip[];
  /** The mention chips for the text after `@`, the best first. */
  mentions(query: string): AgentChip[];
  /** The mention chip of an entity of the open scene (a drop of a hierarchy row). */
  entity(id: string): AgentChip;
  /** The chip of a region of the Scene view that the person drags, or null. */
  region(): Promise<AgentChip | null>;
  /** The names of the cards (the title of a command, the name of an entity). */
  readonly names: CardNames;
  /** True for an entity of the open scene. */
  known(id: string): boolean;
  /** Select the entities and frame them in the Scene view ("Show in the scene"). */
  show(ids: readonly string[]): void;
  /** The count of the changes of a session that wait for review. */
  waiting(session: string): number;
  /** Open the Review panel. */
  openReview(): void;
  /** Accept all the changes of a session, one step for each set. Return the reason of a refusal, or null. */
  acceptAll(session: string): string | null;
  /** The names of the entities that changed since a checkpoint of this window, or null with no checkpoint. */
  checkpointDiff(session: string, turn: number): string[] | null;
  /** Show the scene of a checkpoint in the view, or stop the preview. */
  previewCheckpoint(session: string, turn: number, on: boolean): void;
  /** The key of the current preview of the view (`checkpoint:<session>#<turn>`), or null. */
  previewKey(): string | null;
}

export interface ChipState {
  readonly added: ShallowRef<readonly AgentChip[]>;
  readonly muted: ShallowRef<ReadonlySet<string>>;
  readonly tick: ShallowRef<number>;
  /** The chips that go with the next prompt. */
  list(): AgentChip[];
  add(chip: AgentChip): void;
  remove(key: string): void;
  /** Clear the state after a prompt: no added chip, no removed chip. */
  clear(): void;
}

export function createChipState(port: AgentContextPort | null, session: () => string | null): ChipState {
  const added = shallowRef<readonly AgentChip[]>([]);
  const muted = shallowRef<ReadonlySet<string>>(new Set());
  const tick = shallowRef(0);
  return {
    added,
    muted,
    tick,
    list: () => composerChips(port?.auto(session()) ?? [], muted.value, added.value),
    add: (chip) => {
      added.value = [...added.value.filter((item) => item.key !== chip.key), chip];
      if (muted.value.has(chip.key)) muted.value = new Set([...muted.value].filter((key) => key !== chip.key));
    },
    remove: (key) => {
      added.value = added.value.filter((item) => item.key !== key);
      if (key.startsWith("auto:")) muted.value = new Set([...muted.value, key]);
    },
    clear: () => {
      added.value = [];
      muted.value = new Set();
    },
  };
}
