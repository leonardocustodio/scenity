// SPDX-License-Identifier: Apache-2.0
/**
 * The turns of Claude and their undo. A turn starts at each prompt (`UserPromptSubmit`) or on demand. At the start,
 * the host takes a snapshot of the dirty files of the checkout: it copies each one into the state folder under the
 * SHA-256 of its content. The `PostToolUse` hook comes after an edit. Thus, at the first edit of a file in a turn, the
 * host takes the content of the turn start from that snapshot. For a file that was clean, it takes the content from
 * Git (`git show <head>:<path>`). `undoTurn` writes those contents back and deletes the files that the turn created.
 * It does not change the other files.
 *
 * The state of each checkout is `<state>/turns/<hash of the checkout>/turns.json` and its `blobs/` folder.
 *
 * A checkout can be a workspace folder below the Git top folder. The store maps it to its Git top folder
 * (the `top` option), so the paths of a turn are paths from the Git top folder, as in the Changes tab.
 */
import { createHash, randomBytes } from "node:crypto";
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  rmdirSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { CommitNotes, withOverrides } from "./commitNotes";
import { checkoutPath, gitStatus, headCommit, isIgnored, showFile } from "./git";
import type { TurnState, TurnSummary, UndoResult } from "./protocol";
import { checkoutHash, readJsonObject, writeJsonAtomic } from "./state";

/** The content of a file at the turn start: a saved copy, no file, or not known (the undo skips the file). */
export type FileBase =
  | { readonly kind: "blob"; readonly hash: string; readonly mode: number | null }
  | { readonly kind: "absent" }
  | { readonly kind: "unknown"; readonly reason: string };

interface TurnRecord {
  session: string;
  turn: number;
  prompt: string;
  started: string;
  head: string | null;
  files: string[];
  bases: Record<string, FileBase>;
  state: TurnState;
  /** The dirty files at the turn start. Only the last turn of a checkout keeps it. */
  snapshot: Record<string, FileBase> | null;
}

interface CheckoutTurns {
  start: string | null;
  turns: TurnRecord[];
}

export interface TurnStoreOptions {
  /** The state folder of the host. */
  readonly stateDir: string;
  /** The count of turns that the store keeps per checkout (default 100). */
  readonly maxTurns?: number;
  /** A larger file gets no snapshot (default 20 MB). */
  readonly maxFileBytes?: number;
  readonly now?: () => Date;
  /** False for a project folder with no Git: the store keeps no turns (default true). */
  readonly git?: () => boolean;
  /** The Git top folder of a checkout (default: the checkout itself). */
  readonly top?: (checkout: string) => string;
}

/** The options of `beginTurn`. */
export interface BeginOptions {
  /**
   * The number of the turn (the hooks count the turns of a session). A number that the session has already, and the
   * default, give the last number plus one. The caller uses the number of the result.
   */
  readonly turn?: number;
  readonly prompt?: string;
}

const MAX_TURNS = 100;
const MAX_FILE_BYTES = 20 * 1024 * 1024;

/** A commit message from a prompt: its first line, at most 72 characters, with a capital first letter. */
export function proposeMessage(prompt: string): string {
  const line = (prompt.split(/\r?\n/).find((text) => text.trim() !== "") ?? "").trim().replace(/\s+/g, " ");
  let text = line.length <= 72 ? line : line.slice(0, 72).replace(/\s+\S*$/, "");
  text = text.replace(/[.:;,]+$/, "");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** The summary of a turn that a store without Git does not keep. */
function unkeptTurn(session: string, options: BeginOptions, now: Date): TurnSummary {
  const prompt = (options.prompt ?? "").trim();
  return { session, turn: options.turn ?? 1, prompt, started: now.toISOString(), head: null, files: [], state: "open" };
}

function summary(record: TurnRecord): TurnSummary {
  const { session, turn, prompt, started, head, files, state } = record;
  return { session, turn, prompt, started, head, files: [...files], state };
}

/** The turns of the checkouts of one host, with their saved contents. */
export class TurnStore {
  readonly #root: string;
  readonly #maxTurns: number;
  readonly #maxBytes: number;
  readonly #now: () => Date;
  readonly #git: () => boolean;
  readonly #top: (checkout: string) => string;
  readonly #queues = new Map<string, Promise<unknown>>();
  /** The reasons of the layout overrides for the commit message proposal. */
  readonly notes: CommitNotes;

  constructor(options: TurnStoreOptions) {
    this.#root = join(options.stateDir, "turns");
    this.notes = new CommitNotes(options.stateDir);
    this.#maxTurns = options.maxTurns ?? MAX_TURNS;
    this.#maxBytes = options.maxFileBytes ?? MAX_FILE_BYTES;
    this.#now = options.now ?? (() => new Date());
    this.#git = options.git ?? (() => true);
    this.#top = options.top ?? ((checkout) => checkout);
  }

  // The storage.
  #dir(checkout: string): string {
    return join(this.#root, checkoutHash(checkout));
  }

  #load(checkout: string): CheckoutTurns {
    const value = readJsonObject(join(this.#dir(checkout), "turns.json"));
    const start = typeof value.start === "string" ? value.start : null;
    const turns = Array.isArray(value.turns) ? (value.turns as TurnRecord[]) : [];
    return { start, turns };
  }

  #save(checkout: string, data: CheckoutTurns): void {
    mkdirSync(this.#dir(checkout), { recursive: true, mode: 0o700 });
    writeJsonAtomic(join(this.#dir(checkout), "turns.json"), data);
  }

  /** Run the operations of one checkout one after the other. */
  #queue<T>(checkout: string, work: () => Promise<T>): Promise<T> {
    const previous = this.#queues.get(checkout) ?? Promise.resolve();
    const next = previous.then(work, work);
    this.#queues.set(
      checkout,
      next.catch(() => undefined),
    );
    return next;
  }

  /** Save a content under its hash and give the hash. */
  #putBlob(checkout: string, content: Buffer): string {
    const hash = createHash("sha256").update(content).digest("hex");
    const folder = join(this.#dir(checkout), "blobs");
    const path = join(folder, hash);
    if (!existsSync(path)) {
      mkdirSync(folder, { recursive: true, mode: 0o700 });
      const temporary = `${path}.${randomBytes(4).toString("hex")}.tmp`;
      writeFileSync(temporary, content, { mode: 0o600 });
      renameSync(temporary, path);
    }
    return hash;
  }

  /** The base of a file of the working tree now: a copy of it, or "absent" when it does not exist. */
  #baseOfFile(checkout: string, path: string): FileBase {
    const full = join(checkout, path);
    let stat;
    try {
      stat = lstatSync(full);
    } catch {
      return { kind: "absent" };
    }
    if (!stat.isFile()) return { kind: "unknown", reason: "not a regular file" };
    if (stat.size > this.#maxBytes) return { kind: "unknown", reason: "too large for a snapshot" };
    return { kind: "blob", hash: this.#putBlob(checkout, readFileSync(full)), mode: stat.mode & 0o777 };
  }

  /** Delete the saved contents that no open turn and no snapshot needs. */
  #collect(checkout: string, data: CheckoutTurns): void {
    const used = new Set<string>();
    for (const record of data.turns) {
      const maps = record.state === "open" ? [record.bases, record.snapshot ?? {}] : [record.snapshot ?? {}];
      for (const map of maps) for (const base of Object.values(map)) if (base.kind === "blob") used.add(base.hash);
    }
    const folder = join(this.#dir(checkout), "blobs");
    if (!existsSync(folder)) return;
    for (const name of readdirSync(folder)) if (!used.has(name)) rmSync(join(folder, name), { force: true });
  }

  // The session start.
  /** Record the HEAD commit of the checkout as the start of the session (at the open of a checkout). */
  recordStart(folder: string): Promise<string | null> {
    if (!this.#git()) return Promise.resolve(null);
    const checkout = this.#top(folder);
    return this.#queue(checkout, async () => {
      const head = await headCommit(checkout);
      this.#save(checkout, { ...this.#load(checkout), start: head });
      return head;
    });
  }

  /** The commit at the session start, or null. */
  start(checkout: string): string | null {
    return this.#load(this.#top(checkout)).start;
  }

  // The turns.
  /**
   * Start a turn of a session: take the snapshot of the dirty files. The snapshot of the turn before is not
   * necessary after this, because each edit of that turn has its base already.
   */
  beginTurn(folder: string, session: string, options: BeginOptions = {}): Promise<TurnSummary> {
    // Without Git, the store does not keep the turn. The hooks still get a number for the before and after pictures.
    if (!this.#git()) return Promise.resolve(unkeptTurn(session, options, this.#now()));
    const checkout = this.#top(folder);
    return this.#queue(checkout, async () => {
      const data = this.#load(checkout);
      const status = await gitStatus(checkout);
      const snapshot: Record<string, FileBase> = {};
      for (const file of status.files) snapshot[file.path] = this.#baseOfFile(checkout, file.path);
      for (const record of data.turns) record.snapshot = null;
      const last = Math.max(0, ...data.turns.filter((item) => item.session === session).map((item) => item.turn));
      // A turn number that the session has already (a host restart counts again from 1) gives the next number.
      const taken = data.turns.some((item) => item.session === session && item.turn === options.turn);
      const turn = options.turn === undefined || taken ? last + 1 : options.turn;
      const record: TurnRecord = {
        session,
        turn,
        prompt: (options.prompt ?? "").trim(),
        started: this.#now().toISOString(),
        head: status.head,
        files: [],
        bases: {},
        state: "open",
        snapshot,
      };
      data.turns = [...data.turns, record].slice(-this.#maxTurns);
      this.#collect(checkout, data);
      this.#save(checkout, data);
      return summary(record);
    });
  }

  /** The base of a file at its first edit in a turn. */
  async #baseAtEdit(checkout: string, record: TurnRecord, path: string): Promise<FileBase> {
    if (record.snapshot === null) return { kind: "unknown", reason: "the turn has no snapshot" };
    const saved = record.snapshot[path];
    if (saved !== undefined) return saved;
    // The file was clean at the turn start: its content is the content of the commit of the turn start.
    const content = record.head === null ? null : await showFile(checkout, record.head, path);
    if (content !== null) return { kind: "blob", hash: this.#putBlob(checkout, content), mode: null };
    if (await isIgnored(checkout, path)) return { kind: "unknown", reason: "Git ignores the file; no copy exists" };
    return { kind: "absent" };
  }

  /**
   * Add the edited files to the last turn of a session (the `PostToolUse` hook). A file keeps the base of its first
   * edit in the turn. A path outside the checkout is ignored. Without a turn of the session, the host starts one now;
   * the files of that first call get no base (the edit came before the snapshot).
   */
  async recordEdits(folder: string, session: string, files: readonly string[]): Promise<TurnSummary | null> {
    if (!this.#git()) return null;
    const checkout = this.#top(folder);
    const paths: string[] = [];
    for (const file of files) {
      try {
        // A relative path of a hook is a path from the folder of Claude (the workspace folder).
        paths.push(checkoutPath(checkout, resolve(folder, file)));
      } catch {
        // Not a file of this checkout: the turn does not track it.
      }
    }
    if (paths.length === 0) return null;
    const known = this.#load(checkout).turns.some((item) => item.session === session);
    if (!known) await this.beginTurn(folder, session, { prompt: "" });
    return this.#queue(checkout, async () => {
      const data = this.#load(checkout);
      const record = data.turns.filter((item) => item.session === session).at(-1);
      if (record === undefined) return null;
      for (const path of paths) {
        if (record.files.includes(path)) continue;
        record.files.push(path);
        record.bases[path] = known
          ? await this.#baseAtEdit(checkout, record, path)
          : { kind: "unknown", reason: "the edit came before the turn start" };
      }
      record.state = "open";
      this.#save(checkout, data);
      return summary(record);
    });
  }

  /**
   * Add to the last open turn of a session the files that a shell command changed. The hook of a command names
   * no file. A file of the command is a file of the Git status or of the turn snapshot that is different from its
   * content at the turn start, with a modification time at or after `sinceMs`. A deleted file has no time: it counts
   * when it existed at the turn start. A file of another process in the same time also goes into the turn; the
   * Changes tab shows the files before an undo. Gives the turn and the added files, or null without an open turn.
   */
  recordCommandChanges(
    folder: string,
    session: string,
    sinceMs: number,
  ): Promise<{ summary: TurnSummary; added: string[] } | null> {
    const checkout = this.#top(folder);
    return this.#queue(checkout, async () => {
      const data = this.#load(checkout);
      const record = data.turns.filter((item) => item.session === session).at(-1);
      if (record?.snapshot === null || record?.snapshot === undefined || record.state !== "open") return null;
      const status = await gitStatus(checkout);
      const paths = new Set([...status.files.map((file) => file.path), ...Object.keys(record.snapshot)]);
      const added: string[] = [];
      for (const path of paths) {
        if (record.files.includes(path) || !this.#changedSince(checkout, record.snapshot, path, sinceMs)) continue;
        record.files.push(path);
        record.bases[path] = await this.#baseAtEdit(checkout, record, path);
        added.push(path);
      }
      if (added.length > 0) this.#save(checkout, data);
      return { summary: summary(record), added };
    });
  }

  /** True when a file changed at or after `sinceMs` and is different from its content in the turn snapshot. */
  #changedSince(checkout: string, snapshot: Record<string, FileBase>, path: string, sinceMs: number): boolean {
    const saved = snapshot[path];
    const full = join(checkout, path);
    let stat;
    try {
      stat = lstatSync(full);
    } catch {
      // No file now: a change when the file existed at the turn start (a clean file, or a saved copy).
      return saved === undefined || saved.kind === "blob";
    }
    if (!stat.isFile() || stat.mtimeMs < sinceMs) return false;
    if (saved?.kind !== "blob") return true;
    if (stat.size > this.#maxBytes) return true;
    return createHash("sha256").update(readFileSync(full)).digest("hex") !== saved.hash;
  }

  /** Keep a turn: its files stay, and the store removes its undo. */
  keepTurn(folder: string, session: string, turn: number): Promise<void> {
    const checkout = this.#top(folder);
    return this.#queue(checkout, () => {
      const data = this.#load(checkout);
      const record = findTurn(data, session, turn);
      if (record.state === "undone") throw new Error(`Turn ${String(turn)} is undone.`);
      record.state = "kept";
      this.#collect(checkout, data);
      this.#save(checkout, data);
      return Promise.resolve();
    });
  }

  /**
   * Restore the files of a turn to their state at the turn start, and delete the files that the turn created. A later
   * open turn that changed one of the same files must be undone first.
   */
  undoTurn(folder: string, session: string, turn: number): Promise<UndoResult> {
    const checkout = this.#top(folder);
    return this.#queue(checkout, () => {
      const data = this.#load(checkout);
      const record = findTurn(data, session, turn);
      if (record.state !== "open")
        throw new Error(`Turn ${String(turn)} is ${record.state}; only an open turn can be undone.`);
      const later = data.turns.slice(data.turns.indexOf(record) + 1).find((item) => {
        return item.state === "open" && item.files.some((file) => record.files.includes(file));
      });
      if (later !== undefined) {
        throw new Error(`Turn ${String(later.turn)} changed the same files later; undo it first.`);
      }
      const result = this.#restore(checkout, record);
      record.state = "undone";
      this.#collect(checkout, data);
      this.#save(checkout, data);
      return Promise.resolve(result);
    });
  }

  #restore(checkout: string, record: TurnRecord): UndoResult {
    const restored: string[] = [];
    const deleted: string[] = [];
    const skipped: string[] = [];
    for (const path of record.files) {
      const base = record.bases[path] ?? { kind: "unknown", reason: "no base" };
      const full = join(checkout, path);
      if (base.kind === "unknown") {
        skipped.push(`${path} (${base.reason})`);
      } else if (base.kind === "absent") {
        rmSync(full, { force: true });
        removeEmptyFolders(checkout, dirname(full));
        deleted.push(path);
      } else {
        mkdirSync(dirname(full), { recursive: true });
        writeFileSync(full, readFileSync(join(this.#dir(checkout), "blobs", base.hash)));
        if (base.mode !== null) chmodSync(full, base.mode);
        restored.push(path);
      }
    }
    return { restored, deleted, skipped };
  }

  // The views.
  /** The files of a turn (the last turn of the session without `turn`). */
  turnFiles(checkout: string, session: string, turn?: number): string[] {
    const turns = this.#load(this.#top(checkout)).turns.filter((item) => item.session === session);
    const record = turn === undefined ? turns.at(-1) : turns.find((item) => item.turn === turn);
    return record === undefined ? [] : [...record.files];
  }

  /** The turns of a checkout, the newest first. */
  list(checkout: string): TurnSummary[] {
    return this.#load(this.#top(checkout)).turns.map(summary).reverse();
  }

  /** The files of the open and kept turns, in the order of their first edit. */
  sessionFiles(checkout: string): string[] {
    const files = new Set<string>();
    for (const record of this.#load(this.#top(checkout)).turns) {
      if (record.state !== "undone") for (const file of record.files) files.add(file);
    }
    return [...files];
  }

  /**
   * A commit message from the prompt of the first open or kept turn with a prompt and files. The reasons of the
   * layout overrides of "Save placement" go at its end (commitNotes.ts).
   */
  proposal(checkout: string): string {
    const record = this.#load(this.#top(checkout)).turns.find(
      (item) => item.state !== "undone" && item.prompt !== "" && item.files.length > 0,
    );
    return withOverrides(record === undefined ? "" : proposeMessage(record.prompt), this.notes.reasons(checkout));
  }
}

function findTurn(data: CheckoutTurns, session: string, turn: number): TurnRecord {
  const record = data.turns.find((item) => item.session === session && item.turn === turn);
  if (record === undefined) throw new Error(`No turn ${String(turn)} of the session ${session}.`);
  return record;
}

/** Remove empty folders from `folder` up to the checkout (the checkout itself stays). */
function removeEmptyFolders(checkout: string, folder: string): void {
  let current = folder;
  while (current.startsWith(`${checkout}/`)) {
    try {
      if (readdirSync(current).length > 0) return;
      rmdirSync(current);
    } catch {
      return;
    }
    current = dirname(current);
  }
}
