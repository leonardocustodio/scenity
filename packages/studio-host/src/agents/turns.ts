// SPDX-License-Identifier: Apache-2.0
/**
 * The turn records of the agent sessions. For each turn, the record has the prompt, the times, the tool calls, the
 * frames (the pictures of the results), the jobs (the runs and the checks) and the cost. It also has a snapshot of
 * each project file before the first write of the turn. "Undo the turn" restores each file (it deletes a file that
 * the turn made). It also asks the editor windows to revert the document part of the turn (`turn.undo`). One action
 * reverts both.
 *
 * A write of an agent goes through `snapshot` first. The Claude driver calls it before Edit and Write run. The script
 * driver writes through `writeFile`. The records refuse a path outside the project folder.
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { TURN_RESTORE_CALL, TURN_UNDO_CALL, type BridgeCallDef, type TurnUndoAnswer } from "@scenity/bridge";

/** A turn record as the API gives it. */
export interface TurnRecordView {
  readonly turn: number;
  readonly prompt: string;
  readonly startedAt: number;
  readonly endedAt: number | null;
  /** The project files that the turn wrote (paths in the project). */
  readonly files: readonly string[];
  /** The names of the tools of the turn, in their order. */
  readonly tools: readonly string[];
  /** The pictures of the tool results of the turn (the frames, `/api/agent/pictures/<id>`). */
  readonly frames: readonly string[];
  /** The jobs that the turn started (the runs and the checks). */
  readonly jobs: readonly string[];
  readonly costUsd: number;
  /** True after "Undo the turn". */
  readonly undone: boolean;
}

interface TurnRecord {
  readonly turn: number;
  readonly prompt: string;
  readonly startedAt: number;
  endedAt: number | null;
  /** Each written file and its text before the turn (null: the file was not there). */
  readonly files: Map<string, string | null>;
  readonly tools: string[];
  readonly frames: string[];
  readonly jobs: string[];
  costUsd: number;
  undone: boolean;
}

/** The path of a file in a project folder (posix, no `..`). Throw for a path outside the folder. */
export function projectPath(dir: string, path: string): string {
  const full = isAbsolute(path) ? resolve(path) : resolve(dir, path);
  const inside = relative(resolve(dir), full);
  if (inside === "" || inside.startsWith("..") || isAbsolute(inside)) {
    throw new Error(`${path} is not a file of the project`);
  }
  return inside.split("\\").join("/");
}

/** The turn records of the sessions of the host. */
export class TurnRecords {
  readonly #records = new Map<string, TurnRecord[]>();

  begin(session: string, turn: number, prompt: string): void {
    const list = this.#records.get(session) ?? [];
    list.push({
      turn,
      prompt,
      startedAt: Date.now(),
      endedAt: null,
      files: new Map(),
      tools: [],
      frames: [],
      jobs: [],
      costUsd: 0,
      undone: false,
    });
    this.#records.set(session, list);
  }

  end(session: string, turn: number): void {
    const record = this.#get(session, turn);
    if (record !== undefined) record.endedAt = Date.now();
  }

  /** A tool call of the turn: its name, the pictures of its result and the job that it started (or null). */
  tool(session: string, turn: number, call: { name: string; pictures: readonly string[]; job: string | null }): void {
    const record = this.#get(session, turn);
    if (record === undefined) return;
    record.tools.push(call.name);
    record.frames.push(...call.pictures);
    if (call.job !== null) record.jobs.push(call.job);
  }

  cost(session: string, turn: number, costUsd: number): void {
    const record = this.#get(session, turn);
    if (record !== undefined) record.costUsd += costUsd;
  }

  /** Keep the text of a project file before the first write of the turn. The result is the path in the project. */
  snapshot(session: string, turn: number, dir: string, path: string): string {
    const inside = projectPath(dir, path);
    const record = this.#get(session, turn);
    if (record !== undefined && !record.files.has(inside)) {
      const full = resolve(dir, inside);
      record.files.set(inside, existsSync(full) ? readFileSync(full, "utf8") : null);
    }
    return inside;
  }

  /** A write of an agent: a snapshot, then the text of the file. */
  writeFile(session: string, turn: number, dir: string, path: string, text: string): string {
    const inside = this.snapshot(session, turn, dir, path);
    const full = resolve(dir, inside);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, text);
    return inside;
  }

  list(session: string): TurnRecordView[] {
    return (this.#records.get(session) ?? []).map((record) => ({
      turn: record.turn,
      prompt: record.prompt,
      startedAt: record.startedAt,
      endedAt: record.endedAt,
      files: [...record.files.keys()],
      tools: [...record.tools],
      frames: [...record.frames],
      jobs: [...record.jobs],
      costUsd: record.costUsd,
      undone: record.undone,
    }));
  }

  /** Restore the files of a turn (delete a file that the turn made). The result is the paths. */
  revertFiles(session: string, turn: number, dir: string): string[] {
    const record = this.#get(session, turn);
    if (record === undefined) throw new Error(`No turn ${String(turn)} in the session.`);
    for (const [path, before] of record.files) {
      const full = resolve(dir, path);
      if (before === null) rmSync(full, { force: true });
      else {
        mkdirSync(dirname(full), { recursive: true });
        writeFileSync(full, before);
      }
    }
    record.undone = true;
    return [...record.files.keys()];
  }

  /**
   * Restore the files to the checkpoint of a turn (its start). The function restores the files of that turn and of
   * each later turn, the newest turn first. Thus each file gets its text before the first of those turns. The result
   * is the paths.
   */
  restoreFiles(session: string, turn: number, dir: string): string[] {
    const later = (this.#records.get(session) ?? []).filter((record) => record.turn >= turn).reverse();
    if (later.length === 0) throw new Error(`No turn ${String(turn)} in the session.`);
    const paths = new Set<string>();
    for (const record of later) for (const path of this.revertFiles(session, record.turn, dir)) paths.add(path);
    return [...paths].sort();
  }

  /** A fork keeps the records of its source. */
  copy(from: string, to: string): void {
    this.#records.set(to, [...(this.#records.get(from) ?? [])]);
  }

  close(session: string): void {
    this.#records.delete(session);
  }

  #get(session: string, turn: number): TurnRecord | undefined {
    return this.#records.get(session)?.find((record) => record.turn === turn);
  }
}

/** The turn calls of the editor window that revert the document part of a turn. */
type TurnCall = BridgeCallDef<[string, number], TurnUndoAnswer>;

/**
 * "Undo the turn" (the files of the turn) or the restore of its checkpoint (the files of the turn and
 * of each later turn), then the document part in the newest window (`turn.undo` or `turn.restore`).
 */
export async function revertTurn(
  records: TurnRecords,
  what: { readonly session: string; readonly turn: number; readonly dir: string; readonly restore: boolean },
  call: (def: TurnCall) => Promise<TurnUndoAnswer>,
): Promise<{ turn: number; restore: boolean; files: string[]; steps: number; error: string | null }> {
  const { session, turn, dir, restore } = what;
  const files = restore ? records.restoreFiles(session, turn, dir) : records.revertFiles(session, turn, dir);
  try {
    const answer = await call(restore ? TURN_RESTORE_CALL : TURN_UNDO_CALL);
    return { turn, restore, files, steps: answer.steps, error: answer.error };
  } catch (failure) {
    return { turn, restore, files, steps: 0, error: failure instanceof Error ? failure.message : String(failure) };
  }
}

/**
 * The files of a turn for its driver. `snapshot` keeps a file before a write of the model. `write` keeps it, asks
 * the gate of the file writes, and writes it. `dir` null: a session with no project folder.
 */
export function turnFiles(
  records: TurnRecords,
  at: { readonly session: string; readonly turn: number; readonly dir: string | null },
  permit: (request: {
    kind: "files";
    title: string;
    detail: string;
    path: string;
  }) => Promise<{ readonly allowed: true } | { readonly allowed: false; readonly reason: string }>,
): { snapshot(path: string): string; write(path: string, text: string): Promise<string> } {
  const folder = (): string => {
    if (at.dir === null) throw new Error("The session has no project folder.");
    return at.dir;
  };
  return {
    snapshot: (path) => records.snapshot(at.session, at.turn, folder(), path),
    write: async (path, text) => {
      const inside = records.snapshot(at.session, at.turn, folder(), path);
      const outcome = await permit({ kind: "files", title: `Write ${inside}`, detail: text, path: inside });
      if (!outcome.allowed) throw new Error(outcome.reason);
      return records.writeFile(at.session, at.turn, folder(), inside, text);
    },
  };
}
