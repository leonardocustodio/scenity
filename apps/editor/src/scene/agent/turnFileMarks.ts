// SPDX-License-Identifier: Apache-2.0
/**
 * The marks of the files of the agents in the Project window. A project file that a turn of an agent wrote (the turn
 * records of the host) has a mark on its asset tile. The mark has the colour of the session, the name of the session
 * and the turn. A turn that the person undid gives no mark. The window reads the marks again when a turn starts or
 * ends.
 */
import { shallowRef, watch } from "vue";
import type { AgentClient } from "./agentClient";
import type { AgentStore } from "./agentStore";

/** The mark of a file: the session and the turn that wrote it last. */
export interface AgentFileMark {
  readonly session: string;
  readonly name: string;
  /** The colour token of the session (`agent-1` to `agent-6`). */
  readonly colour: string;
  readonly turn: number;
}

/** The marks of the files of the project, by their path in the project. */
export const agentFileMarks = shallowRef<ReadonlyMap<string, AgentFileMark>>(new Map());

/** The mark of the first path that has one (an asset: its record, then its source), or null. */
export function markOf(paths: readonly (string | null | undefined)[]): AgentFileMark | null {
  for (const path of paths) {
    const mark = path === null || path === undefined ? undefined : agentFileMarks.value.get(path);
    if (mark !== undefined) return mark;
  }
  return null;
}

/** Follow the turns of the sessions of the store. The returned function stops it. */
export function startTurnFileMarks(store: Pick<AgentStore, "sessions">, client: Pick<AgentClient, "turns">) {
  const read = async (): Promise<void> => {
    const next = new Map<string, AgentFileMark>();
    for (const session of store.sessions.value) {
      const { turns } = await client.turns(session.id).catch(() => ({ turns: [] }));
      for (const record of turns) {
        if (record.undone === true) continue;
        const mark = { session: session.id, name: session.name, colour: session.colour, turn: record.turn };
        for (const file of record.files) next.set(file, mark);
      }
    }
    agentFileMarks.value = next;
  };
  return watch(
    () => store.sessions.value.map((session) => `${session.id}:${String(session.running)}`).join(","),
    () => void read(),
    { immediate: true },
  );
}
